import { useQueries } from '@tanstack/react-query';
import { apiFetch } from '../../lib/api/client.js';
import type { AISession } from '../../types.js';

const SESSION_SOURCES = ['antigravity', 'claude', 'codex', 'copilot', 'workspace'] as const;

export function useWorkspaceSessionSources(workspace: string, enabled: boolean) {
  const histories = useQueries({ queries: SESSION_SOURCES.map(source => ({
    queryKey: ['terminal-resume-source', workspace, source],
    queryFn: () => apiFetch<{ sessions: AISession[] }>(`/api/workspace/${encodeURIComponent(workspace)}/sessions?source=${source}`),
    enabled,
    staleTime: 15_000,
  })) });
  const seen = new Set<string>();
  const sessions = histories.flatMap(history => history.data?.sessions ?? []).filter(session => {
    const key = `${session.assistant}:${session.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    histories,
    sessions,
    sourcesChecked: histories.filter(history => history.isSuccess || history.isError).length,
    sourcesPending: histories.filter(history => history.isPending).length,
    sourcesFailed: histories.filter(history => history.isError).length,
    sourceCount: SESSION_SOURCES.length,
  };
}
