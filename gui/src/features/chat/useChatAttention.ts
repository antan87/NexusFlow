import { useEffect, useMemo, useState } from 'react';
import { useInputRequests } from '../../lib/api/queries.js';
import type { InputRequest } from '../../types.js';
import { useFloatingChat } from './floatingChatStore.js';
import { openRequests, pendingRequests, useSeenRequests } from './chatAttention.js';
import { useRunningTerminals } from './useRunningTerminals.js';

/**
 * The CLI chats whose agents asked the user something, in open chats and wherever a CLI still runs.
 * - `open`: every question not answered yet, longest-waiting first. It stays until it is answered.
 * - `waiting`: the workspaces those questions are in.
 * - `pending`: the open questions the user has not seen yet, for alerts that should stop once seen.
 */
export function useChatAttention(): { open: InputRequest[]; waiting: ReadonlySet<string>; pending: InputRequest[] } {
  const { openTabs } = useFloatingChat();
  const running = useRunningTerminals().data;
  const watched = useMemo(() => [...new Set([...openTabs, ...(running ?? []).map((terminal) => terminal.workspace)])], [openTabs, running]);
  const requests = useInputRequests(watched).data;
  const seen = useSeenRequests();
  return useMemo(() => {
    const open = openRequests(requests ?? [], watched);
    return { open, waiting: new Set(open.map((request) => request.workspaceId)), pending: pendingRequests(requests ?? [], seen, watched) };
  }, [requests, seen, watched]);
}

/**
 * True while the user can actually see this window: visible and focused. An open
 * chat in a window on another monitor is on screen but not being looked at.
 */
export function useWindowAttentive(): boolean {
  const read = () => document.visibilityState === 'visible' && document.hasFocus();
  const [attentive, setAttentive] = useState(read);
  useEffect(() => {
    const update = () => setAttentive(read());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return attentive;
}
