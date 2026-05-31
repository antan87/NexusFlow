/**
 * @module orchestration/runner
 * Manages the lifecycle of services — start, stop, status, and log streaming.
 * Spawns child processes and tracks them via a state file.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import chalk from 'chalk';

import type { ServiceConfig, RunningService, RunningState } from '../types.js';

/** Name of the state file that tracks running services. */
const STATE_FILE = '.nexusflow-running.json';

/** Active child processes tracked in memory. */
const activeProcesses = new Map<string, ChildProcess>();

/**
 * Returns the path to the running-state file for a workspace.
 */
function getStatePath(workspacePath: string): string {
  return path.join(workspacePath, STATE_FILE);
}

/**
 * Loads the running state from disk.
 */
export async function loadRunningState(workspacePath: string): Promise<RunningState | null> {
  try {
    const raw = await fs.readFile(getStatePath(workspacePath), 'utf-8');
    return JSON.parse(raw) as RunningState;
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
 * Checks if a process with the given PID is still running.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts all services in the given list.
 * Each service is spawned as a detached child process.
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

  for (const service of services) {
    const logFile = path.join(logDir, `${service.name}.log`);
    const portStr = service.port ? ` on port ${service.port}` : '';

    console.log(
      chalk.cyan(`  Starting ${chalk.bold(service.name)}${portStr}...`),
    );
    console.log(
      chalk.dim(`    ${service.command} ${service.args.join(' ')} (in ${service.cwd})`),
    );

    try {
      // Ensure parent directory for this log file exists (supports nested names)
      await fs.mkdir(path.dirname(logFile), { recursive: true });
      // Open log file for writing
      const logFd = await fs.open(logFile, 'w');
      const logStream = logFd.createWriteStream();

      const child = spawn(service.command, service.args, {
        cwd: service.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        shell: true,
      });

      // Pipe stdout and stderr to log file
      child.stdout?.pipe(logStream);
      child.stderr?.pipe(logStream);

      child.on('error', (err) => {
        console.error(chalk.red(`  ✖ ${service.name} error: ${err.message}`));
      });

      child.on('exit', (code) => {
        if (code !== null && code !== 0) {
          console.log(chalk.yellow(`  ⚠ ${service.name} exited with code ${code}`));
        }
        activeProcesses.delete(service.name);
      });

      // Don't wait for the child to finish
      child.unref();

      if (child.pid) {
        activeProcesses.set(service.name, child);
        runningServices.push({
          name: service.name,
          pid: child.pid,
          config: service,
          startedAt: new Date().toISOString(),
        });
        console.log(chalk.green(`  ✔ ${service.name} started (PID: ${child.pid})`));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`  ✖ Failed to start ${service.name}: ${msg}`));
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
 * Stops all services for a workspace.
 *
 * @param workspacePath - Workspace root path.
 */
export async function stopServices(workspacePath: string): Promise<void> {
  const state = await loadRunningState(workspacePath);

  if (!state || state.services.length === 0) {
    console.log(chalk.yellow('  No running services found.'));
    return;
  }

  for (const service of state.services) {
    // Try in-memory process first
    const child = activeProcesses.get(service.name);
    if (child && child.pid) {
      try {
        // Kill the process group (negative PID kills group on Unix, taskkill on Windows)
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(-child.pid, 'SIGTERM');
        }
        console.log(chalk.green(`  ✔ Stopped ${service.name} (PID: ${service.pid})`));
        activeProcesses.delete(service.name);
        continue;
      } catch {
        // Fall through to PID-based kill
      }
    }

    // Fall back to PID from state file
    if (isProcessRunning(service.pid)) {
      try {
        if (process.platform === 'win32') {
          spawn('taskkill', ['/pid', String(service.pid), '/f', '/t'], { stdio: 'ignore' });
        } else {
          process.kill(service.pid, 'SIGTERM');
        }
        console.log(chalk.green(`  ✔ Stopped ${service.name} (PID: ${service.pid})`));
      } catch {
        console.log(chalk.yellow(`  ⚠ Could not stop ${service.name} (PID: ${service.pid})`));
      }
    } else {
      console.log(chalk.dim(`  ${service.name} already stopped`));
    }
  }

  await clearRunningState(workspacePath);
}

/**
 * Shows the status of all services in a workspace.
 *
 * @param workspacePath - Workspace root path.
 */
export async function getServiceStatus(workspacePath: string): Promise<void> {
  const state = await loadRunningState(workspacePath);

  if (!state || state.services.length === 0) {
    console.log(chalk.yellow('  No services tracked for this workspace.'));
    return;
  }

  for (const service of state.services) {
    const running = isProcessRunning(service.pid);
    const status = running ? chalk.green('● running') : chalk.red('● stopped');
    const portStr = service.config.port ? ` :${service.config.port}` : '';
    const since = new Date(service.startedAt).toLocaleTimeString();

    console.log(
      `  ${status} ${chalk.bold(service.name)}${chalk.dim(portStr)} (PID: ${service.pid}, since ${since})`,
    );
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
