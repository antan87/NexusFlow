/**
 * @module commands/diff
 * Displays diff summaries across all repositories in a workspace, including
 * commits that exist locally but have not been pushed yet.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceRepos, getRepoStatus, getDiffSummary, getUnpushedCount } from '../utils/multi-git.js';

interface DiffOptions {
  /** Restrict the diff to these repos (by directory name). */
  repo?: string[];
}

/**
 * Executes the diff command.
 *
 * @param workspaceArg - Optional workspace path.
 * @param options - Optional flags.
 */
export async function diffCommand(workspaceArg?: string, options?: DiffOptions): Promise<void> {
  console.log(chalk.bold.cyan('\n🔍 NexusFlow — Workspace Diff Summary\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  let repos = await getWorkspaceRepos(workspacePath);

  if (options?.repo && options.repo.length > 0) {
    const unknown = options.repo.filter((name) => !repos.some((r) => r.name === name));
    if (unknown.length > 0) {
      console.error(chalk.red(`✖ Repositor${unknown.length === 1 ? 'y' : 'ies'} not in this workspace: ${unknown.join(', ')}`));
      console.log(chalk.dim(`  Available repos: ${repos.map((r) => r.name).join(', ')}`));
      return;
    }
    repos = repos.filter((r) => options.repo!.includes(r.name));
  }

  const results: Array<{
    name: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    unpushed: number | null;
    summary: string;
  }> = [];

  for (const repo of repos) {
    const status = await getRepoStatus(repo.path);
    const unpushed = await getUnpushedCount(repo.path, repo.branchName);

    // A repo with no working-tree changes still matters when it has local
    // commits that were never pushed — otherwise "all clean" hides them.
    if (!status.hasChanges && !(unpushed && unpushed > 0)) {
      continue;
    }

    const diff = status.hasChanges
      ? await getDiffSummary(repo.path)
      : { summary: 'No working-tree changes', additions: 0, deletions: 0 };

    results.push({
      name: repo.name,
      filesChanged: status.changedFiles.length,
      additions: diff.additions,
      deletions: diff.deletions,
      unpushed,
      summary: diff.summary,
    });
  }

  if (results.length === 0) {
    console.log(chalk.green('✅ All repositories are clean and pushed.\n'));
    return;
  }

  // Print unified table
  console.log(chalk.bold(
    'Repository'.padEnd(25) + ' | ' +
    'Files'.padEnd(6) + ' | ' +
    'Additions'.padEnd(10) + ' | ' +
    'Deletions'.padEnd(10) + ' | ' +
    'Unpushed'.padEnd(8)
  ));
  console.log(chalk.dim('─'.repeat(72)));

  for (const res of results) {
    const fileStr = res.filesChanged.toString().padEnd(6);
    const addStr = `+${res.additions}`.padEnd(10);
    const delStr = `-${res.deletions}`.padEnd(10);
    const unpushedStr = res.unpushed === null ? '?'.padEnd(8) : String(res.unpushed).padEnd(8);
    console.log(
      chalk.bold(res.name.padEnd(25)) + ' | ' +
      fileStr + ' | ' +
      chalk.green(addStr) + ' | ' +
      chalk.red(delStr) + ' | ' +
      (res.unpushed ? chalk.yellow(unpushedStr) : chalk.dim(unpushedStr))
    );
  }

  console.log('\n' + chalk.bold('Detailed Diff Stats:'));
  for (const res of results) {
    console.log(`\n📂 ${chalk.bold.cyan(res.name)}:`);
    console.log(chalk.dim(res.summary.split('\n').map(l => `  ${l}`).join('\n')));
    if (res.unpushed && res.unpushed > 0) {
      console.log(chalk.yellow(`  ⬆ ${res.unpushed} commit${res.unpushed === 1 ? '' : 's'} not pushed to origin — run "nexusflow commit" or "git push"`));
    }
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
  if (cwdFeature) return cwdFeature.workspacePath;

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
