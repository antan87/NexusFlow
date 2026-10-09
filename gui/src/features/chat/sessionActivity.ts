import { useSyncExternalStore } from 'react';

/**
 * What the sidebar shows about a workspace's terminal that the server cannot say: whether the terminal in the browser
 * stopped or lost its connection, and whether it printed something while it was not on screen. The chat reports both as
 * they happen, and the sidebar reads them.
 */
export type TerminalStatus = 'idle' | 'running' | 'exited' | 'disconnected';

export interface SessionActivity {
  status: TerminalStatus | null;
  /** The terminal printed something while its chat was not on screen, and the user has not looked since. */
  unread: boolean;
}

export type ActivityByWorkspace = Readonly<Record<string, SessionActivity>>;

const NONE: SessionActivity = { status: null, unread: false };

/** Words for a marker or a screen reader. A terminal that is running is the normal case, so it says nothing. */
export function activityNotes(activity: SessionActivity | undefined): string[] {
  const notes: string[] = [];
  if (activity?.status === 'disconnected') notes.push('Terminal disconnected');
  else if (activity?.status === 'exited') notes.push('Terminal exited');
  if (activity?.unread) notes.push('New terminal output');
  return notes;
}

type Listener = () => void;

export function createSessionActivityStore() {
  let state: ActivityByWorkspace = {};
  const listeners = new Set<Listener>();

  /** Replaces state only when something changed, so a repeated report does not wake the sidebar. */
  const update = (branch: string, change: (current: SessionActivity) => SessionActivity) => {
    const current = state[branch] ?? NONE;
    const next = change(current);
    if (next.status === current.status && next.unread === current.unread) return;
    state = { ...state, [branch]: next };
    for (const listener of listeners) listener();
  };

  return {
    getState: (): ActivityByWorkspace => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    setStatus: (branch: string, status: TerminalStatus) => update(branch, (current) => ({ ...current, status })),
    markUnread: (branch: string) => update(branch, (current) => ({ ...current, unread: true })),
    /** The user is looking at these chats now, so whatever they printed is read. */
    markSeen: (branches: readonly (string | null)[]) => {
      for (const branch of branches) {
        if (branch && state[branch]?.unread) update(branch, (current) => ({ ...current, unread: false }));
      }
    },
    /** Forgets workspaces whose chat is no longer open, so a reopened one starts clean. */
    prune: (open: readonly string[]) => {
      const keep = new Set(open);
      const kept = Object.entries(state).filter(([branch]) => keep.has(branch));
      if (kept.length === Object.keys(state).length) return;
      state = Object.fromEntries(kept);
      for (const listener of listeners) listener();
    },
  };
}

export const sessionActivity = createSessionActivityStore();

export function useSessionActivity(): ActivityByWorkspace {
  return useSyncExternalStore(sessionActivity.subscribe, sessionActivity.getState, () => ({}));
}
