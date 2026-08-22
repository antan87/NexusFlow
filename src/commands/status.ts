/**
 * @module commands/status
 * Shows the status of all services in a workspace.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { getServiceStatus, loadRunningState } from '../orchestration/index.js';

/**
 * Shows status of running services for a workspace.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 * @param options      - Command options including --json.
 */
export async function statusCommand(workspaceArg?: string, options?: { json?: boolean }): Promise<void> {
  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  if (options?.json) {
    const runningState = await loadRunningState(workspacePath);
    console.log(JSON.stringify(runningState, null, 2));
    return;
  }

  console.log(chalk.bold.cyan('\n📊 NexusFlow — Service Status\n'));
  await getServiceStatus(workspacePath);
  console.log();
}

/**
 * Resolves a workspace path from argument, cwd, or user prompt.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) return workspaceArg;

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return cwdFeature.workspacePath;

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
