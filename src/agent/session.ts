/**
 * @module agent/session
 * Session identity for chat agents that support resumable conversations.
 */

/** A chat session to create or resume. `resume` means the session already has turns on disk. */
export interface AgentSession {
  id: string;
  resume: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strict UUID check. Session ids come from the client and end up in the argv of a
 * shell:true spawn, so only the inert UUID charset may pass.
 */
export function isValidSessionUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/**
 * Builds the claude CLI args for one print-mode turn. The prompt itself is
 * always piped via stdin, never argv.
 *
 * Without a session the legacy behavior applies: `-c` continues the most
 * recent conversation in the cwd. With a session, a fresh id is created via
 * --session-id on the first turn and every later turn resumes that id;
 * resumed sessions use --resume from the start.
 */
export function buildClaudeTurnArgs(isFirstTurn: boolean, session?: AgentSession): string[] {
  if (!session) {
    return isFirstTurn ? ['-p'] : ['-c', '-p'];
  }
  if (!session.resume && isFirstTurn) {
    return ['-p', '--session-id', session.id];
  }
  return ['-p', '--resume', session.id];
}
