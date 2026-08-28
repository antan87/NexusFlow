/**
 * @module commands/logs
 * Shows aggregated logs from all services in a workspace.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { showLogs, getServiceStatus } from '../orchestration/index.js';
import { BRAND_NAME } from '../core/constants.js';
import { existsSync } from 'node:fs';

/**
 * Shows logs and status for services in a workspace.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 * @param lines        - Number of log lines to show per service.
 */
export async function logsCommand(workspaceArg?: string, lines: number = 30): Promise<void> {
  console.log(chalk.bold.cyan(`\n📋 ${BRAND_NAME} — Service Logs\n`));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  // Show service status first
  console.log(chalk.cyan('Service Status:'));
  await getServiceStatus(workspacePath);

  // Show logs
  const primaryLogDir = path.join(workspacePath, '.contextspace-logs');
  const legacyLogDir = path.join(workspacePath, '.nexusflow-logs');
  const logDir = existsSync(primaryLogDir) ? primaryLogDir : (existsSync(legacyLogDir) ? legacyLogDir : primaryLogDir);
  await showLogs(workspacePath, logDir, lines);

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
    message: 'Select a workspace to view logs for:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
