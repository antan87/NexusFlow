/**
 * @module commands/diff
 * Displays diff summaries across all repositories in a workspace.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceRepos, getRepoStatus, getDiffSummary } from '../utils/multi-git.js';

/**
 * Executes the diff command.
 *
 * @param workspaceArg - Optional workspace path.
 */
export async function diffCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n🔍 NexusFlow — Workspace Diff Summary\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  const repos = await getWorkspaceRepos(workspacePath);
  let cleanCount = 0;

  const results: Array<{
    name: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    summary: string;
  }> = [];

  for (const repo of repos) {
    const status = await getRepoStatus(repo.path);
    if (!status.hasChanges) {
      cleanCount++;
      continue;
    }

    const diff = await getDiffSummary(repo.path);
    results.push({
      name: repo.name,
      filesChanged: status.changedFiles.length,
      additions: diff.additions,
      deletions: diff.deletions,
      summary: diff.summary,
    });
  }

  if (results.length === 0) {
    console.log(chalk.green('✅ All repositories are clean.\n'));
    return;
  }

  // Print unified table
  console.log(chalk.bold('Repository'.padEnd(25) + ' | ' + 'Files'.padEnd(6) + ' | ' + 'Additions'.padEnd(10) + ' | ' + 'Deletions'.padEnd(10)));
  console.log(chalk.dim('─'.repeat(61)));

  for (const res of results) {
    const fileStr = res.filesChanged.toString().padEnd(6);
    const addStr = `+${res.additions}`.padEnd(10);
    const delStr = `-${res.deletions}`.padEnd(10);
    console.log(
      chalk.bold(res.name.padEnd(25)) + ' | ' +
      fileStr + ' | ' +
      chalk.green(addStr) + ' | ' +
      chalk.red(delStr)
    );
  }

  console.log('\n' + chalk.bold('Detailed Diff Stats:'));
  for (const res of results) {
    console.log(`\n📂 ${chalk.bold.cyan(res.name)}:`);
    console.log(chalk.dim(res.summary.split('\n').map(l => `  ${l}`).join('\n')));
  }

  console.log();
}

/**
 * Resolves workspace path.
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
    message: 'Select a workspace to view diff:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
