import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type IBufferLine } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Button } from '../../components/ui/button.js';
import { Select, SelectTrigger, SelectPopup, SelectItem } from '../../components/ui/select.js';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { Plus, History, RefreshCw, ExternalLink, Square, Search, Copy, PlugZap, WifiOff } from 'lucide-react';
import { useFloatingChat } from '../chat/floatingChatStore.js';
import { ResumeSessions } from './ResumeSessions.js';
import { apiFetch } from '../../lib/api/client.js';
import { clipboardHtmlToText, readClipboardText, safeCopyToClipboard } from '../../lib/clipboard.js';
import { terminalRequest, terminalToken, terminalSocketUrl, type TerminalInfo, type TerminalLaunch, type TerminalStatus } from './client.js';
import { findFileReferences, type FileReference } from './fileReferences.js';

interface Props { workspace: string; active: boolean; launch?: TerminalLaunch; consumeLaunch: (id: string) => void; onOpenFileReference?: (reference: Pick<FileReference, 'path' | 'line'>) => void; codeVisible?: boolean; onStatusChange?: (status: 'idle' | 'running' | 'exited' | 'disconnected') => void; onBackgroundOutput?: () => void }
export function TerminalPane({ workspace, active, launch, consumeLaunch, onOpenFileReference, codeVisible, onStatusChange, onBackgroundOutput }: Props) {
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
  useEffect(() => { if (codeVisible && terminal) setShowHistory(false); }, [codeVisible, terminal]);
  useEffect(() => { if (terminal) setShowHistory(false); }, [terminal]);
  const [state, setState] = useState('Choose a CLI tool');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [screenReader, setScreenReader] = useState(false);
  const [clipboardMenu, setClipboardMenu] = useState<{ x: number; y: number } | null>(null);
  const menuSelection = useRef('');
  const launchSeen = useRef('');
  const lastLaunch = useRef<TerminalLaunch | undefined>(undefined);
  const [retryLaunch, setRetryLaunch] = useState<TerminalLaunch | undefined>(undefined);
  const activeRef = useRef(active);
  const openFileRef = useRef(onOpenFileReference);
  const statusChangeRef = useRef(onStatusChange);
  const backgroundOutputRef = useRef(onBackgroundOutput);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { openFileRef.current = onOpenFileReference; }, [onOpenFileReference]);
  useEffect(() => { statusChangeRef.current = onStatusChange; backgroundOutputRef.current = onBackgroundOutput; }, [onStatusChange, onBackgroundOutput]);
  useEffect(() => {
    const status = state.startsWith('Connected') ? 'running' : state.startsWith('Exited') ? 'exited' : state.startsWith('Disconnected') ? 'disconnected' : 'idle';
    statusChangeRef.current?.(status);
  }, [state]);
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
    const terminalHost = host.current;
    const onPasteShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'v') {
        // Keep Ctrl+V out of the PTY: Codex interprets a literal Ctrl+V as
        // its image-paste command on Windows. The browser still dispatches its
        // ordinary paste event to xterm's focused textarea.
        event.stopPropagation();
      }
    };
    terminalHost.addEventListener('keydown', onPasteShortcut, true);
    const onPaste = (event: ClipboardEvent) => {
      const clipboard = event.clipboardData;
      if (!clipboard || clipboard.getData('text/plain')) return;
      const richText = clipboardHtmlToText(clipboard.getData('text/html'));
      if (richText.trim()) {
        event.preventDefault(); event.stopPropagation();
        if (!term.options.disableStdin) term.paste(richText);
      } else if ([...clipboard.items].some(item => item.type.startsWith('image/')) || [...clipboard.files].some(file => file.type.startsWith('image/'))) {
        event.preventDefault(); event.stopPropagation();
        setError('The clipboard contains an image but no text. Use Chat to attach the image, or copy text and paste again.');
      }
    };
    terminalHost.addEventListener('paste', onPaste, true);
    // A selected terminal range behaves like selected browser text. Without a
    // selection Ctrl+C remains the terminal's interrupt key.
    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && (event.shiftKey || term.hasSelection())) {
        event.preventDefault();
        void safeCopyToClipboard(term.getSelection()).then(copied => {
          if (!copied) setError('Select terminal output before copying, or check clipboard permissions.');
          else setError('');
        });
        return false;
      }
      // Let the browser dispatch its native paste event into xterm's textarea.
      // xterm handles that event, including bracketed paste for CLI harnesses.
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return false;
      return true;
    });
    const links = term.registerLinkProvider({ provideLinks(bufferLineNumber, callback) {
      const buffer = term.buffer.active;
      let first = bufferLineNumber - 1;
      while (first > 0 && buffer.getLine(first)?.isWrapped && bufferLineNumber - first <= 20) first--;
      if (buffer.getLine(first)?.isWrapped) { callback([]); return; }
      let last = bufferLineNumber - 1;
      while (buffer.getLine(last + 1)?.isWrapped && last - first < 20) last++;
      if (buffer.getLine(last + 1)?.isWrapped) { callback([]); return; }
      const rows: { line: IBufferLine; text: string }[] = [];
      for (let at = first; at <= last; at++) {
        const line = buffer.getLine(at);
        if (!line) { callback([]); return; }
        rows.push({ line, text: line.translateToString(at === last) });
      }
      const positionAt = (offset: number, ending: boolean) => {
        let before = 0;
        for (let row = 0; row < rows.length; row++) {
          const length = rows[row].text.length;
          if (offset < before + length || (ending && offset === before + length) || row === rows.length - 1) {
            const local = Math.max(0, offset - before);
            let column = 0;
            while (column < term.cols && rows[row].line.translateToString(false, 0, column).length < local) column++;
            return { x: column + (ending ? 0 : 1), y: first + row + 1 };
          }
          before += length;
        }
        return { x: 1, y: first + 1 };
      };
      callback(findFileReferences(rows.map(row => row.text).join('')).map(reference => ({
        text: reference.text,
        range: { start: positionAt(reference.start, false), end: positionAt(reference.end, true) },
        activate: () => openFileRef.current?.({ path: reference.path, line: reference.line }),
      })));
    } });
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
    return () => { terminalHost.removeEventListener('keydown', onPasteShortcut, true); terminalHost.removeEventListener('paste', onPaste, true); observer.disconnect(); links.dispose(); input.dispose(); resize.dispose(); term.dispose(); renderer.current = null; };
  }, [send]);
  useEffect(() => {
    if (!active || !terminal) return;
    // The mode switch first reveals a previously hidden terminal. Wait for that
    // layout before fitting and focusing xterm's real input textarea.
    const frame = requestAnimationFrame(() => {
      if (!activeRef.current || !host.current?.getClientRects().length) return;
      fit.current?.fit();
      renderer.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, terminal]);
  useEffect(() => { if (renderer.current) renderer.current.options.screenReaderMode = screenReader; }, [screenReader]);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    let ws: WebSocket | undefined;
    let ended = terminal.state === 'exited';
    let replayed = false;
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
          if (replayed && !activeRef.current) backgroundOutputRef.current?.();
          term.write(message.data, () => { if (!cancelled && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', count: message.data.length })); });
        } else if (message.type === 'replayed') {
          replayed = true;
          term.write('', () => {
            if (cancelled) return;
            term.options.disableStdin = ended;
            setState(ended ? 'Exited' : 'Connected');
            if (!ended) { fit.current?.fit(); send({ type: 'resize', cols: Math.min(term.cols, 500), rows: Math.min(term.rows, 300) }); if (activeRef.current) term.focus(); }
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
    lastLaunch.current = request; setRetryLaunch(request); setBusy(true); setError(''); setTarget(request.target);
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
  const copySelection = async (captured?: string) => {
    try {
      const selected = captured || renderer.current?.getSelection() || '';
      if (!selected) {
        setError('Select terminal output before copying.');
        return;
      }
      if (!await safeCopyToClipboard(selected)) setError('Could not copy terminal output. Check browser clipboard permissions.');
      else setError('');
    } finally {
      // The context-menu button is removed after click. Focus on the next
      // frame so its unmount cannot steal focus back from xterm's textarea.
      requestAnimationFrame(() => renderer.current?.focus());
    }
  };
  const pasteClipboard = async () => {
    setClipboardMenu(null);
    try {
      const value = await readClipboardText();
      if (!value) throw new Error('Clipboard has no text');
      if (!renderer.current || renderer.current.options.disableStdin) throw new Error('Reconnect the terminal before pasting.');
      renderer.current.paste(value);
      renderer.current.focus();
      setError('');
    } catch {
      setError('No clipboard text was available. Focus the terminal and press Ctrl+V (or Cmd+V); attach image-only content in Chat.');
    }
  };
  const external = async () => {
    setError('');
    try {
      const request = lastLaunch.current;
      await apiFetch(`/api/workspace/${encodeURIComponent(workspace)}/terminal`, { method: 'POST', body: JSON.stringify({ ...(target !== 'shell' ? { assistant: target } : {}), ...(request?.target === target ? { sessionId: request.sessionId, cwd: request.cwd } : {}) }) });
    } catch (e) { setError((e as Error).message); }
  };
  const chosenTool = status?.targets.find(item => item.id === target);
  const canStart = !busy && !!status?.available && !!chosenTool?.available;
  const toolHint = !status
    ? 'Checking available CLI tools…'
    : !status.available
      ? status.reason || 'The local terminal service is unavailable. Refresh after it is ready.'
      : !status.targets.length
        ? 'No CLI tools were found. Install a CLI harness, then refresh the list.'
        : target && !chosenTool
          ? 'The saved CLI tool is no longer listed. Choose another tool for this workspace.'
          : chosenTool && !chosenTool.available
            ? `${harnessName(target)} is unavailable: ${chosenTool.reason || 'not installed'}. Choose another tool or refresh after installing it.`
            : target
              ? `${harnessName(target)} is ready. The session starts only when you press Start session.`
              : 'Choose a CLI tool to start a new session. Your choice is remembered for this workspace.';
  const harnessSelect = <Select value={target || null} onValueChange={value => { if (typeof value === 'string') setTarget(value); }}>
    <SelectTrigger aria-label="CLI harness" size="sm" className="w-auto min-w-40 text-xs">{target ? <span className="flex items-center gap-2"><HarnessIcon harness={target} />{harnessName(target)}</span> : 'Choose a CLI tool'}</SelectTrigger>
    <SelectPopup popupClassName="w-60 max-w-[calc(100vw-2rem)]">{(status?.targets ?? []).map(item => <SelectItem key={item.id} value={item.id} disabled={!item.available} title={item.reason || undefined}><span className="flex min-w-0 items-center gap-2"><HarnessIcon harness={item.id} /><span className="truncate">{harnessName(item.id)}</span>{!item.available && <span className="text-[10px] text-muted-foreground">· Unavailable<span className="sr-only">: {item.reason || 'Not installed'}</span></span>}</span></SelectItem>)}</SelectPopup>
  </Select>;
  const startButton = <Button size="xs" onClick={() => void start({ id: crypto.randomUUID(), target })} disabled={!canStart}><Plus className="size-3" />{busy ? 'Starting…' : 'Start session'}</Button>;
  return <div className="flex h-full min-h-0 flex-col" data-testid="terminal-pane">
    {!terminal && <div className="border-b border-border px-3 py-3">
      <p className="mb-2 text-xs font-semibold text-foreground">What would you like to do in {workspace}?</p>
      <div role="group" aria-label="Choose a CLI chat path" className="flex flex-wrap gap-2">
        <Button size="sm" variant={showHistory ? 'secondary' : 'outline'} aria-pressed={showHistory} onClick={() => setShowHistory(true)}><History className="size-3.5" />Continue a conversation</Button>
        <Button size="sm" variant={!showHistory ? 'secondary' : 'outline'} aria-pressed={!showHistory} onClick={() => setShowHistory(false)}><Plus className="size-3.5" />Start new session</Button>
      </div>
    </div>}
    {terminal && <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      {harnessSelect}
      {startButton}
      <Button size="xs" variant={showHistory ? 'secondary' : 'ghost'} aria-pressed={showHistory} onClick={() => setShowHistory(value => !value)}><History className="size-3" />Resume session</Button>
      <Button size="xs" variant="ghost" title="Refresh installed harnesses" onClick={() => void refresh()}><RefreshCw className="size-3" />Refresh</Button>
      <Button size="xs" variant="ghost" disabled={!target} onClick={() => void external()}><ExternalLink className="size-3" />External terminal</Button>
      <Button size="xs" variant="ghost" onClick={() => void stop()}><Square className="size-3" />End session</Button>
    </div>}
    {error && <div role="alert" className="border-b border-border px-3 py-2 text-xs text-amber-600 break-words">{error}{retryLaunch && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void start(retryLaunch)}>Retry launch</Button>}</div>}
    {showHistory && <ResumeSessions workspace={workspace} active={active} busy={busy} status={status} fill={!terminal} onStartNew={() => setShowHistory(false)} onResume={session => void start({ id: crypto.randomUUID(), target: session.assistant, sessionId: session.id, cwd: session.workspacePath })} />}
    {!terminal && !showHistory && <section aria-label="Start a new CLI session" className="flex-1 space-y-3 overflow-auto px-3 py-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Start a new session</h3>
        <p className="mt-1 text-xs text-muted-foreground">Use a CLI tool in this workspace. It keeps its own login and permissions.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">{harnessSelect}{startButton}</div>
      <p role="status" className="text-xs text-muted-foreground">{toolHint}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="ghost" onClick={() => void refresh()}><RefreshCw className="size-3" />Refresh tools</Button>
        <Button size="xs" variant="ghost" disabled={!target} onClick={() => void external()}><ExternalLink className="size-3" />External terminal</Button>
      </div>
    </section>}
    {!!status?.sessions.length && <div className="px-3 py-1 border-b border-border">
      <select aria-label="Terminal sessions" className="max-w-full bg-card text-xs" value={terminal?.id ?? ''} onChange={e => { const selected = status.sessions.find(s => s.id === e.target.value) ?? null; setTerminal(selected); if (selected) setTarget(selected.target); }}>
        <option value="" disabled>Select a terminal</option>{status.sessions.map(s => <option key={s.id} value={s.id}>{s.label} · {s.state} · {s.id.slice(0, 8)}</option>)}
      </select>
    </div>}
    {terminal && state.startsWith('Disconnected') && <div data-testid="terminal-disconnected" role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
      <WifiOff className="size-4 shrink-0 text-amber-600" aria-hidden="true" />
      <span className="min-w-0 flex-1"><strong>CLI chat disconnected.</strong> Input is paused; the session may still be running.</span>
      <Button size="xs" variant="outline" onClick={() => setRetry(value => value + 1)}><PlugZap className="size-3" />Reconnect CLI</Button>
    </div>}
    <div className={`relative min-h-0 flex-1 bg-[#111b18] p-2 ${terminal ? '' : 'hidden'}`} onPointerDownCapture={event => {
      if (event.button === 2) menuSelection.current = renderer.current?.getSelection() ?? '';
    }} onContextMenu={event => {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      setClipboardMenu({ x: Math.min(event.clientX - bounds.left, Math.max(0, bounds.width - 150)), y: Math.min(event.clientY - bounds.top, Math.max(0, bounds.height - 80)) });
    }}>
      {/* FitAddon measures this element's height; keep padding on its parent so the last row fits. */}
      <div ref={host} className="h-full overflow-hidden" aria-label="Interactive CLI terminal" />
      {clipboardMenu && <div className="absolute z-20 min-w-36 rounded border border-border bg-card p-1 shadow-lg" style={{ left: clipboardMenu.x, top: clipboardMenu.y }} role="menu" onKeyDown={event => { if (event.key === 'Escape') setClipboardMenu(null); }}>
        <button role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => { setClipboardMenu(null); void copySelection(menuSelection.current); menuSelection.current = ''; }}>Copy selection</button>
        <button role="menuitem" className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-accent" onClick={() => void pasteClipboard()}>Paste</button>
      </div>}
    </div>
    {terminal && <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1 text-xs">
      <span role="status">{state}</span>
      <Button size="xs" variant="ghost" onClick={() => setRetry(n => n + 1)}><PlugZap className="size-3" />Reconnect</Button>
      <input aria-label="Search terminal output" placeholder="Search output" className="w-28 rounded border border-border bg-card px-1" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search.current?.findNext(query); }} />
      <Button size="xs" variant="ghost" onClick={() => search.current?.findNext(query)}><Search className="size-3" />Find</Button>
      <Button size="xs" variant="ghost" onClick={() => void copySelection()}><Copy className="size-3" />Copy selection</Button>
      <label className="flex items-center gap-1"><input type="checkbox" checked={screenReader} onChange={e => setScreenReader(e.target.checked)} />Screen reader</label>
    </div>}
    {terminal && <div className="truncate px-3 pb-1 text-[10px] text-muted-foreground" title={terminal.cwd}>Local user permissions · {terminal.cwd} · Hide keeps running; End session stops it.</div>}
  </div>;
}
