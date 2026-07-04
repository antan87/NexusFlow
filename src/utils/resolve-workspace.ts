/**
 * @module utils/resolve-workspace
 * Shared workspace-path resolution used by commands. Replaces the near-identical
 * private `resolveWorkspace` helpers previously copied across commit/diff/finish
 * and other commands.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';

/**
 * Resolves a workspace path without any interactive prompts.
 *
 * Resolution order: explicit argument → workspace detected from the current
 * working directory → `null`.
 *
 * @param workspaceArg - Optional explicit workspace path.
 * @returns Absolute workspace path, or `null` when none can be determined.
 * @throws If an explicit `workspaceArg` is given but has no `nexusflow.json`.
 */
export async function resolveWorkspaceQuiet(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) {
    const absolutePath = path.resolve(workspaceArg);
    try {
      await fs.access(path.join(absolutePath, 'nexusflow.json'));
      return absolutePath;
    } catch {
      throw new Error(`Invalid workspace: No nexusflow.json found at ${absolutePath}`);
    }
  }

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) {
    return cwdFeature.workspacePath;
  }

  return null;
}

/**
 * Resolves a workspace path, falling back to an interactive picker when it
 * cannot be determined from the argument or the current directory.
 *
 * Prints friendly errors (and returns `null`) rather than throwing, so callers
 * can simply `return` when the result is `null`.
 *
 * @param workspaceArg - Optional explicit workspace path.
 * @param promptMessage - Prompt shown when picking from the workspace list.
 * @returns Absolute workspace path, or `null` when unavailable/none selected.
 */
export async function resolveWorkspaceInteractive(
  workspaceArg: string | undefined,
  promptMessage: string,
): Promise<string | null> {
  try {
    const quiet = await resolveWorkspaceQuiet(workspaceArg);
    if (quiet) {
      return quiet;
    }
  } catch (error) {
    console.error(chalk.red(`✖ ${error instanceof Error ? error.message : String(error)}`));
    return null;
  }

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: promptMessage,
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
