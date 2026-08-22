/**
 * @module commands/schedule
 * CLI for managing recurring workspace jobs (sync/refresh schedules).
 *
 * Jobs execute inside a long-running NexusFlow process — start one with
 * `nexusflow ui` (optionally `--daemon --server-only`). `schedule run`
 * executes a job immediately in the current process.
 */

import chalk from 'chalk';
import { select } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import {
  addSchedule,
  formatInterval,
  loadSchedules,
  nextDueAt,
  parseInterval,
  removeSchedule,
  runJob,
  setScheduleEnabled,
  type ScheduleTask,
} from '../core/scheduler.js';
import { findActiveServerPort } from './ui.js';

/**
 * Adds a recurring job for a workspace.
 *
 * @param workspaceArg - Optional workspace path from CLI.
 * @param options      - Task type and interval, e.g. { task: 'sync', every: '2h' }.
 */
export async function scheduleAddCommand(
  workspaceArg: string | undefined,
  options: { task?: string; every?: string },
): Promise<void> {
  console.log(chalk.bold.cyan('\n🕐 NexusFlow — Schedule a Recurring Job\n'));

  const task = (options.task || 'sync') as ScheduleTask;
  if (task !== 'sync' && task !== 'refresh') {
    console.error(chalk.red(`✖ Unknown task "${options.task}". Use "sync" or "refresh".`));
    return;
  }

  const intervalMinutes = parseInterval(options.every || '');
  if (!intervalMinutes) {
    console.error(chalk.red(`✖ Invalid interval "${options.every}". Use forms like 30m, 2h, or 1d.`));
    return;
  }

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const job = await addSchedule({ workspacePath, task, intervalMinutes });

  console.log(chalk.green(`✅ Scheduled ${chalk.bold(task)} every ${chalk.bold(formatInterval(intervalMinutes))} for ${chalk.bold(path.basename(workspacePath))}`));
  console.log(chalk.dim(`  Job id: ${job.id}`));
  console.log(chalk.dim('  Jobs run while a NexusFlow server is active — start one with "nexusflow ui" (e.g. --daemon --server-only).'));
  console.log(chalk.dim('  Scheduled runs are token-efficient: only repos whose content changed are re-analyzed.\n'));
}

/**
 * Lists all scheduled jobs with their status and next due time.
 */
export async function scheduleListCommand(options?: { json?: boolean }): Promise<void> {
  const store = await loadSchedules();
  const activePort = await findActiveServerPort();

  if (options?.json) {
    console.log(JSON.stringify({ jobs: store.jobs, serverActive: activePort !== null, serverPort: activePort }, null, 2));
    return;
  }

  console.log(chalk.bold.cyan('\n🕐 NexusFlow — Scheduled Jobs\n'));

  if (!activePort) {
    console.log(chalk.yellow('⚠️  Notice: The NexusFlow background server is not currently active.'));
    console.log(chalk.dim('   Jobs are dormant until started with: nexusflow ui --daemon\n'));
  } else {
    console.log(chalk.green(`✔ NexusFlow background server is active (port ${activePort}).\n`));
  }

  if (store.jobs.length === 0) {
    console.log(chalk.yellow('No scheduled jobs. Add one with:'));
    console.log(chalk.dim('  nexusflow schedule add [workspace] --task sync --every 2h\n'));
    return;
  }

  for (const job of store.jobs) {
    const state = job.enabled ? chalk.green('enabled') : chalk.yellow('disabled');
    console.log(`${chalk.bold(job.id)} ${chalk.dim(`(${state})`)}`);
    console.log(`  Workspace: ${path.basename(job.workspacePath)} ${chalk.dim(job.workspacePath)}`);
    console.log(`  Task: ${chalk.cyan(job.task)} every ${chalk.cyan(formatInterval(job.intervalMinutes))}`);

    if (job.lastRunAt) {
      const icon = job.lastStatus === 'success' ? chalk.green('✅') : chalk.red('❌');
      console.log(`  Last run: ${icon} ${job.lastRunAt}${job.lastMessage ? chalk.dim(` — ${job.lastMessage}`) : ''}`);
    } else {
      console.log(chalk.dim('  Last run: never'));
    }

    const due = nextDueAt(job);
    if (due) {
      const overdue = due.getTime() <= Date.now();
      console.log(`  Next due: ${overdue ? chalk.yellow('now (runs on next scheduler tick)') : due.toISOString()}`);
    }
    console.log();
  }

  console.log(chalk.dim('Jobs run while a NexusFlow server is active ("nexusflow ui"). Use "nexusflow schedule run <id>" to run one immediately.\n'));
}

/**
 * Removes a scheduled job by id.
 */
export async function scheduleRemoveCommand(id: string): Promise<void> {
  const removed = await removeSchedule(id);
  if (removed) {
    console.log(chalk.green(`✅ Removed schedule ${chalk.bold(id)}\n`));
  } else {
    console.error(chalk.red(`✖ No schedule found with id "${id}". Run "nexusflow schedule list" to see ids.\n`));
  }
}

/**
 * Enables or disables a scheduled job by id.
 */
export async function scheduleToggleCommand(id: string, enabled: boolean): Promise<void> {
  const job = await setScheduleEnabled(id, enabled);
  if (job) {
    console.log(chalk.green(`✅ ${enabled ? 'Enabled' : 'Disabled'} schedule ${chalk.bold(id)}\n`));
  } else {
    console.error(chalk.red(`✖ No schedule found with id "${id}". Run "nexusflow schedule list" to see ids.\n`));
  }
}

/**
 * Runs a scheduled job immediately in the current process.
 */
export async function scheduleRunCommand(id: string): Promise<void> {
  const store = await loadSchedules();
  const job = store.jobs.find((j) => j.id === id);
  if (!job) {
    console.error(chalk.red(`✖ No schedule found with id "${id}". Run "nexusflow schedule list" to see ids.\n`));
    return;
  }

  console.log(chalk.bold.cyan(`\n🕐 Running ${job.task} for ${path.basename(job.workspacePath)}...\n`));
  const result = await runJob(job);

  if (result.status === 'success') {
    console.log(chalk.green(`\n✅ ${result.message}\n`));
  } else {
    console.error(chalk.red(`\n❌ ${result.message}\n`));
  }
}

/**
 * Resolves a workspace path from argument, cwd, or user prompt.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) {
    const absolutePath = path.resolve(workspaceArg);
    try {
      await fs.access(path.join(absolutePath, 'nexusflow.json'));
      return absolutePath;
    } catch {
      console.error(chalk.red(`✖ Invalid workspace: No nexusflow.json found at ${absolutePath}`));
      return null;
    }
  }

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return cwdFeature.workspacePath;

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace to schedule:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
