import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { API_BASE } from '../apiBase.js';

export interface CreationStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
}

export interface CreationProgress {
  status: 'idle' | 'running' | 'completed' | 'failed';
  steps: CreationStep[];
  error?: string;
  workspacePath?: string;
  workspaceId?: string;
}

const IDLE: CreationProgress = { status: 'idle', steps: [] };

/**
 * Subscribes to the workspace-creation SSE stream for a job and exposes its
 * live step progress. Invalidates the workspace queries when the job ends.
 */
export function useCreationStream() {
  const [progress, setProgress] = useState<CreationProgress>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);
  const queryClient = useQueryClient();

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => close, [close]);

  const start = useCallback(
    (jobId: string) => {
      close();
      setProgress({ status: 'running', steps: [] });

      const source = new EventSource(
        `${API_BASE}/api/workspace/create-stream/${encodeURIComponent(jobId)}`,
      );
      sourceRef.current = source;

      let errorCount = 0;
      source.addEventListener('progress', (event) => {
        // Any successful frame proves the connection healed — reset the
        // failure budget so long jobs survive repeated idle-timeout drops.
        errorCount = 0;
        try {
          const data = JSON.parse((event as MessageEvent).data);
          setProgress({
            status: data.status === 'completed' || data.status === 'failed' ? data.status : 'running',
            steps: data.steps ?? [],
            error: data.error,
            workspacePath: data.workspacePath,
            workspaceId: data.feature?.id ?? jobId,
          });
          if (data.status === 'completed' || data.status === 'failed') {
            close();
            queryClient.invalidateQueries({ queryKey: ['workspaces'] });
            queryClient.invalidateQueries({ queryKey: ['workspaces-status'] });
          }
        } catch {
          // Malformed frame — keep listening.
        }
      });

      source.onerror = () => {
        // EventSource reconnects automatically, and on reconnect the server
        // replays the job's CURRENT state as the initial frame — so transient
        // drops self-heal (errorCount resets on every received frame). Give up
        // when the browser has permanently closed the connection (e.g. the
        // finished job was evicted server-side and the endpoint now 404s), or
        // after repeated failures with no successful frame in between.
        errorCount += 1;
        if (source.readyState !== EventSource.CLOSED && errorCount < 5) return;
        setProgress((prev) =>
          prev.status === 'running'
            ? { ...prev, status: 'failed', error: prev.error ?? 'Lost connection to the creation stream.' }
            : prev,
        );
        close();
      };
    },
    [close, queryClient],
  );

  const reset = useCallback(() => {
    close();
    setProgress(IDLE);
  }, [close]);

  return { progress, start, reset };
}
