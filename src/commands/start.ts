/**
 * @module commands/start
 * Starts all services in the current or specified workspace.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { select, confirm } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import {
  detectAllServices,
  detectOrchestrationTools,
  startServices,
  startOrchestrator,
} from '../orchestration/index.js';

import { BRAND_NAME, CLI_NAME, PRIMARY_LOGS_DIR } from '../core/constants.js';

/**
 * Start services for a workspace.
 * If run inside a workspace dir, auto-detects it.
 * Otherwise, prompts user to pick one.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 */
export async function startCommand(workspaceArg?: string): Promise<void> {
  console.log(chalk.bold.cyan(`\n▶ ${BRAND_NAME} — Start Services\n`));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  // Check for existing orchestration tools first
  const tools = await detectOrchestrationTools(workspacePath);
  if (tools.length > 0) {
    console.log(chalk.cyan('Detected orchestration tools:'));
    for (const tool of tools) {
      console.log(`  ${chalk.bold(tool.tool)} — ${chalk.dim(tool.configPath)}`);
      console.log(`    Start: ${chalk.dim(tool.startCommand)}`);
    }

    const useExisting = await confirm({
      message: `Use detected orchestration tool instead of ${BRAND_NAME} runner?`,
      default: false,
    });

    if (useExisting) {
      const tool = tools.length === 1
        ? tools[0]!
        : await select({
            message: 'Which orchestration tool?',
            choices: tools.map((t) => ({ name: `${t.tool} — ${t.configPath}`, value: t })),
          });

      const logDir = path.join(workspacePath, PRIMARY_LOGS_DIR);
      try {
        await startOrchestrator(tool, workspacePath, logDir);
        console.log(chalk.bold.green(`\n✅ ${tool.tool} started.`));
        console.log(chalk.dim(`  Stop with:  ${CLI_NAME} stop\n`));
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  ✖ Failed to start ${tool.tool}: ${msg}`));
        process.exitCode = 1;
      }
      return;
    }
  }

  // Auto-detect services
  console.log(chalk.cyan('Detecting services...'));
  const services = await detectAllServices(workspacePath);

  if (services.length === 0) {
    console.log(chalk.yellow('  No startable services found in workspace.'));
    console.log(chalk.dim('  Make sure projects have package.json scripts, .csproj, or similar.\n'));
    return;
  }

  console.log(chalk.green(`  Found ${services.length} service(s):\n`));
  for (const svc of services) {
    const portStr = svc.port ? chalk.dim(` :${svc.port}`) : '';
    console.log(`  ${chalk.bold(svc.name)}${portStr} — ${chalk.dim(`${svc.command} ${svc.args.join(' ')}`)}`);
  }
  console.log();

  const shouldStart = await confirm({
    message: `Start ${services.length} service(s)?`,
    default: true,
  });

  if (!shouldStart) {
    console.log(chalk.dim('  Cancelled.\n'));
    return;
  }

  const logDir = path.join(workspacePath, PRIMARY_LOGS_DIR);
  await startServices(services, workspacePath, logDir);

  console.log(chalk.bold.green('\n✅ Services started!\n'));
  console.log(chalk.dim(`  View logs:  ${CLI_NAME} logs`));
  console.log(chalk.dim(`  Stop all:   ${CLI_NAME} stop`));
  console.log(chalk.dim(`  Log dir:    ${logDir}\n`));
}

/**
 * Resolves a workspace path from argument, cwd, or user prompt.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  // If argument provided, use it
  if (workspaceArg) return workspaceArg;

  // Check if CWD is a workspace
  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return cwdFeature.workspacePath;

  // Otherwise, list workspaces and let user pick
  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.'));
    console.log(chalk.dim('  Run "nexusflow create" first.\n'));
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
