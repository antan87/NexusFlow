/**
 * @module utils/probe
 * Bounded `--version`-style probes for detecting installed tools.
 */

import { execa, type Options } from 'execa';

/**
 * Upper bound for one probe. Some CLIs block on first run, on an update prompt
 * or behind a dialog; without a bound, one of them keeps the whole detection
 * request (and every UI waiting on it) open indefinitely.
 */
export const PROBE_TIMEOUT_MS = 5_000;

/** `timed-out` means the command started but did not answer in time. */
export type ProbeOutcome = 'ok' | 'failed' | 'timed-out';

export async function probeCommand(command: string, args: string[], options: Options = {}): Promise<ProbeOutcome> {
  try {
    const result = await execa(command, args, { reject: false, timeout: PROBE_TIMEOUT_MS, ...options });
    if (result.timedOut) return 'timed-out';
    return result.exitCode === 0 ? 'ok' : 'failed';
  } catch {
    // The command could not be spawned at all (not on PATH).
    return 'failed';
  }
}
