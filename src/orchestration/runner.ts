/**
 * @module orchestration/runner
 * Manages the lifecycle of services — start, stop, status, and log streaming.
 * Uses PM2 for process management.
 */

import { createHash } from 'node:crypto';
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

/** Stable, collision-free 8-char hash of the absolute workspace path. */
export function workspaceHash(workspacePath: string): string {
  return createHash('sha256').update(path.resolve(workspacePath)).digest('hex').slice(0, 8);
}

/** Workspace PM2 prefix embedding the workspace hash to eliminate prefix over-matching. */
export function pm2Prefix(workspacePath: string): string {
  const base = path.basename(workspacePath).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 24);
  return `nexusflow-${base}-${workspaceHash(workspacePath)}-`;
}

/** PM2 app name for a workspace service: `nexusflow-<base>-<hash>-<name>`. */
export function pm2AppName(workspacePath: string, serviceName: string): string {
  return `${pm2Prefix(workspacePath)}${serviceName}`;
}

/**
 * Log file for a service. Service names may contain '/' (nested packages,
 * e.g. `repo/sub`), which maps to a nested path under the log dir.
 */
export function serviceLogFile(logDir: string, serviceName: string): string {
  return path.join(logDir, `${serviceName}.log`);
}

/**
 * Launches a command under PM2 using the shared NexusFlow launch shape: delete
 * any same-named app first (idempotent restart), then start it with stdout and
 * stderr wired to a single log file and no interpreter (run the binary
 * directly). Shared by service and orchestrator starts so their logging and
 * restart behavior can never drift apart.
 */
export async function pm2Start(opts: {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  logFile: string;
}): Promise<void> {
  await execa('npx', ['pm2', 'delete', opts.name], { reject: false });
  await execa('npx', [
    'pm2',
    'start',
    opts.command,
    '--name',
    opts.name,
    '--cwd',
    opts.cwd,
    '-o',
    opts.logFile,
    '-e',
    opts.logFile,
    '--interpreter',
    'none',
    '--',
    ...opts.args,
  ]);
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
 * Reads the raw on-disk running state without reconciling it against PM2.
 * Callers that need the full recorded set — e.g. the stop path, which must
 * still tear down a crashed orchestrator that {@link loadRunningState} hides —
 * use this instead of the reconciled view.
 *
 * @param workspacePath - Workspace root path.
 */
export async function readRawRunningState(workspacePath: string): Promise<RunningState | null> {
  try {
    return JSON.parse(await fs.readFile(getStatePath(workspacePath), 'utf-8')) as RunningState;
  } catch {
    return null;
  }
}

/**
 * Loads the running state from disk, syncing active status with PM2. Services
 * and pm2-mode orchestrators are verified against the live PM2 process list and
 * dropped when no longer online (crashed or stopped outside NexusFlow), so the
 * Services tab and dashboard count never show a phantom-running process.
 * One-shot tools (docker compose up -d) have no PM2 app or PID to verify; they
 * are passed through and cleared on explicit stop.
 *
 * @param workspacePath - Workspace root path.
 * @param pm2List - Optional pre-fetched `pm2 jlist` output (see {@link getPm2List}).
 */
export async function loadRunningState(workspacePath: string, pm2List?: any[]): Promise<RunningState | null> {
  const state = await readRawRunningState(workspacePath);
  if (!state) return null;

  try {
    // Query current PM2 process list to verify actual running status.
    const list = pm2List ?? await getPm2List();
    const isOnline = (name: string): boolean => {
      const app = list.find((a: any) => a.name === name);
      return !!app && app.pm2_env?.status === 'online';
    };

    const activeServices = state.services.map((service) => {
      const uniqueName = pm2AppName(workspacePath, service.name);
      const pm2App = list.find((app: any) => app.name === uniqueName);
      const running = pm2App && pm2App.pm2_env?.status === 'online';
      return {
        ...service,
        pid: running ? (pm2App.pid || service.pid) : 0,
      };
    }).filter((service) => service.pid > 0);

    const orchestrators = state.orchestrators?.filter(
      (o) => o.mode !== 'pm2' || !o.pm2Name || isOnline(o.pm2Name),
    );

    return {
      ...state,
      services: activeServices,
      orchestrators,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    // Fallback to cached state on disk if PM2 query fails.
    return state;
  }
}

// ─── State mutation (serialized per workspace) ────────────────────────────────

/** Per-workspace promise chains so concurrent mutations never lose writes. */
const stateQueues = new Map<string, Promise<void>>();

/**
 * Applies a read-modify-write mutation to the raw on-disk running state,
 * serialized per workspace. The mutator receives the current state (a fresh
 * empty one when no file exists) and returns the state to persist; when both
 * services and orchestrators end up empty, the file is removed instead.
 */
export async function mutateRunningState(
  workspacePath: string,
  mutator: (state: RunningState) => RunningState,
): Promise<void> {
  const previous = stateQueues.get(workspacePath) ?? Promise.resolve();
  const next = previous.then(async () => {
    let state: RunningState;
    try {
      state = JSON.parse(await fs.readFile(getStatePath(workspacePath), 'utf-8')) as RunningState;
    } catch {
      state = { workspacePath, services: [], updatedAt: new Date().toISOString() };
    }

    const updated = mutator(state);
    updated.updatedAt = new Date().toISOString();

    if (updated.services.length === 0 && (updated.orchestrators?.length ?? 0) === 0) {
      await fs.unlink(getStatePath(workspacePath)).catch(() => {});
      return;
    }
    await fs.writeFile(getStatePath(workspacePath), JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  });
  // Keep the chain alive even when a link fails.
  stateQueues.set(workspacePath, next.catch(() => {}));
  return next;
}

// ─── Per-service lifecycle ────────────────────────────────────────────────────

/**
 * Starts ONE service under PM2 (deleting any same-named app first), resolves
 * its PID, and upserts it into the running state. Returns the running entry,
 * or null when the start failed or the PID could not be resolved.
 */
export async function startService(
  service: ServiceConfig,
  workspacePath: string,
  logDir: string,
): Promise<RunningService | null> {
  const logFile = serviceLogFile(logDir, service.name);
  const uniqueName = pm2AppName(workspacePath, service.name);
  const portStr = service.port ? ` on port ${service.port}` : '';

  console.log(chalk.cyan(`  Starting ${chalk.bold(service.name)}${portStr} under PM2...`));
  console.log(chalk.dim(`    ${service.command} ${service.args.join(' ')} (in ${service.cwd})`));

  try {
    await fs.mkdir(path.dirname(logFile), { recursive: true });

    // Start under PM2 (pre-deletes any same-named app), wiring stdout+stderr to
    // the service log via the shared launch shape.
    await pm2Start({
      name: uniqueName,
      command: service.command,
      args: service.args,
      cwd: service.cwd,
      logFile,
    });

    // Retrieve the real PID from PM2
    const pm2List = await getPm2List();
    const pm2App = pm2List.find((app: any) => app.name === uniqueName);
    const pid = pm2App?.pid || 0;

    if (!pid) {
      console.warn(chalk.yellow(`  ⚠ Started ${service.name} but could not resolve PID from PM2.`));
      return null;
    }

    const running: RunningService = {
      name: service.name,
      pid,
      config: service,
      startedAt: new Date().toISOString(),
    };
    await mutateRunningState(workspacePath, (state) => ({
      ...state,
      services: [...state.services.filter((s) => s.name !== service.name), running],
    }));
    console.log(chalk.green(`  ✔ ${service.name} started under PM2 (PID: ${pid})`));
    return running;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ✖ Failed to start ${service.name} via PM2: ${msg}`));
    return null;
  }
}

/**
 * Stops ONE service: deletes its PM2 app and removes it from the running
 * state. Returns whether a PM2 app or state entry existed for it.
 */
export async function stopService(workspacePath: string, serviceName: string): Promise<boolean> {
  const uniqueName = pm2AppName(workspacePath, serviceName);

  let existed = false;
  const pm2List = await getPm2List();
  if (pm2List.some((app: any) => app.name === uniqueName)) {
    existed = true;
    await execa('npx', ['pm2', 'delete', uniqueName], { reject: false });
  }

  await mutateRunningState(workspacePath, (state) => {
    if (state.services.some((s) => s.name === serviceName)) existed = true;
    return { ...state, services: state.services.filter((s) => s.name !== serviceName) };
  });

  return existed;
}

/**
 * Restarts ONE service. PM2 starts pre-delete the app, so this is startService
 * — kept as a named export for endpoint and UI clarity.
 */
export async function restartService(
  service: ServiceConfig,
  workspacePath: string,
  logDir: string,
): Promise<RunningService | null> {
  return startService(service, workspacePath, logDir);
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
  await fs.mkdir(logDir, { recursive: true });
  for (const service of services) {
    await startService(service, workspacePath, logDir);
  }
}

/**
 * Stops all services for a workspace under PM2. Orchestrator entries in the
 * running state are preserved — they are stopped separately.
 *
 * @param workspacePath - Workspace root path.
 */
export async function stopServices(workspacePath: string): Promise<void> {
  const workspaceId = path.basename(workspacePath);
  const prefix = pm2Prefix(workspacePath);

  console.log(chalk.cyan(`  Stopping all services under PM2 for workspace: ${workspaceId}...`));

  // Never tear down a recorded orchestrator as part of a service stop-all —
  // they are stopped separately. Exclude their PM2 app names by exact match
  // (not by an `orch-` name prefix) so a service literally named `orch-*` is
  // still stopped.
  const raw = await readRawRunningState(workspacePath);
  const orchNames = new Set(
    (raw?.orchestrators ?? [])
      .map((o) => o.pm2Name)
      .filter((n): n is string => typeof n === 'string'),
  );

  try {
    const pm2List = await getPm2List();
    const targetApps = pm2List.filter(
      (app: any) => app.name && app.name.startsWith(prefix) && !orchNames.has(app.name),
    );

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

  await mutateRunningState(workspacePath, (state) => ({ ...state, services: [] }));
}

/**
 * Shows the status of all services in a workspace by querying PM2.
 *
 * @param workspacePath - Workspace root path.
 */
export async function getServiceStatus(workspacePath: string): Promise<void> {
  const workspaceId = path.basename(workspacePath);
  const prefix = pm2Prefix(workspacePath);

  try {
    const pm2List = await getPm2List();
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

/** Recursively collects all .log file paths within a directory. */
async function collectLogFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await collectLogFiles(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile() && entry.name.endsWith('.log')) {
        results.push(fullPath);
      }
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      console.warn(chalk.yellow(`  Warning: could not read directory ${dir}: ${error?.message || error}`));
    }
  }
  return results.sort((a, b) => a.localeCompare(b));
}

/**
 * Tails log files for all services in a workspace, including nested services.
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
  const logFiles = await collectLogFiles(logDir);
  if (logFiles.length === 0) {
    console.log(chalk.yellow('  No log files found.'));
    return;
  }

  for (const filePath of logFiles) {
    const rel = path.relative(logDir, filePath);
    const serviceName = rel.replace(/\.log$/i, '').replace(/\\/g, '/');

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
      console.log(chalk.dim(`  Could not read ${rel}`));
    }
  }
}
