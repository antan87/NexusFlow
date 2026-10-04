import { useMemo } from 'react';

import { liveSessions, type LiveSessions } from './liveSessions.js';
import { useChatAttention } from './useChatAttention.js';
import { useRunningTerminals } from './useRunningTerminals.js';

export { RUNNING_TERMINALS_KEY } from './useRunningTerminals.js';

/** Where each CLI is running. `now` is when the list was read, so "working" and "stops in" are judged at that moment. */
export function useLiveSessions(): { live: ReadonlyMap<string, LiveSessions>; now: number } {
  const query = useRunningTerminals();
  const { waiting } = useChatAttention();
  const now = query.dataUpdatedAt;
  const live = useMemo(() => liveSessions(query.data ?? [], waiting, now), [query.data, waiting, now]);
  return { live, now };
}
