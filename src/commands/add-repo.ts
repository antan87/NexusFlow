/**
 * @module commands/add-repo
 * Adds a repository to an existing NexusFlow workspace.
 */

import chalk from 'chalk';
import ora from 'ora';
import { select, search } from '@inquirer/prompts';
import * as path from 'node:path';

import { loadConfig } from '../core/config.js';
import { scanForRepos } from '../core/scanner.js';
import { listWorkspaces, loadFeatureConfig, addRepoToWorkspace } from '../core/workspace.js';
import { BRAND_NAME, PRIMARY_MANIFEST_FILE } from '../core/constants.js';
import type { Feature, RepoInfo } from '../types.js';

/**
 * Returns the scanned repos that are not already part of the workspace.
 *
 * `feature.repos` holds worktree paths inside the workspace, whereas scanned
 * repos carry their original source path — so dedup must compare against
 * `feature.originalRepos`, normalizing for path separators.
 */
export function filterAvailableRepos<T extends Pick<RepoInfo, 'path'>>(
  scanned: T[],
  feature: Pick<Feature, 'originalRepos'>,
): T[] {
  const existingSourcePaths = new Set(
    (feature.originalRepos ?? []).map((p) => path.resolve(p)),
  );
  return scanned.filter((r) => !existingSourcePaths.has(path.resolve(r.path)));
}

/**
 * Executes the add-repo command.
 *
 * @param repoPathArg - Optional repository path to add.
 * @param workspaceArg - Optional workspace path or name.
 */
export async function addRepoCommand(
  repoPathArg?: string,
  workspaceArg?: string,
): Promise<void> {
  console.log(chalk.bold.cyan(`\n➕ ${BRAND_NAME} — Adding Repository to Workspace\n`));

  const config = await loadConfig();

  // 1. Resolve workspace
  let workspacePath: string | null = null;
  let workspaceName = '';

  if (workspaceArg) {
    const resolvedPath = path.isAbsolute(workspaceArg)
      ? workspaceArg
      : path.resolve(config.workspacesDir, workspaceArg);

    try {
      const manifest = await loadFeatureConfig(resolvedPath);
      if (manifest) {
        workspacePath = resolvedPath;
        workspaceName = manifest.branchName;
      }
    } catch {}

    if (!workspacePath) {
      const directPath = path.join(config.workspacesDir, workspaceArg);
      const manifest = await loadFeatureConfig(directPath);
      if (manifest) {
        workspacePath = directPath;
        workspaceName = manifest.branchName;
      } else {
        console.error(chalk.red(`✖ Invalid workspace: No ${PRIMARY_MANIFEST_FILE} found at ${workspaceArg}`));
        return;
      }
    }
  } else {
    const cwdFeature = await loadFeatureConfig(process.cwd());
    if (cwdFeature) {
      workspacePath = cwdFeature.workspacePath;
      workspaceName = cwdFeature.branchName;
    } else {
      const workspaces = await listWorkspaces(config.workspacesDir);
      if (workspaces.length === 0) {
        console.log(chalk.yellow('No workspaces found.\n'));
        return;
      }

      const selected = await search({
        message: 'Search and select a workspace to add a repository to:',
        source: async (input) => {
          const query = (input || '').toLowerCase();
          const filtered = workspaces.filter(
            (ws) =>
              ws.branchName.toLowerCase().includes(query) ||
              ws.workspacePath.toLowerCase().includes(query)
          );
          return filtered.map((ws) => ({
            name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
            value: ws,
          }));
        },
      });

      workspacePath = selected.workspacePath;
      workspaceName = selected.branchName;
    }
  }

  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  // 2. Resolve repository to add
  let repoPathToAdd = '';

  if (repoPathArg) {
    repoPathToAdd = path.resolve(repoPathArg);
  } else {
    const scanSpinner = ora('Scanning for projects...').start();
    let repos = [];
    try {
      repos = await scanForRepos(config.devDir, config.scanDepth);
      scanSpinner.succeed(`Found ${chalk.bold(repos.length)} projects in ${config.devDir}`);
    } catch (error) {
      scanSpinner.fail('Failed to scan for projects');
      console.error(error);
      return;
    }

    const availableRepos = filterAvailableRepos(repos, feature);

    if (availableRepos.length === 0) {
      console.log(chalk.yellow('All scanned repositories are already in the workspace.\n'));
      return;
    }

    repoPathToAdd = await search({
      message: 'Search and select a repository to add:',
      source: async (input) => {
        const query = (input || '').toLowerCase();
        const filtered = availableRepos.filter(
          (r) =>
            r.name.toLowerCase().includes(query) ||
            r.path.toLowerCase().includes(query)
        );
        return filtered.map((r) => ({
          name: `${r.name} ${chalk.dim(`(${r.path})`)}`,
          value: r.path,
        }));
      },
    });
  }

  const repoName = path.basename(repoPathToAdd);
  const spinner = ora(`Adding ${repoName} to workspace ${workspaceName}...`).start();

  try {
    await addRepoToWorkspace(workspacePath, repoPathToAdd);
    spinner.succeed(`Successfully added ${chalk.bold(repoName)} to workspace ${chalk.bold(workspaceName)}`);
    console.log(chalk.dim('  - Checked out git worktree'));
    console.log(chalk.dim(`  - Updated ${PRIMARY_MANIFEST_FILE} and .gitignore`));
    console.log(chalk.dim('  - Re-analyzed workspace codebases'));
    console.log(chalk.dim('  - Regenerated LLM instruction context files'));
    console.log();
  } catch (error) {
    spinner.fail(`Failed to add repository: ${error instanceof Error ? error.message : String(error)}`);
    console.log();
  }
}
