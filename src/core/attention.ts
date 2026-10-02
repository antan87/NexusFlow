/**
 * @module core/attention
 * Finds the newest "agent needs the user" request in a workspace's chat ledger,
 * so the app can flag the CLI chat that is waiting. Written by the MCP
 * `request_user_input` tool as a `kind: 'input_request'` ledger entry.
 */

import * as fs from 'node:fs/promises';
import { resolveWorkspaceChatLedger } from './constants.js';

/** Longest request message handed to the app, whatever the ledger holds. */
export const INPUT_REQUEST_DISPLAY_LIMIT = 500;
/** Longest harness name kept with a request. */
export const INPUT_REQUEST_HARNESS_LIMIT = 40;
/** Requests older than this are no longer worth an alert. */
export const INPUT_REQUEST_MAX_AGE_MS = 24 * 60 * 60_000;
/** How far ahead of this machine's clock an entry may claim to be. */
const CLOCK_SKEW_MS = 5 * 60_000;
/**
 * How much of the end of a ledger is read, tried in turn. A request is nearly
 * always near the end, so the first step answers; the second finds one with a
 * lot of newer entries after it. Beyond the last step a request is not seen.
 */
const TAIL_STEPS = [64 * 1024, 512 * 1024];

export interface InputRequest {
  id: string;
  timestamp: string;
  harness: string;
  message: string;
}

/**
 * Text from an agent or a ledger made safe to show: control characters, which can
 * reshape a terminal or a toast, are removed and the ends are trimmed. Newlines and
 * tabs stay. Anything that is not a string becomes the empty string.
 */
export function cleanInputRequestText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
}

interface Tail {
  lines: string[];
  /** The whole file was read, so reading more finds nothing new. */
  complete: boolean;
}

async function readTail(file: string, sinceMs: number, bytes: number): Promise<Tail> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    // A ledger untouched since the cutoff cannot hold a request newer than it.
    if (!stat.isFile() || stat.mtimeMs < sinceMs) return { lines: [], complete: true };
    const start = Math.max(0, stat.size - bytes);
    const buffer = Buffer.alloc(stat.size - start);
    // A short read (the file shrank meanwhile) must not leave padding in the last line.
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    // Reading from mid-file starts inside a line; drop that fragment.
    if (start > 0) lines.shift();
    return { lines, complete: start === 0 };
  } catch {
    return { lines: [], complete: true };
  } finally {
    await handle?.close().catch(() => {});
  }
}

type Candidate = InputRequest & { time: number };

function newestRequest(lines: readonly string[], sinceMs: number, now: number): Candidate | null {
  let latest: Candidate | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: any;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object' || entry.kind !== 'input_request') continue;
    const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN;
    const message = cleanInputRequestText(entry.message).slice(0, INPUT_REQUEST_DISPLAY_LIMIT);
    // A timestamp from the future would stay "newest" and pin its alert.
    if (!Number.isFinite(time) || time < sinceMs || time > now + CLOCK_SKEW_MS || !message) continue;
    if (latest && time < latest.time) continue;
    latest = {
      id: typeof entry.id === 'string' && entry.id ? entry.id : `${entry.timestamp}`,
      timestamp: entry.timestamp,
      harness: cleanInputRequestText(entry.harness).slice(0, INPUT_REQUEST_HARNESS_LIMIT) || 'agent',
      message,
      time,
    };
  }
  return latest;
}

/**
 * Returns the newest input request in the workspace's ledger that is no older
 * than {@link INPUT_REQUEST_MAX_AGE_MS}, or null. Malformed lines and entries
 * without a valid timestamp or message are skipped.
 */
export async function latestInputRequest(
  workspaceDir: string,
  now: number = Date.now(),
): Promise<InputRequest | null> {
  const sinceMs = now - INPUT_REQUEST_MAX_AGE_MS;
  const ledger = await resolveWorkspaceChatLedger(workspaceDir);
  let latest: Candidate | null = null;

  for (const file of ledger.readPaths) {
    for (const bytes of TAIL_STEPS) {
      const tail = await readTail(file, sinceMs, bytes);
      const found = newestRequest(tail.lines, sinceMs, now);
      if (found && (!latest || found.time >= latest.time)) latest = found;
      if (found || tail.complete) break;
    }
  }

  if (!latest) return null;
  const { time: _time, ...request } = latest;
  return request;
}
