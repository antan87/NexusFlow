/**
 * @module commands/stop
 * Stops all running services in the current or specified workspace.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import {
  detectOrchestrationTools,
  readRawRunningState,
  stopOrchestrator,
  stopServices,
} from '../orchestration/index.js';

/**
 * Stop all services — and any started orchestration tools — for a workspace.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 */
export async function stopCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan('\n⏹ NexusFlow — Stop Services\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  await stopServices(workspacePath);

  // Stop any recorded orchestrators (re-detect to get their stop invocation).
  // Read the RAW state, not the PM2-reconciled view, so a crashed pm2-mode
  // orchestrator (which loadRunningState hides) is still torn down and cleared.
  const state = await readRawRunningState(workspacePath);
  const orchestrators = state?.orchestrators ?? [];
  if (orchestrators.length > 0) {
    const tools = await detectOrchestrationTools(workspacePath);
    for (const running of orchestrators) {
      const detection = tools.find((t) => t.id === running.id);
      if (!detection) {
        console.log(chalk.yellow(`  ⚠ ${running.tool} (${running.id}) is recorded as running but no longer detected — skipping.`));
        continue;
      }
      console.log(chalk.dim(`  Stopping ${running.tool}...`));
      await stopOrchestrator(detection, workspacePath);
    }
  }

  console.log(chalk.bold.green('\n✅ All services stopped.\n'));
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
    message: 'Select a workspace to stop services for:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
