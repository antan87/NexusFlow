/**
 * @module core/scheduler
 * Recurring workspace jobs — periodic `sync` and `refresh` runs per workspace.
 *
 * Job definitions are persisted at `~/.nexusflow/schedules.json` and executed
 * by any long-running NexusFlow process (the dashboard server started with
 * `nexusflow ui` runs the scheduler automatically). Jobs use the headless
 * cores (`syncWorkspace`, `refreshWorkspace`), which are cache-aware: a
 * scheduled run only re-analyzes repos whose content changed, so unattended
 * schedules stay token-efficient and never churn unchanged context files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getConfigDir, ensureConfigDir } from './config.js';
import { syncWorkspace } from './sync.js';
import { refreshWorkspace } from './refresh.js';

/** Name of the schedules file inside ~/.nexusflow. */
const SCHEDULES_FILE = 'schedules.json';

/** Kinds of work a schedule can run. */
export type ScheduleTask = 'sync' | 'refresh';

/** A persisted recurring job definition. */
export interface ScheduledJob {
  /** Unique job id, e.g. 'sync-my-feature-k3x9q2'. */
  id: string;
  /** Absolute path to the workspace the job operates on. */
  workspacePath: string;
  /** What the job runs. */
  task: ScheduleTask;
  /** How often the job runs, in minutes. */
  intervalMinutes: number;
  /** Disabled jobs are kept but never run. */
  enabled: boolean;
  /** ISO timestamp of when the job was created. */
  createdAt: string;
  /** ISO timestamp of the last run, if any. */
  lastRunAt?: string;
  /** Outcome of the last run. */
  lastStatus?: 'success' | 'error';
  /** Human-readable summary of the last run. */
  lastMessage?: string;
}

/** On-disk shape of the schedules file. */
export interface ScheduleStore {
  version: 1;
  jobs: ScheduledJob[];
}

/** Result of running a single job. */
export interface JobRunResult {
  status: 'success' | 'error';
  message: string;
}

/**
 * Returns the path to the schedules file (~/.nexusflow/schedules.json).
 */
export function getSchedulesPath(): string {
  return path.join(getConfigDir(), SCHEDULES_FILE);
}

/**
 * Loads all schedules, returning an empty store when the file does not exist
 * or cannot be parsed.
 */
export async function loadSchedules(): Promise<ScheduleStore> {
  try {
    const raw = await fs.readFile(getSchedulesPath(), 'utf-8');
    const store = JSON.parse(raw) as ScheduleStore;
    if (!Array.isArray(store.jobs)) {
      store.jobs = [];
    }
    return store;
  } catch {
    return { version: 1, jobs: [] };
  }
}

/**
 * Persists the schedule store to ~/.nexusflow/schedules.json.
 */
export async function saveSchedules(store: ScheduleStore): Promise<void> {
  await ensureConfigDir();
  const data = JSON.stringify(store, null, 2) + '\n';
  await fs.writeFile(getSchedulesPath(), data, 'utf-8');
}

/**
 * Parses a human interval like '30m', '2h', '1d', or a bare minute count
 * ('45') into minutes. Returns null for unparseable or non-positive input.
 */
export function parseInterval(text: string): number | null {
  const match = String(text).trim().match(/^(\d+)\s*([mhd]?)$/i);
  if (!match) return null;

  const value = parseInt(match[1]!, 10);
  if (value <= 0) return null;

  switch ((match[2] || 'm').toLowerCase()) {
    case 'h':
      return value * 60;
    case 'd':
      return value * 60 * 24;
    default:
      return value;
  }
}

/**
 * Formats an interval in minutes back to a compact human string.
 */
export function formatInterval(minutes: number): string {
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/**
 * Whether a job is due to run: it is enabled and either never ran or its
 * interval has elapsed since the last run. A job whose interval elapsed while
 * no scheduler was running simply runs on the next tick.
 */
export function isDue(job: ScheduledJob, now: Date = new Date()): boolean {
  if (!job.enabled) return false;
  if (!job.lastRunAt) return true;

  const last = Date.parse(job.lastRunAt);
  if (Number.isNaN(last)) return true;

  return now.getTime() - last >= job.intervalMinutes * 60_000;
}

/**
 * Computes when a job will next be due, for display purposes.
 */
export function nextDueAt(job: ScheduledJob): Date | null {
  if (!job.enabled) return null;
  if (!job.lastRunAt) return new Date();
  const last = Date.parse(job.lastRunAt);
  if (Number.isNaN(last)) return new Date();
  return new Date(last + job.intervalMinutes * 60_000);
}

/**
 * Adds a new schedule and persists it.
 *
 * @param input - Workspace, task, and interval for the new job.
 * @returns The created job.
 */
export async function addSchedule(input: {
  workspacePath: string;
  task: ScheduleTask;
  intervalMinutes: number;
}): Promise<ScheduledJob> {
  const store = await loadSchedules();

  const workspaceName = path.basename(input.workspacePath);
  const job: ScheduledJob = {
    id: `${input.task}-${workspaceName}-${Date.now().toString(36)}`,
    workspacePath: input.workspacePath,
    task: input.task,
    intervalMinutes: input.intervalMinutes,
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  store.jobs.push(job);
  await saveSchedules(store);
  return job;
}

/**
 * Removes a schedule by id. Returns false when no job matched.
 */
export async function removeSchedule(id: string): Promise<boolean> {
  const store = await loadSchedules();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((j) => j.id !== id);
  if (store.jobs.length === before) return false;
  await saveSchedules(store);
  return true;
}

/**
 * Enables or disables a schedule by id. Returns the updated job, or null
 * when no job matched.
 */
export async function setScheduleEnabled(
  id: string,
  enabled: boolean,
): Promise<ScheduledJob | null> {
  const store = await loadSchedules();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return null;
  job.enabled = enabled;
  await saveSchedules(store);
  return job;
}

/**
 * Runs a single job immediately and records the outcome in the store.
 * Never throws — failures are captured in the returned result.
 *
 * @param job - The job to run.
 * @returns The classified outcome with a summary message.
 */
export async function runJob(job: ScheduledJob): Promise<JobRunResult> {
  let result: JobRunResult;

  try {
    if (job.task === 'sync') {
      const report = await syncWorkspace(job.workspacePath);
      const parts = [`${report.syncedCount} synced`];
      if (report.conflictCount > 0) parts.push(`${report.conflictCount} conflict(s)`);
      if (report.errorCount > 0) parts.push(`${report.errorCount} error(s)`);
      parts.push(report.contextRefreshed ? 'context refreshed' : 'context unchanged');
      result = {
        status: report.conflictCount > 0 || report.errorCount > 0 ? 'error' : 'success',
        message: parts.join(', '),
      };
    } else {
      const report = await refreshWorkspace(job.workspacePath);
      result = {
        status: 'success',
        message: `${report.analyzedRepos.length} repo(s) re-analyzed, ${report.reusedRepos.length} reused from cache`,
      };
    }
  } catch (error) {
    result = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // Record the run. Re-load the store so concurrent CLI edits are not lost.
  try {
    const store = await loadSchedules();
    const stored = store.jobs.find((j) => j.id === job.id);
    if (stored) {
      stored.lastRunAt = new Date().toISOString();
      stored.lastStatus = result.status;
      stored.lastMessage = result.message;
      await saveSchedules(store);
    }
  } catch {
    // Best-effort bookkeeping; the job itself already ran.
  }

  return result;
}

/**
 * Starts the scheduler loop inside the current process. Every tick it
 * re-loads the schedules file (so jobs added/removed via CLI are picked up
 * without a restart) and runs all due jobs sequentially. Ticks never overlap.
 *
 * @param options - Tick interval (default 60s) and an optional log sink.
 * @returns A stop function that clears the interval.
 */
export function startScheduler(options: {
  tickMs?: number;
  log?: (message: string) => void;
} = {}): () => void {
  const tickMs = options.tickMs ?? 60_000;
  const log = options.log ?? (() => {});
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const store = await loadSchedules();
      for (const job of store.jobs) {
        if (!isDue(job)) continue;
        log(`Running scheduled ${job.task} for ${path.basename(job.workspacePath)} (${job.id})...`);
        const result = await runJob(job);
        log(`Scheduled ${job.task} ${result.status === 'success' ? 'completed' : 'failed'}: ${result.message}`);
      }
    } catch {
      // A broken schedules file must not kill the host process's timer.
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, tickMs);
  // Don't let the scheduler keep a short-lived CLI process alive.
  timer.unref?.();
  // First tick runs immediately so overdue jobs don't wait a full interval.
  void tick();

  return () => clearInterval(timer);
}
