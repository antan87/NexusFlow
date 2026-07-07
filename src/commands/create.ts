/**
 * @module commands/create
 * The main "create workspace" command — the core NexusFlow workflow.
 * Mirrors and enhances the user's existing Create-Workspace.ps1 script.
 */

import chalk from 'chalk';
import ora from 'ora';
import path from 'node:path';
import { execa } from 'execa';

import { confirm } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { scanForRepos } from '../core/scanner.js';
import { createWorkspace } from '../core/workspace.js';
import { generateContextFiles } from '../generators/index.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { detectAIAssistants } from '../utils/detect-ai.js';
import { detectEditors } from '../utils/detect-editors.js';
import { openInEditor } from '../utils/open-editor.js';
import { debugLog } from '../utils/debug.js';
import {
  promptBranchName,
  promptDescription,
  promptSelectRepos,
  promptSelectAI,
  promptSelectEditor,
  promptSelectStrategy,
  promptNewStrategy,
} from '../utils/prompts.js';
import type { Feature, WorkspaceContext } from '../types.js';
import { suggestWorkflow } from '../utils/workflow-advisor.js';
import { getWorkflowTemplates, saveWorkflowTemplate } from '../utils/workflows.js';

/**
 * Executes the full "create workspace" flow:
 * 1. Prompt for branch name
 * 2. Prompt for feature description
 * 3. Scan for repos and let user pick
 * 4. Detect AI assistants and let user pick
 * 5. Create workspace with git worktrees
 * 6. Generate AI context files
 * 7. Optionally open in editor
 */
export async function createCommand(): Promise<void> {
  console.log(
    chalk.bold.cyan('\n🚀 NexusFlow — Create Feature Workspace\n'),
  );

  // ── 1. Branch name ──────────────────────────────────────────────────
  const branchName = await promptBranchName();

  // ── 2. Feature description ──────────────────────────────────────────
  const description = await promptDescription();

  // ── 3. Scan for repos ───────────────────────────────────────────────
  const config = await loadConfig();
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

  // ── 4. Select repos ────────────────────────────────────────────────
  const selectedRepos = await promptSelectRepos(repos);
  if (selectedRepos.length === 0) {
    console.log(chalk.yellow('No projects selected. Exiting.'));
    return;
  }

  console.log(
    chalk.dim(`  Selected: ${selectedRepos.map((r) => r.name).join(', ')}`),
  );

  // ── 5. Detect and select AI assistants ──────────────────────────────
  const detectedAI = await detectAIAssistants();
  const selectedAI = await promptSelectAI(detectedAI);

  const localLlmEnabled = config.localLlm?.enabled
    ? await confirm({ message: 'Enable Local AI Co-processor in this workspace context?', default: true })
    : false;

  // ── 5.5. Suggest workflow strategy ───────────────────────────────
  const templates = await getWorkflowTemplates();
  const selectedStrategyId = await promptSelectStrategy(templates);

  let teamworkInstructions = '';

  if (selectedStrategyId === 'auto') {
    const workflowSpinner = ora('Suggesting teamwork collaboration strategy...').start();
    try {
      const suggestion = await suggestWorkflow(description, selectedRepos, config.localLlm);
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
  const workspacePath = path.join(config.workspacesDir, branchName);
  const feature: Feature = {
    id: branchName,
    branchName,
    description,
    repos: selectedRepos.map((r) => path.join(workspacePath, r.name)),
    originalRepos: selectedRepos.map((r) => r.path),
    assistants: selectedAI,
    workspacePath,
    createdAt: new Date().toISOString(),
    localLlmEnabled,
    teamworkInstructions,
  };

  const wsSpinner = ora('Creating workspace with git worktrees...').start();
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
  // exiting with an error.
  const workspaceRepos = selectedRepos.map((repo) => ({
    ...repo,
    path: path.join(workspacePath, repo.name),
  }));
  try {
    console.log(chalk.cyan('\nAnalyzing projects...'));
    const analysis = await analyzeAllRepos(workspaceRepos);

    const ctx: WorkspaceContext = { feature, repos: workspaceRepos, analysis, localLlm: config.localLlm };
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
  console.log(`  ${chalk.dim('Branch:')} ${branchName}`);
  console.log(`  ${chalk.dim('Repos:')}  ${selectedRepos.map((r) => r.name).join(', ')}`);
  console.log(`  ${chalk.dim('AI:')}     ${selectedAI.join(', ')}`);
  console.log(`  ${chalk.dim('Local AI:')} ${localLlmEnabled ? 'Enabled' : 'Disabled'}`);
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

        try {
          await execa(launchCmd, [], {
            cwd: workspacePath,
            stdio: 'inherit',
            shell: process.platform === 'win32',
          });
          console.log(chalk.green(`\n👋 Exited ${label} session.`));
        } catch {
          console.log(
            chalk.yellow(`\n⚠️  Could not start ${label}. Please start it manually:\n  ${chalk.dim(`cd "${workspacePath}" && ${launchCmd}`)}`)
          );
        }
      }
    }
  }
}
