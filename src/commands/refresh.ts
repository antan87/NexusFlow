import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { refreshWorkspace } from '../core/refresh.js';

/**
 * Runs the refresh command.
 * Updates context files, maps, and plans — re-analyzing only repos whose
 * content changed since the last run (use --force to re-analyze everything).
 *
 * @param options - CLI options, e.g. { repo: 'API_CoworkerFacade', force: true }.
 * @param workspaceArg - Optional workspace path.
 */
export async function refreshCommand(
  options: { repo?: string; base?: boolean; force?: boolean },
  workspaceArg?: string,
): Promise<void> {
  console.log(chalk.bold.cyan('\n🔄 NexusFlow — Refresh Workspace Context\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists.'));
    return;
  }

  const onlyRepo = options.repo;
  if (onlyRepo) {
    const hasRepo = feature.repos.some(r => path.basename(r) === onlyRepo);
    if (!hasRepo) {
      console.error(chalk.red(`✖ Repository "${onlyRepo}" is not part of this workspace.`));
      console.log(chalk.dim(`  Available repos: ${feature.repos.map(r => path.basename(r)).join(', ')}`));
      return;
    }
    console.log(`Refreshing context for repository: ${chalk.bold(onlyRepo)}`);
  } else {
    console.log('Refreshing context for all repositories...');
  }
  if (options.force) {
    console.log(chalk.dim('Force mode: ignoring analysis cache.'));
  }

  let report;
  try {
    report = await refreshWorkspace(workspacePath, {
      onlyRepo,
      baseOnly: options.base,
      force: options.force,
    });
  } catch (error) {
    console.error(chalk.red(`✖ Failed to refresh: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  if (report.reusedRepos.length > 0) {
    console.log(
      chalk.dim(
        `\n♻️  Token-efficient refresh: ${report.reusedRepos.length} unchanged repo(s) reused cached analysis` +
        (report.analyzedRepos.length > 0 ? `, ${report.analyzedRepos.length} re-analyzed.` : '.'),
      ),
    );
  }
  console.log(chalk.bold.green('\n✅ Workspace context successfully refreshed!\n'));
}

/**
 * Resolves a workspace path.
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
    message: 'Search and select a workspace to refresh:',
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
