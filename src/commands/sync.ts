/**
 * @module commands/sync
 * Syncs the active workspace by fetching and rebasing all repos onto their base branch.
 */

import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { syncWorkspace, type RepoSyncReport } from '../core/sync.js';

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

  let report;
  try {
    report = await syncWorkspace(workspacePath);
  } catch (error) {
    console.error(chalk.red(`✖ Failed to sync: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  for (const repo of report.repos) {
    console.log(`Repository: ${chalk.bold(repo.name)}`);
    renderRepoResult(repo, workspacePath);
  }

  const parts = [`${report.syncedCount} synced`];
  if (report.conflictCount > 0) parts.push(`${report.conflictCount} conflict(s)`);
  if (report.errorCount > 0) parts.push(`${report.errorCount} error(s)`);
  console.log(`\n📊 ${chalk.bold('Summary:')} ${parts.join(', ')}\n`);

  if (report.contextRefreshed) {
    console.log(chalk.green('✅ Workspace maps and contexts updated (changed repos only).\n'));
  } else if (report.syncedCount > 0 && report.conflictCount === 0 && report.errorCount === 0) {
    console.log(chalk.green('✅ Everything already up to date — context files left untouched.\n'));
  }
}

/**
 * Prints a single repo's sync outcome with status-appropriate styling and,
 * for conflicts, the conflicted files plus how to resolve them.
 */
function renderRepoResult(repo: RepoSyncReport, workspacePath: string): void {
  const repoDir = path.join(workspacePath, repo.name);
  switch (repo.status) {
    case 'up-to-date':
    case 'rebased':
      console.log(`  ${chalk.green('✅')} Synced (${repo.message})`);
      break;
    case 'stash-conflict':
      console.log(`  ${chalk.yellow('⚠️')} ${repo.message}`);
      console.log(chalk.dim(`    Your local changes are safe in the stash. To merge them manually:`));
      console.log(chalk.dim(`      cd ${repoDir}`));
      console.log(chalk.dim('      git stash pop   # resolve any conflicts, then git add the files'));
      break;
    case 'conflict':
      console.log(`  ${chalk.red('❌')} Conflict: ${repo.message} ${chalk.dim('(rebase was aborted — your branch is unchanged)')}`);
      if (repo.conflictFiles && repo.conflictFiles.length > 0) {
        console.log(chalk.dim('    Conflicted files:'));
        for (const file of repo.conflictFiles.slice(0, 10)) {
          console.log(`      ${chalk.red('✖')} ${file}`);
        }
        if (repo.conflictFiles.length > 10) {
          console.log(chalk.dim(`      … and ${repo.conflictFiles.length - 10} more`));
        }
      } else if (repo.conflict) {
        console.log(chalk.dim(repo.conflict.split('\n').map(l => `    ${l}`).slice(0, 5).join('\n')));
      }
      console.log(chalk.dim('    To resolve manually:'));
      console.log(chalk.dim(`      cd ${repoDir}`));
      console.log(chalk.dim(`      git rebase origin/${repo.baseBranch}   # fix conflicts, git add, then git rebase --continue`));
      break;
    case 'error':
      console.log(`  ${chalk.red('🔌')} ${repo.message}`);
      console.log(chalk.dim('    This is an infrastructure failure (network/auth), not a merge conflict — check your connection or credentials and re-run nexusflow sync.'));
      break;
  }
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
  if (cwdFeature) return cwdFeature.workspacePath;

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await search({
    message: 'Search and select a workspace to sync:',
    source: async (input) => {
      const query = (input || '').toLowerCase();
      const filtered = workspaces.filter(
        (ws) =>
          ws.branchName.toLowerCase().includes(query) ||
          ws.workspacePath.toLowerCase().includes(query)
      );
      return filtered.map((ws) => ({
        name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
        value: ws.workspacePath,
      }));
    },
  });

  return selected;
}
