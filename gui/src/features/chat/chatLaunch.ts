import { isChatExecutionProfile, type ChatExecutionProfile } from './executionProfile.js';

export type EmbeddedHarnessAssistant = 'claude' | 'codex' | 'antigravity' | 'copilot';
export type EmbeddedHarnessProvider = 'claude-cli' | 'codex-cli' | 'antigravity-cli' | 'copilot-cli';

export interface ChatLaunchIntent {
  nonce: string;
  providerId: EmbeddedHarnessProvider;
  assistant?: EmbeddedHarnessAssistant;
  sessionId?: string;
  kickoff?: string;
  executionProfile: ChatExecutionProfile;
}

export const WORKSPACE_KICKOFF =
  'Read the workspace instructions and implementation plan, inspect the repository state, then begin the task described for this workspace. Ask before making a decision that materially changes scope.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HARNESS_PROVIDERS = new Set<EmbeddedHarnessProvider>([
  'claude-cli',
  'codex-cli',
  'antigravity-cli',
  'copilot-cli',
]);

export function providerForAssistant(assistant: unknown): EmbeddedHarnessProvider | null {
  if (assistant === 'claude') return 'claude-cli';
  if (assistant === 'codex') return 'codex-cli';
  if (assistant === 'antigravity') return 'antigravity-cli';
  if (assistant === 'copilot') return 'copilot-cli';
  return null;
}

export function assistantLabel(assistant: EmbeddedHarnessAssistant): string {
  switch (assistant) {
    case 'claude':
      return 'Claude';
    case 'codex':
      return 'Codex';
    case 'antigravity':
      return 'Antigravity';
    case 'copilot':
      return 'Copilot';
  }
}

export function createChatLaunchIntent(
  assistant: EmbeddedHarnessAssistant,
  options: { sessionId?: string; kickoff?: string; executionProfile?: ChatExecutionProfile } = {},
): ChatLaunchIntent {
  return {
    nonce: globalThis.crypto.randomUUID(),
    providerId: providerForAssistant(assistant)!,
    assistant,
    executionProfile: options.executionProfile ?? (options.kickoff ? 'workspace-write' : 'review'),
    ...options,
  };
}

/**
 * Router state is an untyped browser boundary. Only local CLI
 * providers may trigger a launch, and a resumable session must be a UUID owned
 * by the matching assistant. This prevents a stale or hand-authored history
 * entry from silently falling through to another provider.
 */
export function readChatLaunchIntent(state: unknown): ChatLaunchIntent | null {
  if (!state || typeof state !== 'object') return null;
  const candidate = (state as { chatLaunch?: unknown }).chatLaunch;
  if (!candidate || typeof candidate !== 'object') return null;

  const value = candidate as Partial<ChatLaunchIntent>;
  if (!UUID_RE.test(value.nonce ?? '')) return null;
  if (!value.providerId || !HARNESS_PROVIDERS.has(value.providerId as EmbeddedHarnessProvider)) return null;
  if (!isChatExecutionProfile(value.executionProfile)) return null;
  if (value.kickoff !== undefined && (typeof value.kickoff !== 'string' || value.kickoff.length > 2_000)) {
    return null;
  }

  if (value.assistant !== undefined && providerForAssistant(value.assistant) !== value.providerId) return null;
  if (value.sessionId !== undefined) {
    if (!UUID_RE.test(value.sessionId)) return null;
    if (!value.assistant) return null;
  }

  return value as ChatLaunchIntent;
}

