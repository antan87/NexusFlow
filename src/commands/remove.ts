/**
 * @module commands/remove
 * Deletes a NexusFlow workspace and cleanly removes/prunes its git worktrees.
 */

import chalk from 'chalk';
import ora from 'ora';
import { confirm, search } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, deleteWorkspace } from '../core/workspace.js';
import { BRAND_NAME } from '../core/constants.js';

/**
 * Executes the remove command.
 *
 * @param workspaceArg - Optional workspace path or branch name from CLI.
 */
export async function removeCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.red(`\n🗑️ ${BRAND_NAME} — Deleting Workspace\n`));

  const config = await loadConfig();
  let workspacePath: string | null = null;
  let workspaceName = '';

  if (workspaceArg) {
    const resolvedPath = path.isAbsolute(workspaceArg)
      ? workspaceArg
      : path.resolve(config.workspacesDir, workspaceArg);

    try {
      await fs.access(resolvedPath);
      workspacePath = resolvedPath;
      workspaceName = path.basename(resolvedPath);
    } catch {
      const directPath = path.join(config.workspacesDir, workspaceArg);
      try {
        await fs.access(directPath);
        workspacePath = directPath;
        workspaceName = workspaceArg;
      } catch {
        console.error(chalk.red(`✖ Workspace not found: ${workspaceArg}`));
        return;
      }
    }
  } else {
    const workspaces = await listWorkspaces(config.workspacesDir);

    if (workspaces.length === 0) {
      console.log(chalk.yellow('No workspaces found.\n'));
      return;
    }

    const selected = await search({
      message: 'Search and select a workspace to delete:',
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

  if (!workspacePath) return;

  const confirmDelete = await confirm({
    message: `Are you absolutely sure you want to delete the workspace "${workspaceName}"?\n  This will FORCE remove all associated git worktrees and delete the folder from disk.`,
    default: false,
  });

  if (!confirmDelete) {
    console.log(chalk.yellow('\nCancelled.\n'));
    return;
  }

  const spinner = ora('Deleting workspace and pruning git worktrees...').start();

  try {
    await deleteWorkspace(workspacePath);
    spinner.succeed(`Successfully deleted workspace ${chalk.bold(workspaceName)}`);
    console.log();
  } catch (error) {
    spinner.fail(`Failed to delete workspace ${workspaceName}`);
    console.error(chalk.red(`  ${error instanceof Error ? error.message : String(error)}`));
    console.log();
  }
}
