/**
 * @module agent/session
 * Session identity for chat agents that support resumable conversations.
 */

import type { AgentExecutionProfile } from './ProviderRegistry.js';

/** A chat session to create or resume. `resume` means the session already has turns on disk. */
export interface AgentSession {
  id: string;
  resume: boolean;
  model?: string;
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
export function buildClaudeTurnArgs(
  isFirstTurn: boolean,
  session?: AgentSession,
  executionProfile: AgentExecutionProfile = 'review',
): string[] {
  const outputArgs = [
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  const permissionArgs = [
    '--permission-mode',
    executionProfile === 'workspace-write' ? 'acceptEdits' : 'plan',
  ];
  const modelArgs = session?.model ? ['--model', session.model] : [];
  if (!session) {
    return isFirstTurn
      ? ['-p', ...outputArgs, ...permissionArgs]
      : ['-c', '-p', ...outputArgs, ...permissionArgs];
  }
  if (!session.resume && isFirstTurn) {
    return ['-p', ...outputArgs, ...permissionArgs, ...modelArgs, '--session-id', session.id];
  }
  return ['-p', ...outputArgs, ...permissionArgs, ...modelArgs, '--resume', session.id];
}
