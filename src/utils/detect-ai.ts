/**
 * @module utils/detect-ai
 * Detects which AI coding assistants are available on the system.
 */

import { execa } from 'execa';

import type { AIAssistant, DetectedAI } from '../types.js';
import { ASSISTANT_HARNESSES, HARNESSES, type HarnessManifest } from '../harness/manifest.js';

/**
 * Attempts to run `<command> --version` and returns `true` if the process
 * exits successfully (exit code 0).
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execa(command, ['--version'], {
      reject: false,
      shell: process.platform === 'win32',
    });
    return result.exitCode === 0;
  } catch {
    // The command could not be spawned at all (not in PATH).
    return false;
  }
}

/**
 * Probes the system for known AI coding assistants and returns their status.
 *
 * Derived from the harness manifest, so a new harness is offered automatically
 * once it declares a probe. `detected` reports whether the assistant should be
 * offered as an option; `command` is set only when a CLI that can host an
 * *interactive terminal session* is available (it is the single source of truth
 * for launching one). Those can disagree: Cursor's `cursor` binary opens the GUI
 * editor, and its launchable CLI is `cursor-agent`.
 *
 * Session-only harnesses are excluded. They are launchable and resumable, but
 * selecting one at workspace creation would generate nothing, so offering it
 * here would be a dead option.
 *
 * @returns An array of {@link DetectedAI} results, one per assistant.
 */
export async function detectAIAssistants(): Promise<DetectedAI[]> {
  // Probe every distinct binary once, concurrently, however many harnesses use it.
  const harnesses: HarnessManifest[] = ASSISTANT_HARNESSES.map((id) => HARNESSES[id]);
  const commands = [...new Set(harnesses.flatMap((h) => [h.detection.probe, h.detection.launchProbe ?? h.detection.probe]))];
  const available = new Map<string, boolean>(
    (await Promise.all(commands.map(async (command) => [command, await commandExists(command)] as const))).map(([k, v]) => [k, v]),
  );

  return harnesses.map((harness) => {
    const { probe, launchCommand, launchProbe } = harness.detection;
    const launch = launchCommand ?? probe;
    const launchable = available.get(launchProbe ?? launch) ?? false;
    return {
      name: harness.id as AIAssistant,
      displayName: harness.pickerLabel ?? harness.label,
      detected: available.get(probe) ?? false,
      ...(launchable ? { command: launch } : {}),
    };
  });
}
