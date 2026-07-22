import { useCallback, useEffect, useState } from 'react';

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

  const clear = useCallback(() => setState((s) => ({ ...s, logs: '' })), []);

  useEffect(() => {
    // Per-run cancellation flag and source, closed over by this effect run only.
    // A component-level ref would be reset by the next run's setup and thus
    // un-cancel an in-flight connect() from the previous run — leaking its
    // EventSource and bleeding the old service's logs into the new selection.
    let cancelled = false;
    let currentSource: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    setState({ logs: '', connected: false });

    if (!enabled || !wsId || !serviceName) return;

    const encWs = encodeURIComponent(wsId);
    const encName = encodeURIComponent(serviceName);

    const connect = async () => {
      if (cancelled) return;
      let offset = 0;
      try {
        const res = await fetch(`${API_BASE}/api/workspace/${encWs}/services/logs/${encName}`);
        const data = await res.json();
        if (cancelled) return;
        offset = typeof data.size === 'number' ? data.size : 0;
        setState({ logs: typeof data.logs === 'string' ? data.logs : '', connected: false });
      } catch {
        // Backfill failed — stream from offset 0.
      }
      if (cancelled) return;

      const source = new EventSource(
        `${API_BASE}/api/workspace/${encWs}/services/logs/${encName}/stream?offset=${offset}`,
      );
      currentSource = source;

      source.addEventListener('open', () => {
        if (!cancelled) setState((s) => ({ ...s, connected: true }));
      });
      source.addEventListener('log', (event) => {
        try {
          const { chunk } = JSON.parse((event as MessageEvent).data);
          if (typeof chunk === 'string' && !cancelled) {
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
        if (currentSource === source) currentSource = null;
        if (cancelled) return;
        setState((s) => ({ ...s, connected: false }));
        // Reopen from a fresh backfill so the offset stays correct.
        retry = setTimeout(connect, 2000);
      };
    };

    void connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      currentSource?.close();
      currentSource = null;
    };
  }, [wsId, serviceName, enabled]);

  return { logs: state.logs, connected: state.connected, clear };
}
