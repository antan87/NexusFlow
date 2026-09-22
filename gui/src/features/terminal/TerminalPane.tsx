import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Button } from '../../components/ui/button.js';
import { Select, SelectTrigger, SelectPopup, SelectItem } from '../../components/ui/select.js';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { Plus, History, RefreshCw, ExternalLink, Square, Search, Copy, PlugZap } from 'lucide-react';
import { useFloatingChat } from '../chat/floatingChatStore.js';
import { ResumeSessions } from './ResumeSessions.js';
import { apiFetch } from '../../lib/api/client.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { terminalRequest, terminalToken, terminalSocketUrl, type TerminalInfo, type TerminalLaunch, type TerminalStatus } from './client.js';

interface Props { workspace: string; active: boolean; launch?: TerminalLaunch; consumeLaunch: (id: string) => void }
export function TerminalPane({ workspace, active, launch, consumeLaunch }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const renderer = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const search = useRef<SearchAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<TerminalStatus | null>(null);
  const { harnesses, setHarness } = useFloatingChat();
  const target = harnesses[workspace] ?? '';
  const setTarget = useCallback((value: string) => setHarness(workspace, value), [workspace, setHarness]);
  const [showHistory, setShowHistory] = useState(true);
  const [terminal, setTerminal] = useState<TerminalInfo | null>(null);
  const [state, setState] = useState('Choose a harness or shell');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [screenReader, setScreenReader] = useState(false);
  const launchSeen = useRef('');
  const lastLaunch = useRef<TerminalLaunch | undefined>(undefined);
  const send = useCallback((message: object) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message)); }, []);
  const refresh = useCallback(async () => {
    try {
      const next = await terminalRequest<TerminalStatus>(workspace, 'status');
      setStatus(next);
      // Recover backend-owned sessions after reloading or reopening a workspace.
      setTerminal(current => current ?? next.sessions.find(s => s.state === 'running') ?? null);
      if (!next.available) setError(next.reason || 'Native terminal support is unavailable.');
    } catch (e) { setError((e as Error).message); }
  }, [workspace]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    // Older saved window state has no harness choice. Recover the actual tool.
    if (terminal && !target) setTarget(terminal.target);
  }, [terminal, target, setTarget]);
  useEffect(() => {
    // Renew the browser owner cookie for long-running, even hidden sessions.
    const timer = window.setInterval(() => { void terminalToken().catch(() => {}); }, 4 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({ cursorBlink: true, fontFamily: '"JetBrains Mono", monospace', fontSize: 13, scrollback: 5000, allowProposedApi: false, theme: { background: '#111b18', foreground: '#e1e9e4', cursor: '#a3dbae' } });
    const sizing = new FitAddon(), searching = new SearchAddon();
    term.loadAddon(sizing); term.loadAddon(searching); term.open(host.current);
    renderer.current = term; fit.current = sizing; search.current = searching;
    const input = term.onData(data => {
      // Never queue keystrokes while disconnected, replaying, or after exit.
      if (term.options.disableStdin) return;
      for (let at = 0; at < data.length;) {
        let end = Math.min(at + 8192, data.length);
        if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1])) end--;
        send({ type: 'input', data: data.slice(at, end) }); at = end;
      }
    });
    term.options.disableStdin = true;
    const resize = term.onResize(({ cols, rows }) => { if (!term.options.disableStdin) send({ type: 'resize', cols: Math.min(cols, 500), rows: Math.min(rows, 300) }); });
    const observer = new ResizeObserver(() => { if (host.current?.clientWidth && host.current?.clientHeight) sizing.fit(); });
    observer.observe(host.current);
    return () => { observer.disconnect(); input.dispose(); resize.dispose(); term.dispose(); renderer.current = null; };
  }, [send]);
  useEffect(() => { if (active) { fit.current?.fit(); renderer.current?.focus(); } }, [active]);
  useEffect(() => { if (renderer.current) renderer.current.options.screenReaderMode = screenReader; }, [screenReader]);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    let ws: WebSocket | undefined;
    let ended = terminal.state === 'exited';
    const term = renderer.current;
    if (!term) return;
    term.reset(); term.options.disableStdin = true; setState('Connecting…');
    void terminalToken().then(token => {
      if (cancelled) return;
      ws = new WebSocket(terminalSocketUrl()); socket.current = ws;
      ws.onopen = () => ws!.send(JSON.stringify({ type: 'attach', token, workspace, id: terminal.id }));
      ws.onmessage = event => {
        if (cancelled) return;
        const message = JSON.parse(String(event.data));
        if (message.type === 'ready') {
          ended = message.terminal.state === 'exited';
          setError(message.truncated ? 'Earlier output was trimmed. This is a partial screen replay; use the harness redraw command if needed.' : '');
          setState('Restoring terminal…');
        } else if (message.type === 'output' && typeof message.data === 'string') {
          term.write(message.data, () => { if (!cancelled && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', count: message.data.length })); });
        } else if (message.type === 'replayed') {
          term.write('', () => {
            if (cancelled) return;
            term.options.disableStdin = ended;
            setState(ended ? 'Exited' : 'Connected');
            if (!ended) { fit.current?.fit(); send({ type: 'resize', cols: Math.min(term.cols, 500), rows: Math.min(term.rows, 300) }); if (active) term.focus(); }
          });
        } else if (message.type === 'exit') {
          ended = true; term.options.disableStdin = true; setState(`Exited${message.exitCode == null ? '' : ` (${message.exitCode})`}`);
          setStatus(current => current && ({ ...current, sessions: current.sessions.map(s => s.id === terminal.id ? { ...s, state: 'exited' } : s) }));
        } else if (message.type === 'error') { setError(message.message); term.options.disableStdin = true; }
      };
      ws.onclose = () => { if (!cancelled) { term.options.disableStdin = true; setState(ended ? 'Exited' : 'Disconnected · input paused'); } };
      ws.onerror = () => { if (!cancelled) setError('Connection failed. Reconnect to the existing terminal; it may still be running.'); };
    }).catch(e => { if (!cancelled) { setError((e as Error).message); setState('Disconnected · input paused'); } });
    return () => { cancelled = true; term.options.disableStdin = true; ws?.close(); if (socket.current === ws) socket.current = null; };
    // Visibility changes only resize; they must never open another connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal?.id, retry, workspace, send]);

  const start = useCallback(async (request: TerminalLaunch) => {
    lastLaunch.current = request; setBusy(true); setError(''); setTarget(request.target);
    try {
      const { terminal: created } = await terminalRequest<{ terminal: TerminalInfo }>(workspace, 'create', { launchId: request.id, target: request.target, sessionId: request.sessionId, cwd: request.cwd });
      setTerminal(created);
      setShowHistory(false);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [workspace, refresh, setTarget]);
  useEffect(() => {
    if (!launch || launchSeen.current === launch.id) return;
    launchSeen.current = launch.id;
    void start(launch).finally(() => consumeLaunch(launch.id));
  }, [launch, start, consumeLaunch]);

  const stop = async () => {
    if (!terminal || !window.confirm('End this terminal and its running commands?')) return;
    try { await terminalRequest(workspace, `${terminal.id}/stop`); await refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  const external = async () => {
    setError('');
    try {
      const request = lastLaunch.current;
      await apiFetch(`/api/workspace/${encodeURIComponent(workspace)}/terminal`, { method: 'POST', body: JSON.stringify({ ...(target !== 'shell' ? { assistant: target } : {}), ...(request?.target === target ? { sessionId: request.sessionId, cwd: request.cwd } : {}) }) });
    } catch (e) { setError((e as Error).message); }
  };
  return <div className="flex h-full min-h-0 flex-col" data-testid="terminal-pane">
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <Select value={target || null} onValueChange={value => { if (typeof value === 'string') setTarget(value); }}>
        <SelectTrigger aria-label="CLI harness" size="sm" className="w-auto min-w-40 text-xs">{target ? <span className="flex items-center gap-2"><HarnessIcon harness={target} />{harnessName(target)}</span> : 'Choose a harness'}</SelectTrigger>
        <SelectPopup>{(status?.targets ?? []).map(t => <SelectItem key={t.id} value={t.id}><span className="flex items-center gap-2"><HarnessIcon harness={t.id} />{harnessName(t.id)}{!t.available && <span className="text-muted-foreground">· Not installed</span>}</span></SelectItem>)}</SelectPopup>
      </Select>
      <Button size="xs" onClick={() => void start({ id: crypto.randomUUID(), target })} disabled={busy || !status?.available || !target || !status.targets.find(t => t.id === target)?.available}><Plus className="size-3" />{busy ? 'Starting…' : 'Start session'}</Button>
      <Button size="xs" variant={showHistory ? 'secondary' : 'ghost'} aria-pressed={showHistory} onClick={() => setShowHistory(value => !value)}><History className="size-3" />Resume session</Button>
      <Button size="xs" variant="ghost" title="Refresh installed harnesses" onClick={() => void refresh()}><RefreshCw className="size-3" />Refresh</Button>
      <Button size="xs" variant="ghost" disabled={!target} onClick={() => void external()}><ExternalLink className="size-3" />External terminal</Button>
      {terminal && <Button size="xs" variant="ghost" onClick={() => void stop()}><Square className="size-3" />End session</Button>}
    </div>
    {showHistory && <ResumeSessions workspace={workspace} active={active} busy={busy} status={status} onResume={session => void start({ id: crypto.randomUUID(), target: session.assistant, sessionId: session.id, cwd: session.workspacePath })} />}
    {!!status?.sessions.length && <div className="px-3 py-1 border-b border-border">
      <select aria-label="Terminal sessions" className="max-w-full bg-card text-xs" value={terminal?.id ?? ''} onChange={e => { const selected = status.sessions.find(s => s.id === e.target.value) ?? null; setTerminal(selected); if (selected) setTarget(selected.target); }}>
        <option value="" disabled>Select a terminal</option>{status.sessions.map(s => <option key={s.id} value={s.id}>{s.label} · {s.state} · {s.id.slice(0, 8)}</option>)}
      </select>
    </div>}
    {error && <div role="alert" className="border-b border-border px-3 py-2 text-xs text-amber-600 break-words">{error}{lastLaunch.current && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void start(lastLaunch.current!)}>Retry launch</Button>}</div>}
    {!terminal && <div className="flex-1 px-3 py-3 text-xs text-muted-foreground">Choose a harness for a new session, or resume a saved conversation above. The harness keeps its own login and permissions. Shell opens PowerShell or your Unix shell. Existing API conversations remain under Chat.</div>}
    <div ref={host} className={`min-h-0 flex-1 overflow-hidden bg-[#111b18] p-2 ${terminal ? '' : 'hidden'}`} aria-label="Interactive CLI terminal" />
    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1 text-xs">
      <span role="status">{state}</span>
      {terminal && <Button size="xs" variant="ghost" onClick={() => setRetry(n => n + 1)}><PlugZap className="size-3" />Reconnect</Button>}
      <input aria-label="Search terminal output" placeholder="Search output" className="w-28 rounded border border-border bg-card px-1" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search.current?.findNext(query); }} />
      <Button size="xs" variant="ghost" onClick={() => search.current?.findNext(query)}><Search className="size-3" />Find</Button>
      <Button size="xs" variant="ghost" onClick={() => void safeCopyToClipboard(renderer.current?.getSelection() ?? '')}><Copy className="size-3" />Copy selection</Button>
      <label className="flex items-center gap-1"><input type="checkbox" checked={screenReader} onChange={e => setScreenReader(e.target.checked)} />Screen reader</label>
    </div>
    <div className="truncate px-3 pb-1 text-[10px] text-muted-foreground" title={terminal?.cwd}>Local user permissions · {terminal?.cwd ?? workspace} · Hide keeps running; End session stops it.</div>
  </div>;
}
