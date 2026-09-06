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
import { getWorkspaceRepos, getRepoStatus, getDiffSummary, commitAndPush, type RepoStatusFile } from '../utils/multi-git.js';
import { BRAND_NAME, PRIMARY_MANIFEST_FILE } from '../core/constants.js';

interface CommitOptions {
  /**
   * Commander stores the `--no-push` flag under `push` (default `true`);
   * pushing is therefore suppressed when this is explicitly `false`.
   */
  push?: boolean;
  dryRun?: boolean;
  /** Restrict the commit to these repos (by directory name). */
  repo?: string[];
}

/**
 * Renders a porcelain status code with a color matching its state:
 * green for staged, yellow for unstaged, cyan for untracked.
 */
function renderStatusCode(file: RepoStatusFile): string {
  const code = file.code.trim() || '??';
  if (file.code === '??') return chalk.cyan(code);
  if (file.code[0] !== ' ' && file.code[0] !== '?') return chalk.green(code);
  return chalk.yellow(code);
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
  console.log(chalk.bold.cyan(`\n💾 ${BRAND_NAME} — Committing Workspace Changes\n`));

  const noPush = options?.push === false;

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
    const diff = await getDiffSummary(repo.path);
    console.log(`Repository: ${chalk.bold(repo.name)}`);
    console.log(chalk.dim(`  Changes: ${status.summary} (${chalk.green(`+${diff.additions}`)} ${chalk.red(`−${diff.deletions}`)})`));
    for (const file of status.files) {
      console.log(`    ${renderStatusCode(file)} ${file.path}`);
    }

    if (options?.dryRun) {
      console.log(chalk.dim('  [Dry Run] Would commit and ' + (noPush ? 'not push' : 'push')));
      continue;
    }

    const spinner = chalk.dim('  Committing...');
    process.stdout.write(spinner);

    const result = await commitAndPush(repo.path, message, repo.branchName, {
      noPush,
    });

    process.stdout.write('\r' + ' '.repeat(spinner.length) + '\r');

    if (result.success) {
      const action = noPush ? 'Committed' : 'Committed & pushed';
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
    const feature = await loadFeatureConfig(absolutePath);
    if (feature) {
      return absolutePath;
    }
    console.error(chalk.red(`✖ Invalid workspace: No ${PRIMARY_MANIFEST_FILE} found at ${absolutePath}`));
    return null;
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
    message: 'Select a workspace to commit:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
