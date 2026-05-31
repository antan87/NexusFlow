/**
 * @module commands/sync
 * Syncs the active workspace by fetching and rebasing all repos onto their base branch.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceRepos, rebaseRepo } from '../utils/multi-git.js';

/**
 * Executes the sync command.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 */
export async function syncCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n🔄 NexusFlow — Syncing Workspace\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists.'));
    return;
  }

  console.log(chalk.bold(`Syncing workspace: ${chalk.cyan(feature.branchName)}`));
  console.log(chalk.dim(`Path: ${workspacePath}\n`));

  let repos;
  try {
    repos = await getWorkspaceRepos(workspacePath);
  } catch (error) {
    console.error(chalk.red(`✖ Failed to retrieve repos: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  let syncedCount = 0;
  let conflictCount = 0;

  for (const repo of repos) {
    console.log(`Repository: ${chalk.bold(repo.name)}`);
    // Ideally we rebase on the repo's default branch, which is often 'main' or 'master'
    // Let's assume 'main' as default unless we fetch/read it.
    const defaultBranch = 'main'; // We can default to 'main' as specified in requirements

    const spinner = chalk.dim('  Rebasing...');
    process.stdout.write(spinner);

    const result = await rebaseRepo(repo.path, defaultBranch);

    // Clear rebase message line
    process.stdout.write('\r' + ' '.repeat(spinner.length) + '\r');

    if (result.success) {
      console.log(`  ${chalk.green('✅')} Synced (${result.message})`);
      syncedCount++;
    } else {
      console.log(`  ${chalk.red('⚠️')} Conflict: ${result.message}`);
      if (result.conflict) {
        console.log(chalk.dim(result.conflict.split('\n').map(l => `    ${l}`).slice(0, 5).join('\n')));
      }
      conflictCount++;
    }
  }

  console.log(`\n📊 ${chalk.bold('Summary:')} ${syncedCount} synced, ${conflictCount} conflict(s)\n`);
}

/**
 * Resolves a workspace path from argument, cwd, or user prompt.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) {
    const absolutePath = path.resolve(workspaceArg);
    try {
      await fs.access(path.join(absolutePath, 'nexusflow.json'));
      return absolutePath;
    } catch {
      console.error(chalk.red(`✖ Invalid workspace: No nexusflow.json found at ${absolutePath}`));
      return null;
    }
  }

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return process.cwd();

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace to sync:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
