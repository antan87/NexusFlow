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
import { packWorkspace } from '../core/packer.js';
import { generateContextFiles } from '../generators/index.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { detectAIAssistants } from '../utils/detect-ai.js';
import { detectEditors } from '../utils/detect-editors.js';
import {
  promptBranchName,
  promptDescription,
  promptSelectRepos,
  promptSelectAI,
  promptSelectEditor,
} from '../utils/prompts.js';
import type { Feature, WorkspaceContext } from '../types.js';

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

  // ── 6. Create workspace ─────────────────────────────────────────────
  const workspacePath = path.join(config.workspacesDir, branchName);
  const feature: Feature = {
    id: branchName,
    branchName,
    description,
    repos: selectedRepos.map((r) => r.path),
    assistants: selectedAI,
    workspacePath,
    createdAt: new Date().toISOString(),
  };

  const wsSpinner = ora('Creating workspace with git worktrees...').start();
  try {
    await createWorkspace(feature, selectedRepos);
    wsSpinner.succeed(`Workspace created at ${chalk.bold(workspacePath)}`);
  } catch (error) {
    wsSpinner.fail('Failed to create workspace');
    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ${message}`));
    return;
  }

  // ── 7. Analyze projects ─────────────────────────────────────────────
  console.log(chalk.cyan('\nAnalyzing projects...'));
  const workspaceRepos = selectedRepos.map((repo) => ({
    ...repo,
    path: path.join(workspacePath, repo.name),
  }));
  const analysis = await analyzeAllRepos(workspaceRepos);

  // ── 8. Generate AI context files ────────────────────────────────────
  const ctx: WorkspaceContext = { feature, repos: workspaceRepos, analysis };
  console.log(chalk.cyan('\nGenerating AI context files...'));
  await generateContextFiles(ctx, selectedAI, workspacePath);

  // ── 8.5. Pack codebase context ──────────────────────────────────────
  const packSpinner = ora('Packing codebase context with Repomix...').start();
  try {
    const packResult = await packWorkspace(workspacePath);
    packSpinner.succeed(
      `Packed codebase context (${packResult.totalFiles} files, ${(packResult.fileSize / 1024).toFixed(2)} KB)`
    );
  } catch (error) {
    packSpinner.fail('Failed to pack codebase context');
    console.error(chalk.red(`  ${error}`));
  }

  // ── 8. Open in editor ───────────────────────────────────────────────
  const detectedEditors = await detectEditors();
  const editor = await promptSelectEditor(detectedEditors);

  if (editor) {
    const editorSpinner = ora(`Opening in ${editor.name}...`).start();
    try {
      await execa(editor.command, [workspacePath], { stdio: 'ignore' });
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
  console.log(
    `\n  ${chalk.dim('To navigate:')} cd "${workspacePath}"`,
  );
  console.log();

  // ── 9. Start AI Assistant Session ───────────────────────────────────
  if (selectedAI.length > 0) {
    const assistant = selectedAI[0];
    const confirmStart = await confirm({
      message: `Do you want to start a session with ${assistant} inside the workspace now?`,
      default: true,
    });

    if (confirmStart) {
      console.log(chalk.cyan(`\n🚀 Starting ${assistant} session inside workspace...\n`));

      let cmd = 'agy';
      if (assistant === 'claude') cmd = 'claude';
      else if (assistant === 'codex') cmd = 'codex';
      else if (assistant === 'copilot') cmd = 'copilot';

      try {
        await execa(cmd, [], { cwd: workspacePath, stdio: 'inherit' });
        console.log(chalk.green(`\n👋 Exited ${assistant} session.`));
      } catch {
        console.log(
          chalk.yellow(`\n⚠️  Could not start ${assistant}. Please start it manually:\n  ${chalk.dim(`cd "${workspacePath}" && ${cmd}`)}`)
        );
      }
    }
  }
}
