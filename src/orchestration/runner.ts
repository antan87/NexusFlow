/**
 * @module orchestration/runner
 * Manages the lifecycle of services — start, stop, status, and log streaming.
 * Uses PM2 for process management.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';
import { execa } from 'execa';

import type { ServiceConfig, RunningService, RunningState } from '../types.js';

/** Name of the state file that tracks running services. */
const STATE_FILE = '.nexusflow-running.json';

/**
 * Returns the path to the running-state file for a workspace.
 */
function getStatePath(workspacePath: string): string {
  return path.join(workspacePath, STATE_FILE);
}

/**
 * Parses `pm2 jlist` output defensively. npx/pm2 can emit preamble lines before
 * the JSON array, which would make a bare JSON.parse throw and silently drop us
 * to stale cached state.
 */
export function parsePm2Json(stdout: string): any[] {
  try {
    return JSON.parse(stdout);
  } catch {}
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {}
  }
  return [];
}

/**
 * Runs `pm2 jlist` once and returns the parsed process list (empty on failure).
 * Callers iterating many workspaces should fetch this once and pass it into
 * {@link loadRunningState} to avoid spawning npx per workspace.
 */
export async function getPm2List(): Promise<any[]> {
  try {
    const { stdout } = await execa('npx', ['pm2', 'jlist']);
    return parsePm2Json(stdout);
  } catch {
    return [];
  }
}

/**
 * Loads the running state from disk, syncing active status with PM2.
 *
 * @param workspacePath - Workspace root path.
 * @param pm2List - Optional pre-fetched `pm2 jlist` output (see {@link getPm2List}).
 */
export async function loadRunningState(workspacePath: string, pm2List?: any[]): Promise<RunningState | null> {
  try {
    const raw = await fs.readFile(getStatePath(workspacePath), 'utf-8');
    const state = JSON.parse(raw) as RunningState;

    try {
      // Query current PM2 process list to verify actual running status
      const list = pm2List ?? await getPm2List();
      const workspaceId = path.basename(workspacePath);
      const prefix = `nexusflow-${workspaceId}-`;

      const activeServices = state.services.map((service) => {
        const uniqueName = `${prefix}${service.name}`;
        const pm2App = list.find((app: any) => app.name === uniqueName);
        const running = pm2App && pm2App.pm2_env?.status === 'online';
        return {
          ...service,
          pid: running ? (pm2App.pid || service.pid) : 0,
        };
      }).filter((service) => service.pid > 0);

      return {
        ...state,
        services: activeServices,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      // Fallback to cached state on disk if PM2 query fails
      return state;
    }
  } catch {
    return null;
  }
}

/**
 * Saves the running state to disk.
 */
async function saveRunningState(state: RunningState): Promise<void> {
  const data = JSON.stringify(state, null, 2) + '\n';
  await fs.writeFile(getStatePath(state.workspacePath), data, 'utf-8');
}

/**
 * Clears the running state file.
 */
async function clearRunningState(workspacePath: string): Promise<void> {
  try {
    await fs.unlink(getStatePath(workspacePath));
  } catch {
    // File doesn't exist, that's fine
  }
}

/**
 * Starts all services in the given list using PM2.
 *
 * @param services      - Services to start.
 * @param workspacePath - Workspace root path.
 * @param logDir        - Directory to write log files to.
 */
export async function startServices(
  services: ServiceConfig[],
  workspacePath: string,
  logDir: string,
): Promise<void> {
  // Ensure log directory exists
  await fs.mkdir(logDir, { recursive: true });

  const runningServices: RunningService[] = [];
  const workspaceId = path.basename(workspacePath);

  for (const service of services) {
    const logFile = path.join(logDir, `${service.name}.log`);
    const portStr = service.port ? ` on port ${service.port}` : '';
    const uniqueName = `nexusflow-${workspaceId}-${service.name}`;

    console.log(
      chalk.cyan(`  Starting ${chalk.bold(service.name)}${portStr} under PM2...`),
    );
    console.log(
      chalk.dim(`    ${service.command} ${service.args.join(' ')} (in ${service.cwd})`),
    );

    try {
      // Ensure parent directory for this log file exists
      await fs.mkdir(path.dirname(logFile), { recursive: true });

      // Delete any existing PM2 configuration with the same name to avoid duplicate starts
      await execa('npx', ['pm2', 'delete', uniqueName], { reject: false });

      // Start the service using PM2 as a direct process execution
      await execa('npx', [
        'pm2',
        'start',
        service.command,
        '--name',
        uniqueName,
        '--cwd',
        service.cwd,
        '-o',
        logFile,
        '-e',
        logFile,
        '--interpreter',
        'none',
        '--',
        ...service.args
      ]);

      // Retrieve the real PID from PM2
      const { stdout } = await execa('npx', ['pm2', 'jlist']);
      const pm2List = parsePm2Json(stdout);
      const pm2App = pm2List.find((app: any) => app.name === uniqueName);
      const pid = pm2App?.pid || 0;

      if (pid) {
        runningServices.push({
          name: service.name,
          pid,
          config: service,
          startedAt: new Date().toISOString(),
        });
        console.log(chalk.green(`  ✔ ${service.name} started under PM2 (PID: ${pid})`));
      } else {
        console.warn(chalk.yellow(`  ⚠ Started ${service.name} but could not resolve PID from PM2.`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`  ✖ Failed to start ${service.name} via PM2: ${msg}`));
    }
  }

  // Save state
  if (runningServices.length > 0) {
    await saveRunningState({
      workspacePath,
      services: runningServices,
      updatedAt: new Date().toISOString(),
    });
  }
}

/**
 * Stops all services for a workspace under PM2.
 *
 * @param workspacePath - Workspace root path.
 */
export async function stopServices(workspacePath: string): Promise<void> {
  const workspaceId = path.basename(workspacePath);
  const prefix = `nexusflow-${workspaceId}-`;

  console.log(chalk.cyan(`  Stopping all services under PM2 for workspace: ${workspaceId}...`));

  try {
    const { stdout } = await execa('npx', ['pm2', 'jlist']);
    const pm2List = JSON.parse(stdout);
    const targetApps = pm2List.filter((app: any) => app.name && app.name.startsWith(prefix));

    if (targetApps.length === 0) {
      console.log(chalk.yellow('  No running services found for this workspace.'));
    } else {
      for (const app of targetApps) {
        console.log(chalk.dim(`    Stopping PM2 process: ${app.name}`));
        await execa('npx', ['pm2', 'delete', app.name], { reject: false });
      }
      console.log(chalk.green(`  ✔ All services stopped.`));
    }
  } catch (error: any) {
    console.error(chalk.red(`  ✖ Failed to stop services via PM2: ${error.message}`));
  }

  await clearRunningState(workspacePath);
}

/**
 * Shows the status of all services in a workspace by querying PM2.
 *
 * @param workspacePath - Workspace root path.
 */
export async function getServiceStatus(workspacePath: string): Promise<void> {
  const workspaceId = path.basename(workspacePath);
  const prefix = `nexusflow-${workspaceId}-`;

  try {
    const { stdout } = await execa('npx', ['pm2', 'jlist']);
    const pm2List = JSON.parse(stdout);
    const targetApps = pm2List.filter((app: any) => app.name && app.name.startsWith(prefix));

    if (targetApps.length === 0) {
      console.log(chalk.yellow('  No running services found for this workspace in PM2.'));
      return;
    }

    for (const app of targetApps) {
      const name = app.name.substring(prefix.length);
      const running = app.pm2_env?.status === 'online';
      const status = running ? chalk.green('● running') : chalk.red(`● ${app.pm2_env?.status || 'stopped'}`);
      const pid = app.pid || 'N/A';
      const uptime = app.pm2_env?.pm_uptime ? new Date(app.pm2_env.pm_uptime).toLocaleTimeString() : 'unknown';

      console.log(
        `  ${status} ${chalk.bold(name)} (PID: ${pid}, since ${uptime})`,
      );
    }
  } catch (error: any) {
    console.error(chalk.red(`  ✖ Failed to query PM2 status: ${error.message}`));
  }
}

/**
 * Tails log files for all services in a workspace.
 *
 * @param workspacePath - Workspace root path.
 * @param logDir        - Directory containing log files.
 * @param lines         - Number of lines to show per service.
 */
export async function showLogs(
  workspacePath: string,
  logDir: string,
  lines: number = 20,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(logDir);
  } catch {
    console.log(chalk.yellow('  No log directory found.'));
    return;
  }

  const logFiles = entries.filter((e) => e.endsWith('.log'));
  if (logFiles.length === 0) {
    console.log(chalk.yellow('  No log files found.'));
    return;
  }

  for (const logFile of logFiles) {
    const serviceName = logFile.replace('.log', '');
    const filePath = path.join(logDir, logFile);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const allLines = content.split('\n');
      const tail = allLines.slice(-lines).join('\n');

      console.log(chalk.bold.cyan(`\n─── ${serviceName} ───`));
      if (tail.trim()) {
        console.log(tail);
      } else {
        console.log(chalk.dim('  (no output yet)'));
      }
    } catch {
      console.log(chalk.dim(`  Could not read ${logFile}`));
    }
  }
}
