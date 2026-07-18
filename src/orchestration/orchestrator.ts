/**
 * @module orchestration/orchestrator
 * Executes detected orchestration tools (docker-compose, Aspire, Tilt,
 * Procfile, Makefile). Only the structured `run`/`stopRun` invocations from
 * detection are ever executed — never display strings, never client input.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import type { OrchestrationDetection, RunningOrchestrator } from '../types.js';
import { getPm2List, mutateRunningState, serviceLogFile } from './runner.js';

/** PM2 app name for a pm2-mode orchestrator: `nexusflow-<ws>-orch-<tool>`. */
export function orchestratorPm2Name(workspacePath: string, tool: string): string {
  return `nexusflow-${path.basename(workspacePath)}-orch-${tool}`;
}

/** Log source name for a pm2-mode orchestrator (tailable like a service). */
export function orchestratorLogName(tool: string): string {
  return `orch-${tool}`;
}

/**
 * Starts a detected orchestration tool.
 * - `oneshot` (docker compose): awaits `run` — the command detaches by itself.
 * - `pm2`: wraps `run` in a PM2 app whose log streams like a service log.
 * Records the orchestrator in the running state. Throws with the tool's
 * stderr on failure.
 */
export async function startOrchestrator(
  detection: OrchestrationDetection,
  workspacePath: string,
  logDir: string,
): Promise<RunningOrchestrator> {
  const running: RunningOrchestrator = {
    id: detection.id,
    tool: detection.tool,
    configPath: detection.configPath,
    mode: detection.mode,
    startedAt: new Date().toISOString(),
  };

  if (detection.mode === 'oneshot') {
    await execa(detection.run.command, detection.run.args, {
      cwd: detection.run.cwd,
      shell: false,
    });
  } else {
    const pm2Name = orchestratorPm2Name(workspacePath, detection.tool);
    const logFile = serviceLogFile(logDir, orchestratorLogName(detection.tool));
    await fs.mkdir(path.dirname(logFile), { recursive: true });

    // Same invocation shape as service starts, so the log is tailable by the
    // shared SSE endpoint and the app shows up under the workspace prefix.
    await execa('npx', ['pm2', 'delete', pm2Name], { reject: false });
    await execa('npx', [
      'pm2',
      'start',
      detection.run.command,
      '--name',
      pm2Name,
      '--cwd',
      detection.run.cwd,
      '-o',
      logFile,
      '-e',
      logFile,
      '--interpreter',
      'none',
      '--',
      ...detection.run.args,
    ]);
    running.pm2Name = pm2Name;
  }

  await mutateRunningState(workspacePath, (state) => ({
    ...state,
    orchestrators: [...(state.orchestrators ?? []).filter((o) => o.id !== detection.id), running],
  }));
  return running;
}

/**
 * Stops a detected orchestration tool: runs `stopRun` when the tool has one
 * (compose `down`, tilt `down`), deletes the PM2 app for pm2-mode tools, and
 * removes the entry from the running state.
 */
export async function stopOrchestrator(
  detection: OrchestrationDetection,
  workspacePath: string,
): Promise<void> {
  if (detection.mode === 'pm2') {
    const pm2Name = orchestratorPm2Name(workspacePath, detection.tool);
    const pm2List = await getPm2List();
    if (pm2List.some((app: any) => app.name === pm2Name)) {
      await execa('npx', ['pm2', 'delete', pm2Name], { reject: false });
    }
  }

  if (detection.stopRun) {
    // Best-effort: compose down / tilt down may fail if nothing is up.
    await execa(detection.stopRun.command, detection.stopRun.args, {
      cwd: detection.stopRun.cwd,
      shell: false,
      reject: false,
    });
  }

  await mutateRunningState(workspacePath, (state) => ({
    ...state,
    orchestrators: (state.orchestrators ?? []).filter((o) => o.id !== detection.id),
  }));
}
