import { useCallback, useEffect, useRef, useState } from 'react';

import { API_BASE } from '../../lib/apiBase.js';

/** Trailing scrollback kept in the browser buffer (~500KB of log text). */
const MAX_LOG_CHARS = 512_000;

interface LogStreamState {
  logs: string;
  connected: boolean;
}

/**
 * Live-tails a service's log via SSE. Backfills the trailing content over a
 * plain GET (learning the byte offset), then opens an EventSource from that
 * offset and appends `log` chunks. `clear()` empties the local buffer. On a
 * stream error the connection is reopened from a fresh backfill (native
 * EventSource reconnect would reuse a now-stale offset).
 */
export function useServiceLogStream(
  wsId: string | null,
  serviceName: string | null,
  enabled: boolean,
): { logs: string; connected: boolean; clear: () => void } {
  const [state, setState] = useState<LogStreamState>({ logs: '', connected: false });
  const sourceRef = useRef<EventSource | null>(null);
  const cancelledRef = useRef(false);

  const clear = useCallback(() => setState((s) => ({ ...s, logs: '' })), []);

  useEffect(() => {
    cancelledRef.current = false;
    sourceRef.current?.close();
    sourceRef.current = null;
    setState({ logs: '', connected: false });

    if (!enabled || !wsId || !serviceName) return;

    const encWs = encodeURIComponent(wsId);
    const encName = encodeURIComponent(serviceName);
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelledRef.current) return;
      let offset = 0;
      try {
        const res = await fetch(`${API_BASE}/api/workspace/${encWs}/services/logs/${encName}`);
        const data = await res.json();
        if (cancelledRef.current) return;
        offset = typeof data.size === 'number' ? data.size : 0;
        setState({ logs: typeof data.logs === 'string' ? data.logs : '', connected: false });
      } catch {
        // Backfill failed — stream from offset 0.
      }
      if (cancelledRef.current) return;

      const source = new EventSource(
        `${API_BASE}/api/workspace/${encWs}/services/logs/${encName}/stream?offset=${offset}`,
      );
      sourceRef.current = source;

      source.addEventListener('open', () => {
        if (!cancelledRef.current) setState((s) => ({ ...s, connected: true }));
      });
      source.addEventListener('log', (event) => {
        try {
          const { chunk } = JSON.parse((event as MessageEvent).data);
          if (typeof chunk === 'string' && !cancelledRef.current) {
            setState((s) => {
              const next = s.logs + chunk;
              // Cap the client-side scrollback so a long, chatty stream can't
              // grow the buffer without bound; keep the trailing window.
              return { ...s, logs: next.length > MAX_LOG_CHARS ? next.slice(-MAX_LOG_CHARS) : next };
            });
          }
        } catch {
          // Ignore malformed frames.
        }
      });
      source.onerror = () => {
        source.close();
        sourceRef.current = null;
        if (cancelledRef.current) return;
        setState((s) => ({ ...s, connected: false }));
        // Reopen from a fresh backfill so the offset stays correct.
        retry = setTimeout(connect, 2000);
      };
    };

    void connect();

    return () => {
      cancelledRef.current = true;
      if (retry) clearTimeout(retry);
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [wsId, serviceName, enabled]);

  return { logs: state.logs, connected: state.connected, clear };
}
