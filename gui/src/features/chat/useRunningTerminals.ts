import { useQuery } from '@tanstack/react-query';

import { runningTerminals } from '../terminal/client.js';

export const RUNNING_TERMINALS_KEY = ['running-terminals'] as const;

/**
 * This browser's running terminals in every workspace, read every few seconds while the window is visible. The list
 * lives in the server's memory, so reading it is cheap. Everyone who asks shares the one read.
 */
export function useRunningTerminals() {
  return useQuery({ queryKey: RUNNING_TERMINALS_KEY, queryFn: runningTerminals, refetchInterval: 4000, staleTime: 2000, retry: 1 });
}
