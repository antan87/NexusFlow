export type EmbeddedHarnessAssistant = 'claude' | 'codex';
export type EmbeddedHarnessProvider = 'claude-cli' | 'codex-cli';

export interface ChatLaunchIntent {
  nonce: string;
  providerId: EmbeddedHarnessProvider;
  assistant?: EmbeddedHarnessAssistant;
  sessionId?: string;
  kickoff?: string;
}

export const WORKSPACE_KICKOFF =
  'Read the workspace instructions and implementation plan, inspect the repository state, then begin the task described for this workspace. Ask before making a decision that materially changes scope.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function providerForAssistant(assistant: unknown): EmbeddedHarnessProvider | null {
  if (assistant === 'claude') return 'claude-cli';
  if (assistant === 'codex') return 'codex-cli';
  return null;
}

export function assistantLabel(assistant: EmbeddedHarnessAssistant): string {
  return assistant === 'claude' ? 'Claude' : 'Codex';
}

export function createChatLaunchIntent(
  assistant: EmbeddedHarnessAssistant,
  options: { sessionId?: string; kickoff?: string } = {},
): ChatLaunchIntent {
  return {
    nonce: globalThis.crypto.randomUUID(),
    providerId: providerForAssistant(assistant)!,
    assistant,
    ...options,
  };
}

/**
 * Router state is an untyped browser boundary. Only the two local CLI
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
  if (value.providerId !== 'claude-cli' && value.providerId !== 'codex-cli') return null;
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
