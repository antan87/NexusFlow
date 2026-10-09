/**
 * @module core/screen-context
 * What the user is looking at, shared with the AI only when the user switches
 * sharing on. It is off by default, and switching it off deletes what was
 * stored. The screen reports its view; the AI asks for it through
 * `get_screen_context`; nothing is collected in the background.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { resolveWorkspaceChatLedger } from './constants.js';
import {
  cleanLineNumber,
  cleanRelativePath,
  cleanRepoName,
  cleanScreenBlock,
} from './screen-clean.js';

export const SCREEN_SHARING_FILE = 'screen-sharing.json';
export const SCREEN_CONTEXT_FILE = 'screen-context.json';
/** A view older than this is reported as stale, because the user has probably moved on. */
export const SCREEN_CONTEXT_STALE_MS = 10 * 60_000;
export const SCREEN_SELECTION_LIMIT = 2000;
export const SCREEN_REVIEWED_LIMIT = 50;

export interface ScreenContext {
  viewing?: { path: string; repo?: string; line?: number };
  selection?: string;
  /** Files the user has marked as reviewed, newest last. */
  reviewed: string[];
  updatedAt: string;
}

export type ScreenContextInput = {
  viewing?: { path?: unknown; repo?: unknown; line?: unknown } | null;
  selection?: unknown;
  reviewed?: unknown;
};

export class ScreenSharingOffError extends Error {
  constructor() {
    super('Sharing the screen is off. The user has to switch it on first.');
    this.name = 'ScreenSharingOffError';
  }
}

async function files(workspaceRoot: string): Promise<{ dir: string; sharing: string; context: string }> {
  const { chatDir } = await resolveWorkspaceChatLedger(workspaceRoot);
  return { dir: chatDir, sharing: path.join(chatDir, SCREEN_SHARING_FILE), context: path.join(chatDir, SCREEN_CONTEXT_FILE) };
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value), 'utf8');
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return undefined; }
}

/** Whether the user has switched sharing on. Anything unreadable counts as off. */
export async function getScreenSharing(workspaceRoot: string): Promise<{ enabled: boolean; updatedAt?: string }> {
  const { sharing } = await files(workspaceRoot);
  const stored = (await readJson(sharing)) as { enabled?: unknown; updatedAt?: unknown } | undefined;
  if (stored?.enabled !== true) return { enabled: false };
  return { enabled: true, ...(typeof stored.updatedAt === 'string' ? { updatedAt: stored.updatedAt } : {}) };
}

/** Switches sharing on or off. Switching it off deletes whatever view was stored. */
export async function setScreenSharing(
  workspaceRoot: string,
  enabled: boolean,
  now: number = Date.now(),
): Promise<{ enabled: boolean; updatedAt: string }> {
  const { dir, sharing, context } = await files(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const updatedAt = new Date(now).toISOString();
  await writeAtomic(sharing, { enabled, updatedAt });
  if (!enabled) await fs.rm(context, { force: true });
  return { enabled, updatedAt };
}

function cleanContext(raw: unknown, updatedAt: string): ScreenContext {
  const input = (raw && typeof raw === 'object' ? raw : {}) as ScreenContextInput;
  const view = input.viewing && typeof input.viewing === 'object' ? input.viewing : undefined;
  const viewPath = cleanRelativePath(view?.path);
  const line = cleanLineNumber(view?.line);
  const repo = cleanRepoName(view?.repo);
  const selection = cleanScreenBlock(input.selection, SCREEN_SELECTION_LIMIT);
  const reviewed = Array.isArray(input.reviewed)
    ? [...new Set(input.reviewed.map(cleanRelativePath).filter((value): value is string => value !== undefined))].slice(-SCREEN_REVIEWED_LIMIT)
    : [];
  return {
    ...(viewPath ? { viewing: { path: viewPath, ...(repo ? { repo } : {}), ...(line ? { line } : {}) } } : {}),
    ...(selection ? { selection } : {}),
    reviewed,
    updatedAt,
  };
}

/**
 * Stores the view the screen reports. Refused unless the user has switched
 * sharing on, so an unaware screen cannot leak anything.
 * @throws {ScreenSharingOffError} when sharing is off.
 */
export async function saveScreenContext(
  workspaceRoot: string,
  input: ScreenContextInput,
  now: number = Date.now(),
): Promise<ScreenContext> {
  if (!(await getScreenSharing(workspaceRoot)).enabled) throw new ScreenSharingOffError();
  const { dir, context } = await files(workspaceRoot);
  await fs.mkdir(dir, { recursive: true });
  const cleaned = cleanContext(input, new Date(now).toISOString());
  await writeAtomic(context, cleaned);
  return cleaned;
}

export type ScreenContextAnswer =
  | { shared: false; message: string }
  | { shared: true; context: ScreenContext | null; ageSeconds?: number; stale?: boolean; message?: string };

/**
 * What the AI gets when it asks. When sharing is off it gets only that fact:
 * the stored view is never read, even if a file is left over.
 */
export async function readScreenContext(workspaceRoot: string, now: number = Date.now()): Promise<ScreenContextAnswer> {
  if (!(await getScreenSharing(workspaceRoot)).enabled) {
    return { shared: false, message: 'The user has not switched on sharing what they are looking at. Ask them in the chat instead.' };
  }
  const { context } = await files(workspaceRoot);
  const stored = (await readJson(context)) as { updatedAt?: unknown } | undefined;
  const updated = typeof stored?.updatedAt === 'string' ? Date.parse(stored.updatedAt) : NaN;
  if (!stored || !Number.isFinite(updated)) {
    return { shared: true, context: null, message: 'Sharing is on, but the screen has not reported a view yet.' };
  }
  const cleaned = cleanContext(stored, new Date(updated).toISOString());
  const age = Math.max(0, now - updated);
  return {
    shared: true,
    context: cleaned,
    ageSeconds: Math.round(age / 1000),
    ...(age > SCREEN_CONTEXT_STALE_MS ? { stale: true, message: 'This view is more than ten minutes old, so the user has probably moved on.' } : {}),
  };
}
