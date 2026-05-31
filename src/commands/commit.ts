/**
 * @module commands/commit
 * Commits changes across all repositories in the workspace.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceRepos, getRepoStatus, commitAndPush } from '../utils/multi-git.js';

interface CommitOptions {
  noPush?: boolean;
  dryRun?: boolean;
}

/**
 * Executes the commit command.
 *
 * @param message - The commit message.
 * @param workspaceArg - Optional workspace path.
 * @param options - Optional flags.
 */
export async function commitCommand(
  message: string,
  workspaceArg?: string,
  options?: CommitOptions,
): Promise<void> {
  console.log(chalk.bold.cyan('\n💾 NexusFlow — Committing Workspace Changes\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  const repos = await getWorkspaceRepos(workspacePath);
  const changedRepos = [];

  for (const repo of repos) {
    const status = await getRepoStatus(repo.path);
    if (status.hasChanges) {
      changedRepos.push({ repo, status });
    }
  }

  if (changedRepos.length === 0) {
    console.log(chalk.green('✅ No changes to commit across any repositories.\n'));
    return;
  }

  console.log(`Found ${chalk.bold(changedRepos.length)} repositor${changedRepos.length === 1 ? 'y' : 'ies'} with changes.`);
  if (options?.dryRun) {
    console.log(chalk.yellow('⚠️  Dry run mode enabled. No changes will actually be committed or pushed.'));
  }
  console.log();

  for (const { repo, status } of changedRepos) {
    console.log(`Repository: ${chalk.bold(repo.name)}`);
    console.log(chalk.dim(`  Changes: ${status.summary}`));
    for (const file of status.changedFiles) {
      console.log(`    ${chalk.yellow('M')} ${file}`);
    }

    if (options?.dryRun) {
      console.log(chalk.dim('  [Dry Run] Would commit and ' + (options?.noPush ? 'not push' : 'push')));
      continue;
    }

    const spinner = chalk.dim('  Committing...');
    process.stdout.write(spinner);

    const result = await commitAndPush(repo.path, message, repo.branchName, {
      noPush: options?.noPush,
    });

    process.stdout.write('\r' + ' '.repeat(spinner.length) + '\r');

    if (result.success) {
      const action = options?.noPush ? 'Committed' : 'Committed & pushed';
      console.log(`  ${chalk.green('✅')} ${action} (${chalk.cyan(result.commitHash || 'no hash')})`);
    } else {
      console.log(`  ${chalk.red('✖')} Failed: ${result.message}`);
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
  if (cwdFeature) return process.cwd();

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace to commit:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
