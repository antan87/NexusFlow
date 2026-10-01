import type { AISession, ChatMessage } from '../types.js';
import type { SessionSource } from './cli-harnesses.js';
import { findPiSessions, getPiTranscript, hasPiSessions } from './pi-sessions.js';
import { findGrokSessions, getGrokTranscript, hasGrokSessions } from './grok-sessions.js';

/** One provider owns all three operations needed for saved-session support. */
export interface SessionLocationContext {
  roots: string[];
  matchesCwd(cwd: string): boolean;
}

export interface SessionScanContext extends SessionLocationContext {
  targetCwd(cwd: string): string;
}

export interface SessionReader {
  list(context: SessionScanContext): Promise<AISession[]>;
  hasAny(context: SessionLocationContext): Promise<boolean>;
  transcript(sessionId: string): Promise<ChatMessage[]>;
}

// These readers still live in session-finder.ts. New readers are independent
// modules; moving a legacy reader here removes its name from this union.
type LegacySessionSource = 'antigravity' | 'claude' | 'codex' | 'copilot' | 'workspace';
type ModularSessionSource = Exclude<SessionSource, LegacySessionSource>;

export const MODULAR_SESSION_READERS: Record<ModularSessionSource, SessionReader> = {
  pi: {
    list: ({ roots, matchesCwd, targetCwd }) => findPiSessions(roots, matchesCwd, targetCwd),
    hasAny: ({ roots, matchesCwd }) => hasPiSessions(roots, matchesCwd),
    transcript: getPiTranscript,
  },
  grok: {
    list: ({ roots, matchesCwd, targetCwd }) => findGrokSessions(roots, matchesCwd, targetCwd),
    hasAny: ({ roots, matchesCwd }) => hasGrokSessions(roots, matchesCwd),
    transcript: getGrokTranscript,
  },
};

export function modularSessionReader(source: string): SessionReader | undefined {
  return Object.hasOwn(MODULAR_SESSION_READERS, source)
    ? MODULAR_SESSION_READERS[source as ModularSessionSource]
    : undefined;
}
