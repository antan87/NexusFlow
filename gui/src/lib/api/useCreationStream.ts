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

      source.addEventListener('progress', (event) => {
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
        // The server closes the stream when the job ends; only treat it as a
        // failure if we never saw a terminal status.
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
