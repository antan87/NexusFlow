/**
 * @module commands/add-repo
 * Adds a repository to an existing NexusFlow workspace.
 */

import chalk from 'chalk';
import ora from 'ora';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';

import { loadConfig } from '../core/config.js';
import { scanForRepos } from '../core/scanner.js';
import { listWorkspaces, loadFeatureConfig, addRepoToWorkspace } from '../core/workspace.js';

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
  console.log(chalk.bold.cyan('\n➕ NexusFlow — Adding Repository to Workspace\n'));

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
        console.error(chalk.red(`✖ Invalid workspace: No nexusflow.json found at ${workspaceArg}`));
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

      const selected = await select({
        message: 'Select a workspace to add a repository to:',
        choices: workspaces.map((ws) => ({
          name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
          value: ws,
        })),
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

    const availableRepos = repos.filter(
      (r) => !feature.repos.includes(r.path)
    );

    if (availableRepos.length === 0) {
      console.log(chalk.yellow('All scanned repositories are already in the workspace.\n'));
      return;
    }

    repoPathToAdd = await select({
      message: 'Select a repository to add:',
      choices: availableRepos.map((r) => ({
        name: `${r.name} ${chalk.dim(`(${r.path})`)}`,
        value: r.path,
      })),
    });
  }

  const repoName = path.basename(repoPathToAdd);
  const spinner = ora(`Adding ${repoName} to workspace ${workspaceName}...`).start();

  try {
    await addRepoToWorkspace(workspacePath, repoPathToAdd);
    spinner.succeed(`Successfully added ${chalk.bold(repoName)} to workspace ${chalk.bold(workspaceName)}`);
    console.log(chalk.dim('  - Checked out git worktree'));
    console.log(chalk.dim('  - Updated nexusflow.json and .gitignore'));
    console.log(chalk.dim('  - Re-analyzed workspace codebases'));
    console.log(chalk.dim('  - Regenerated LLM instruction context files'));
    console.log(chalk.dim('  - Repacked codebase context using Repomix'));
    console.log();
  } catch (error) {
    spinner.fail(`Failed to add repository: ${error instanceof Error ? error.message : String(error)}`);
    console.log();
  }
}
