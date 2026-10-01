/**
 * @module utils/grok-sessions
 * Reads saved Grok conversations from the official CLI.
 *
 * Grok stores each session as a directory, grouped by working directory:
 *
 *   ~/.grok/sessions/<encoded-cwd>/<session-id>/
 *     summary.json      metadata: title, timestamps, model, message counts
 *     chat_history.jsonl  the messages sent to the model
 *     updates.jsonl     the ACP update stream (authoritative for restore)
 *
 * The group name is the URL-encoded cwd, except for a cwd whose encoding exceeds
 * 255 bytes, where it becomes a slug plus a hash and the real path is recorded in
 * a `.cwd` file. Both forms are handled here, and the header is the authority
 * because two different cwds can collide on a slug.
 *
 * Session ids are UUIDv7, or a client-supplied id via `grok -s`, so they are not
 * guaranteed to be UUID-shaped the way pi's are — which is why this reader
 * returns the id as recorded rather than validating its shape.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AISession, ChatMessage } from '../types.js';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export function getGrokHome(): string {
  return process.env.GROK_HOME || path.join(os.homedir(), '.grok');
}

export async function getGrokSessionRoot(): Promise<string> {
  return path.join(getGrokHome(), 'sessions');
}

interface GrokSummary {
  title?: string;
  summary?: string;
  modelId?: string;
  messageCount?: number;
  createdAt?: string;
  updatedAt?: string;
  parentSessionId?: string;
}

interface SessionDir {
  /** Absolute path of the session directory. */
  dir: string;
  sessionId: string;
  /** Working directory, from `.cwd` when present, else the decoded group name. */
  cwd: string;
  summary: GrokSummary | null;
}

/** The cwd a group directory stands for, or undefined when it cannot be recovered. */
async function cwdOfGroup(groupDir: string, groupName: string): Promise<string | undefined> {
  try {
    const header = await fs.readFile(path.join(groupDir, '.cwd'), 'utf8');
    const recorded = header.trim();
    if (recorded) return recorded;
  } catch {
    // No header: fall through to the encoded name.
  }
  try {
    const decoded = decodeURIComponent(groupName);
    return path.isAbsolute(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

async function readSessionDirs(root: string): Promise<SessionDir[]> {
  let groups;
  try {
    groups = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  // Trust nothing about the return: a throwing readdir is handled above, but a
  // non-array result would otherwise throw out of session discovery and turn
  // the resume route into a 500.
  if (!Array.isArray(groups)) return [];
  const found: SessionDir[] = [];
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const groupDir = path.join(root, group.name);
    const cwd = await cwdOfGroup(groupDir, group.name);
    if (!cwd) continue;
    let entries;
    try {
      entries = await fs.readdir(groupDir, { withFileTypes: true });
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || !SESSION_ID.test(entry.name)) continue;
      let summary: GrokSummary | null = null;
      try {
        summary = JSON.parse(await fs.readFile(path.join(groupDir, entry.name, 'summary.json'), 'utf8')) as GrokSummary;
      } catch {
        // A session without a readable index is still resumable by id.
      }
      found.push({ dir: path.join(groupDir, entry.name), sessionId: entry.name, cwd, summary });
    }
  }
  return found;
}

const toSession = (entry: SessionDir, targetCwd: (cwd: string) => string): AISession => {
  const title = (entry.summary?.title || entry.summary?.summary || 'Grok Session').replace(/[\r\n\t]+/g, ' ').trim();
  const updatedAt = entry.summary?.updatedAt ?? '';
  return {
    id: entry.sessionId,
    assistant: 'grok',
    title: title.length > 80 ? `${title.slice(0, 80)}...` : title,
    createdAt: entry.summary?.createdAt ?? '',
    updatedAt,
    messageCount: entry.summary?.messageCount ?? 0,
    workspacePath: targetCwd(entry.cwd),
    recordedCwd: entry.cwd,
    // Grok records subagent sessions alongside the parent's, so the kind is not
    // known from the directory alone.
    threadKind: 'unknown',
  };
};

export async function findGrokSessions(
  roots: string[],
  isPathMatch: (cwd: string) => boolean,
  targetCwd: (cwd: string) => string,
): Promise<AISession[]> {
  const sessions: AISession[] = [];
  for (const root of roots) {
    for (const entry of await readSessionDirs(await getGrokSessionRoot())) {
      if (isPathMatch(entry.cwd)) sessions.push(toSession(entry, targetCwd));
    }
  }
  return sessions.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export async function hasGrokSessions(roots: string[], isPathMatch: (cwd: string) => boolean): Promise<boolean> {
  for (const root of roots) {
    for (const entry of await readSessionDirs(await getGrokSessionRoot())) {
      if (isPathMatch(entry.cwd)) return true;
    }
  }
  return false;
}

/** Locate one session directory by id, for a transcript request. */
async function findSessionDir(sessionId: string): Promise<SessionDir | undefined> {
  if (!SESSION_ID.test(sessionId)) return undefined;
  for (const entry of await readSessionDirs(await getGrokSessionRoot())) {
    if (entry.sessionId === sessionId) return entry;
  }
  return undefined;
}

/**
 * The conversation, from `chat_history.jsonl`.
 *
 * `updates.jsonl` is what grok itself restores from, but it is an ACP update
 * stream rather than a message list, and its per-update shape is internal. The
 * chat history is the same conversation in message form, so it is the stable
 * thing to read.
 */
export async function getGrokTranscript(sessionId: string): Promise<ChatMessage[]> {
  const entry = await findSessionDir(sessionId);
  if (!entry) throw new Error(`Grok session not found: ${sessionId}`);

  const messages: ChatMessage[] = [];
  let raw: string;
  try {
    raw = await fs.readFile(path.join(entry.dir, 'chat_history.jsonl'), 'utf8');
  } catch {
    return messages;
  }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as { role?: string; content?: unknown; timestamp?: string };
      const role = record.role === 'assistant' ? 'assistant' : record.role === 'system' ? 'system' : 'user';
      messages.push({
        role,
        content: typeof record.content === 'string' ? record.content : JSON.stringify(record.content ?? ''),
        ...(record.timestamp ? { timestamp: record.timestamp } : {}),
      } as ChatMessage);
    } catch {
      // A malformed line is skipped rather than failing the transcript.
    }
  }
  return messages;
}
