import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceRepos } from '../utils/multi-git.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import type { WorkspaceContext } from '../types.js';

/**
 * Runs the refresh command.
 * Updates context files, maps, and plans.
 *
 * @param options - CLI options, e.g. { repo: 'API_CoworkerFacade' }.
 * @param workspaceArg - Optional workspace path.
 */
export async function refreshCommand(
  options: { repo?: string },
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

  const allRepos = await Promise.all(
    feature.repos.map(async (r) => {
      const repoName = path.basename(r);
      return {
        name: repoName,
        path: r,
        defaultBranch: 'main',
      };
    })
  );

  console.log(chalk.cyan('Running project analysis...'));
  const analysis = await analyzeAllRepos(allRepos);

  const ctx: WorkspaceContext = {
    feature,
    repos: allRepos,
    analysis,
  };

  console.log(chalk.cyan('Regenerating context files and maps...'));
  await generateContextFiles(ctx, feature.assistants, workspacePath, onlyRepo);

  // If repopack context packing is enabled
  const config = await loadConfig();
  if (config.packContextXml) {
    const { packWorkspace } = await import('../core/packer.js');
    console.log(chalk.cyan('Re-packing workspace context...'));
    try {
      await packWorkspace(workspacePath);
    } catch (error) {
      console.warn(chalk.yellow(`  ⚠ Failed to repack context: ${error}`));
    }
  }

  // If handoff file exists, refresh it automatically too!
  const handoffPath = path.join(workspacePath, 'nexusflow-handoff.md');
  let hasHandoff = false;
  try {
    await fs.access(handoffPath);
    hasHandoff = true;
  } catch {}

  if (hasHandoff) {
    console.log(chalk.cyan('Refreshing handoff bundle...'));
    try {
      const { handoffCommand } = await import('./handoff.js');
      await handoffCommand(workspacePath);
    } catch (error) {
      console.warn(chalk.yellow(`  ⚠ Failed to refresh handoff bundle: ${error}`));
    }
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

  const selected = await select({
    message: 'Select a workspace to refresh:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
