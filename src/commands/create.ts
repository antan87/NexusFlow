/**
 * @module commands/create
 * The main "create workspace" command — the core NexusFlow workflow.
 * Mirrors and enhances the user's existing Create-Workspace.ps1 script.
 */

import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import { execa } from 'execa';

import { confirm, input, select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { scanForRepos } from '../core/scanner.js';
import { createWorkspace, resolveRepoInfos } from '../core/workspace.js';
import { generateContextFiles } from '../generators/index.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { detectAIAssistants } from '../utils/detect-ai.js';
import { detectEditors } from '../utils/detect-editors.js';
import { openInEditor } from '../utils/open-editor.js';
import { debugLog } from '../utils/debug.js';
import { getSessionCwd } from '../utils/feature.js';
import {
  promptBranchName,
  promptDescription,
  promptSelectRepos,
  promptSelectAI,
  promptSelectEditor,
  promptSelectStrategy,
  promptNewStrategy,
  promptNewProjectName,
  promptRepoBranches,
} from '../utils/prompts.js';
import { createNewRepo } from '../core/new-repo.js';
import { loadProjects, slugifyProjectName } from '../core/projects.js';
import type { Feature, Project, RepoSelection, WorkspaceContext, WorkspaceMode } from '../types.js';
import { suggestWorkflow } from '../utils/workflow-advisor.js';
import { getWorkflowTemplates, saveWorkflowTemplate } from '../utils/workflows.js';

/**
 * Executes the full "create workspace" flow:
 * 1. Pick a registered project (or ad-hoc repos)
 * 2. Choose the work mode: in-place (no git ceremony) or isolated worktrees
 * 3. Prompt for branch name (worktree) or workspace name (in-place)
 * 4. Prompt for feature description; select repos when ad hoc
 * 5. Detect AI assistants and let user pick
 * 6. Create the workspace (worktrees only in worktree mode)
 * 7. Generate AI context files
 * 8. Optionally open in editor
 */
export async function createCommand(): Promise<void> {
  console.log(
    chalk.bold.cyan('\n🚀 NexusFlow — Start Work\n'),
  );

  const config = await loadConfig();

  // ── 0. Project selection (when a registry exists) ───────────────────
  const projects = await loadProjects({ quiet: true });
  let project: Project | null = null;
  if (projects.length > 0) {
    const choice = await select({
      message: 'Start from a project?',
      choices: [
        ...projects.map((p) => ({
          name: `${p.name} ${chalk.dim(`(${p.repos.map((r) => path.basename(r.path)).join(', ')})`)}`,
          value: p.id,
        })),
        { name: 'Ad-hoc — pick repos manually', value: '' },
      ],
    });
    project = choice ? projects.find((p) => p.id === choice) ?? null : null;
  }

  // ── 1. Work mode ─────────────────────────────────────────────────────
  const mode: WorkspaceMode = await select({
    message: 'How do you want to work?',
    choices: [
      {
        name: 'In-place — directly in the source repos (no branches, fastest start)',
        value: 'in-place' as WorkspaceMode,
      },
      {
        name: 'Isolated worktrees — a feature branch and worktree per repo',
        value: 'worktree' as WorkspaceMode,
      },
    ],
  });
  const inPlace = mode === 'in-place';

  // ── 2. Identity: feature branch, or a plain name for in-place ───────
  let branchName = '';
  let workspaceId = '';
  if (inPlace) {
    const workspaceName = await input({
      message: 'Workspace name:',
      validate: (value) =>
        slugifyProjectName(value).length > 0 || 'Name needs at least one letter or digit',
    });
    workspaceId = slugifyProjectName(workspaceName);
    branchName = workspaceId; // populated for display/back-compat; no branch is created
  } else {
    branchName = await promptBranchName();
    workspaceId = branchName;
  }

  // ── 2.1. Feature description ─────────────────────────────────────────
  const description = await promptDescription();

  // ── 3-4. Repos: from the project, or scanned and picked ad hoc ───────
  let selectedRepos: RepoSelection[];
  if (project) {
    // Re-resolve at create time: the registry's defaultBranch is a snapshot
    // from `project add` and may have gone stale (repo moved, default branch
    // renamed) — basing a new feature branch on it would be silently wrong.
    const projectSpinner = ora(`Validating repositories of ${project.name}...`).start();
    try {
      selectedRepos = await resolveRepoInfos(project.repos.map((r) => r.path));
      projectSpinner.succeed(`Repos from ${project.name}: ${selectedRepos.map((r) => r.name).join(', ')}`);
    } catch (error) {
      projectSpinner.fail(
        `A repository of project "${project.name}" is missing or not a git repo — fix it with "nexusflow project add/remove".`,
      );
      throw error;
    }
  } else {
    const spinner = ora('Scanning for projects...').start();

    let repos;
    try {
      repos = await scanForRepos(config.devDir, config.scanDepth);
      spinner.succeed(`Found ${chalk.bold(repos.length)} projects in ${config.devDir}`);
    } catch (error) {
      spinner.fail('Failed to scan for projects');
      throw error;
    }

    if (repos.length === 0) {
      console.log(chalk.yellow('No git projects found. Check your devDir setting.'));
      return;
    }

    selectedRepos = await promptSelectRepos(repos);

    // ── 4.1. Optionally scaffold brand-new projects ─────────────────────
    while (
      await confirm({
        message: '➕ Create a brand-new project to include in this workspace?',
        default: false,
      })
    ) {
      const projectName = await promptNewProjectName(config.devDir);
      const newRepoSpinner = ora(`Creating new project ${projectName}...`).start();
      try {
        const newRepo = await createNewRepo(config.devDir, projectName);
        selectedRepos.push(newRepo);
        newRepoSpinner.succeed(`Created ${chalk.bold(newRepo.name)} at ${newRepo.path}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        newRepoSpinner.fail(`Could not create project: ${message}`);
      }
    }

    if (selectedRepos.length === 0) {
      console.log(chalk.yellow('No projects selected. Exiting.'));
      return;
    }

    console.log(
      chalk.dim(`  Selected: ${selectedRepos.map((r) => r.name).join(', ')}`),
    );
  }

  // ── 4.2. Optionally use existing branches per repo (worktree only) ───
  const branchOverrides = inPlace
    ? new Map<string, string>()
    : await promptRepoBranches(selectedRepos, branchName);
  for (const repo of selectedRepos) {
    const override = branchOverrides.get(repo.name);
    if (override) {
      repo.existingBranch = override;
      console.log(chalk.dim(`  ${repo.name}: using existing branch "${override}"`));
    }
  }

  // ── 5. Detect and select AI assistants ──────────────────────────────
  const detectedAI = await detectAIAssistants();
  const selectedAI = await promptSelectAI(detectedAI);

  // ── 5.5. Suggest workflow strategy ───────────────────────────────
  const templates = await getWorkflowTemplates();
  const selectedStrategyId = await promptSelectStrategy(templates);

  let teamworkInstructions = '';

  if (selectedStrategyId === 'auto') {
    const workflowSpinner = ora('Suggesting teamwork collaboration strategy...').start();
    try {
      const suggestion = await suggestWorkflow(description, selectedRepos);
      teamworkInstructions = suggestion.customInstructions;
      workflowSpinner.succeed(`Auto-selected strategy for ${chalk.bold(suggestion.difficulty)} difficulty task`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      workflowSpinner.fail(`Failed to suggest teamwork strategy (${reason}) — continuing without one`);
      debugLog('workflow-advisor', 'suggestWorkflow', err);
    }
  } else if (selectedStrategyId === 'create_new') {
    const { name, content } = await promptNewStrategy();
    try {
      const newTemplate = await saveWorkflowTemplate(name, content);
      teamworkInstructions = newTemplate.content;
      console.log(chalk.green(`  ✔ Saved and selected new strategy: ${chalk.bold(newTemplate.name)}`));
    } catch (err) {
      console.log(chalk.yellow(`  ⚠ Failed to save strategy: ${String(err)}`));
      teamworkInstructions = content;
    }
  } else {
    const selectedTemplate = templates.find((t) => t.id === selectedStrategyId);
    if (selectedTemplate) {
      teamworkInstructions = selectedTemplate.content;
      console.log(chalk.green(`  ✔ Selected strategy: ${chalk.bold(selectedTemplate.name)}`));
    }
  }

  // ── 6. Create workspace ─────────────────────────────────────────────
  const workspacePath = path.join(config.workspacesDir, workspaceId);
  const feature: Feature = {
    id: workspaceId,
    mode,
    projectId: project?.id,
    branchName,
    description,
    repos: inPlace
      ? selectedRepos.map((r) => r.path)
      : selectedRepos.map((r) => path.join(workspacePath, r.name)),
    originalRepos: selectedRepos.map((r) => r.path),
    repoBranches: branchOverrides.size > 0 ? Object.fromEntries(branchOverrides) : undefined,
    assistants: selectedAI,
    workspacePath,
    createdAt: new Date().toISOString(),
    teamworkInstructions,
  };

  const wsSpinner = ora(
    inPlace ? 'Registering workspace...' : 'Creating workspace with git worktrees...',
  ).start();
  try {
    await createWorkspace(feature, selectedRepos, (repoName, index, total) => {
      wsSpinner.text = `Creating worktrees… ${repoName} (${index + 1}/${total})`;
    });
    wsSpinner.succeed(`Workspace created at ${chalk.bold(workspacePath)}`);
  } catch (error) {
    wsSpinner.fail('Failed to create workspace');
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ${message}`));
    console.log(chalk.dim('  Rolled back the partial workspace.'));
    process.exitCode = 1;
    return;
  }

  // ── 7-8. Analyze projects & generate context ────────────────────────
  // The worktrees are the product; if analysis/generation fails the workspace
  // is still usable, so keep it and tell the user how to retry rather than
  // exiting with an error. In-place analysis runs on the source repos.
  const workspaceRepos = inPlace
    ? selectedRepos
    : selectedRepos.map((repo) => ({
        ...repo,
        path: path.join(workspacePath, repo.name),
      }));
  try {
    console.log(chalk.cyan('\nAnalyzing projects...'));
    const analysis = await analyzeAllRepos(workspaceRepos);

    const ctx: WorkspaceContext = { feature, repos: workspaceRepos, analysis };
    console.log(chalk.cyan('\nGenerating AI context files...'));
    await generateContextFiles(ctx, selectedAI, workspacePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      chalk.yellow(
        `\n⚠️  Workspace was created and is usable, but context generation failed (${message}).\n` +
          `   Run "nexusflow refresh" inside the workspace to retry.`,
      ),
    );
  }

  // ── 8. Open in editor ───────────────────────────────────────────────
  const detectedEditors = await detectEditors();
  const editor = await promptSelectEditor(detectedEditors);

  if (editor) {
    const editorSpinner = ora(`Opening in ${editor.name}...`).start();
    try {
      await openInEditor(editor.command, workspacePath);
      editorSpinner.succeed(`Opened in ${editor.name}`);
    } catch {
      editorSpinner.warn(
        `Could not open ${editor.name}. Open manually:\n  ${chalk.dim(`cd "${workspacePath}"`)}`,
      );
    }
  }

  // ── Done ────────────────────────────────────────────────────────────
  console.log(
    chalk.bold.green('\n✅ Workspace ready!\n'),
  );
  console.log(`  ${chalk.dim('Path:')}  ${workspacePath}`);
  console.log(
    inPlace
      ? `  ${chalk.dim('Mode:')}   in-place (working directly in the source repos)`
      : `  ${chalk.dim('Branch:')} ${branchName}`,
  );
  console.log(`  ${chalk.dim('Repos:')}  ${selectedRepos.map((r) => r.name).join(', ')}`);
  console.log(`  ${chalk.dim('AI:')}     ${selectedAI.join(', ')}`);

  console.log(
    `\n  ${chalk.dim('To navigate:')} cd "${workspacePath}"`,
  );
  console.log();

  // ── 9. Start AI Assistant Session ───────────────────────────────────
  if (selectedAI.length > 0) {
    const assistant = selectedAI[0];
    const detected = detectedAI.find((a) => a.name === assistant);
    const label = detected?.displayName ?? assistant;
    // `command` is the single source of truth for a launchable terminal session
    // (see detect-ai.ts). Some assistants are selectable but not launchable this
    // way (e.g. Copilot without its CLI, or Cursor's GUI-only binary).
    const launchCmd = detected?.command;

    if (!launchCmd) {
      console.log(
        chalk.dim(
          `\n  ${label} has no launchable terminal CLI — open the workspace in it manually.`,
        ),
      );
    } else {
      const confirmStart = await confirm({
        message: `Do you want to start a session with ${label} inside the workspace now?`,
        default: true,
      });

      if (confirmStart) {
        console.log(chalk.cyan(`\n🚀 Starting ${label} session inside workspace...\n`));

        const sessionCwd = getSessionCwd(feature);
        try {
          await execa(launchCmd, [], {
            cwd: sessionCwd,
            stdio: 'inherit',
            shell: process.platform === 'win32',
          });
          console.log(chalk.green(`\n👋 Exited ${label} session.`));
        } catch {
          console.log(
            chalk.yellow(`\n⚠️  Could not start ${label}. Please start it manually:\n  ${chalk.dim(`cd "${sessionCwd}" && ${launchCmd}`)}`)
          );
        }
      }
    }
  }
}
