/**
 * Persistent per-workspace chat state (localStorage).
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Epoch milliseconds. */
  ts?: number;
  /** Rendering variant for system messages. */
  kind?: 'error' | 'note';
}

export interface ChatStore {
  v: 3;
  /** Resumable session identity scoped to each CLI provider. */
  sessions: Record<string, { id: string; started: boolean }>;
  /** Last used provider id. */
  providerId: string | null;
  messages: ChatMessage[];
}

export const chatStorageKey = (branchName: string) => `nexusflow_chat_${branchName}`;

const emptyStore = (): ChatStore => ({
  v: 3,
  sessions: {},
  providerId: null,
  messages: [],
});

/**
 * Loads the store for a workspace, migrating the v1 format (a bare message
 * array) in place. Any unreadable value yields an empty store.
 */
export function loadChatStore(branchName: string): ChatStore {
  try {
    const raw = localStorage.getItem(chatStorageKey(branchName));
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return {
        ...emptyStore(),
        messages: parsed
          .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
          .map((m) => ({ role: m.role, content: m.content })),
      };
    }
    if (parsed && parsed.v === 3 && parsed.sessions && Array.isArray(parsed.messages)) {
      return parsed as ChatStore;
    }
    if (parsed && parsed.v === 2 && Array.isArray(parsed.messages)) {
      // v2 only assigned session ids to claude-cli, even if the user later
      // switched the selected provider. Scope that legacy id accordingly.
      const sessions: ChatStore['sessions'] = {};
      if (typeof parsed.sessionId === 'string' && parsed.sessionId) {
        sessions['claude-cli'] = { id: parsed.sessionId, started: Boolean(parsed.sessionStarted) };
      }
      return {
        v: 3,
        sessions,
        providerId: typeof parsed.providerId === 'string' ? parsed.providerId : null,
        messages: parsed.messages,
      };
    }
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

/** Cap on persisted messages — CLI output can be large; the live in-memory
 *  transcript is unaffected, only what survives a reload is trimmed. */
const MAX_PERSISTED_MESSAGES = 500;

export function saveChatStore(branchName: string, store: ChatStore): void {
  try {
    const trimmed = store.messages.length > MAX_PERSISTED_MESSAGES
      ? { ...store, messages: store.messages.slice(-MAX_PERSISTED_MESSAGES) }
      : store;
    localStorage.setItem(chatStorageKey(branchName), JSON.stringify(trimmed));
  } catch (e) {
    console.error('Failed to save chat to localStorage', e);
  }
}

export function clearChatStore(branchName: string): void {
  try {
    localStorage.removeItem(chatStorageKey(branchName));
  } catch {
    // ignore
  }
}
