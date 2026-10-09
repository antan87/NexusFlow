import { useSyncExternalStore } from 'react';
import { CHAT_ATTENTION_STORAGE_KEY } from '../../brand';
import type { InputRequest } from '../../types.js';

/**
 * Which "agent needs input" requests the user has already seen, per workspace:
 * the id of the newest request seen there. A request is waiting until its id is
 * recorded here, which happens when its CLI chat is on screen in a focused window
 * or the user dismisses it.
 */
export type SeenRequests = Readonly<Record<string, string>>;

/** The newest-seen record is kept per workspace; this bounds how many workspaces are remembered. */
export const MAX_REMEMBERED_WORKSPACES = 200;

const time = (request: InputRequest) => Date.parse(request.timestamp) || 0;

/**
 * Questions not answered yet, in the chats being watched (open ones, and those whose CLI still runs), longest-waiting
 * first. A question in a workspace nobody watches is not shown: no chat of it is open and nothing runs there.
 */
export function openRequests(requests: readonly InputRequest[], watched: readonly string[]): InputRequest[] {
  const shown = new Set(watched);
  return requests.filter((request) => shown.has(request.workspaceId)).sort((a, b) => time(a) - time(b));
}

/** The open questions the user has not seen yet, longest-waiting first: the ones worth an alert. */
export function pendingRequests(
  requests: readonly InputRequest[],
  seen: SeenRequests,
  watched: readonly string[],
): InputRequest[] {
  return openRequests(requests, watched).filter((request) => seen[request.workspaceId] !== request.id);
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function readSeen(storage: StorageLike | undefined): SeenRequests {
  try {
    const raw = storage?.getItem(CHAT_ATTENTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, id]) => typeof id === 'string' && id.length > 0));
  } catch {
    return {};
  }
}

/** Browser storage can be missing or throw (private windows, sandboxes); the store then lives in memory. */
function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function createAttentionStore(storage: StorageLike | undefined = browserStorage()) {
  let seen: SeenRequests = readSeen(storage);
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    getSeen: (): SeenRequests => seen,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    /** Records that the user has seen `requestId` in `workspaceId`. */
    markSeen: (workspaceId: string, requestId: string) => {
      if (seen[workspaceId] === requestId) return;
      // Re-insert so the most recently seen workspaces are the ones kept.
      const next: Record<string, string> = { ...seen };
      delete next[workspaceId];
      next[workspaceId] = requestId;
      const keys = Object.keys(next);
      for (const key of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_WORKSPACES))) delete next[key];
      seen = next;
      try {
        storage?.setItem(CHAT_ATTENTION_STORAGE_KEY, JSON.stringify(seen));
      } catch {
        // Non-fatal: the alert state still holds for this session.
      }
      notify();
    },
    /** Re-reads storage after another window changed it. */
    reload: () => {
      seen = readSeen(storage);
      notify();
    },
  };
}

export const attentionStore = createAttentionStore();

// A second window (the desktop app and a browser tab) shares this record, so
// seeing a request in one clears it in the other.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === CHAT_ATTENTION_STORAGE_KEY) attentionStore.reload();
  });
}

const NOTHING_SEEN: SeenRequests = {};

export function useSeenRequests(): SeenRequests {
  return useSyncExternalStore(attentionStore.subscribe, attentionStore.getSeen, () => NOTHING_SEEN);
}
