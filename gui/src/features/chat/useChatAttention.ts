import { useEffect, useMemo, useState } from 'react';
import { useInputRequests } from '../../lib/api/queries.js';
import type { InputRequest } from '../../types.js';
import { useFloatingChat } from './floatingChatStore.js';
import { pendingRequests, useSeenRequests } from './chatAttention.js';

/** The CLI chats whose agents are waiting for the user, longest-waiting first. */
export function useChatAttention(): { pending: InputRequest[]; waiting: ReadonlySet<string> } {
  const { openTabs } = useFloatingChat();
  const requests = useInputRequests(openTabs).data;
  const seen = useSeenRequests();
  return useMemo(() => {
    const pending = pendingRequests(requests ?? [], seen, openTabs);
    return { pending, waiting: new Set(pending.map((request) => request.workspaceId)) };
  }, [requests, seen, openTabs]);
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
