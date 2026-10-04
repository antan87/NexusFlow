import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal, type IBufferLine } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { Button } from '../../components/ui/button.js';
import { IconButton } from '../../components/ui/icon-button.js';
import { Menu, MenuItem, MenuPopup, MenuSearchInput, MenuTrigger } from '../../components/ui/menu.js';
import { Select, SelectTrigger, SelectPopup, SelectItem } from '../../components/ui/select.js';
import { HarnessIcon, harnessName } from '../../components/icons/HarnessIcon.js';
import { Plus, History, RefreshCw, ExternalLink, Square, Search, Copy, PlugZap, WifiOff, MoreHorizontal } from 'lucide-react';
import { useFloatingChat } from '../chat/floatingChatStore.js';
import { ResumeSessions } from './ResumeSessions.js';
import { findTerminalUsageSession, SessionUsageDetails } from './SessionUsage.js';
import { apiFetch } from '../../lib/api/client.js';
import { clipboardHtmlToText, readClipboardText, safeCopyToClipboard } from '../../lib/clipboard.js';
import { terminalRequest, terminalToken, terminalSocketUrl, type TerminalInfo, type TerminalLaunch, type TerminalStatus } from './client.js';
import { findFileReferences, type FileReference } from './fileReferences.js';
import { toPromptText } from './promptFill.js';
import { SHIFT_ENTER_SEQUENCE, terminalKeyAction } from './terminalKeys.js';
import type { AISession } from '../../types.js';

/**
 * Transport state of the pane, as a closed union.
 *
 * This used to be a free-form string inspected with `startsWith('Connected')`
 * and friends at four call sites, so rewording a message silently broke the
 * status label, the tab dot and the `aria-label` together.
 */
type PaneState =
  | { kind: 'connecting' }
  | { kind: 'running' }
  | { kind: 'exited'; code: number | null; early?: boolean }
  | { kind: 'disconnected'; detail?: string }
  /** The backend no longer has this terminal: it expired or the backend restarted. */
  | { kind: 'ended' };

/** A harness that exits with an error this soon after starting could not begin its work. */
const EARLY_EXIT_MS = 15_000;

const PANE_STATE_LABEL: Record<PaneState['kind'], string> = {
  connecting: 'Connecting…',
  running: 'Running',
  exited: 'Exited',
  disconnected: 'Disconnected',
  ended: 'Ended',
};

const PANE_STATE_HELP: Record<PaneState['kind'], string> = {
  connecting: 'Input is paused while the terminal connects.',
  running: 'Input is ready. Hiding this window keeps the CLI running.',
  exited: 'The terminal has stopped. Its output stays available.',
  disconnected: 'Input is paused. The CLI keeps running for up to 5 minutes without a connected window; reconnect to continue.',
  ended: 'This terminal is no longer running. Terminals end when ContextSpace restarts or after 5 minutes with no window connected.',
};

/** Reported to the modal, which paints the per-tab status dot. */
export type PaneStatus = 'idle' | 'running' | 'exited' | 'disconnected';

const paneStatusFor = (kind: PaneState['kind']): PaneStatus => {
  switch (kind) {
    case 'running': return 'running';
    case 'disconnected': return 'disconnected';
    case 'exited': case 'ended': return 'exited';
    case 'connecting': return 'idle';
  }
};

interface Props { workspace: string; active: boolean; launch?: TerminalLaunch; consumeLaunch: (id: string) => void; onOpenFileReference?: (reference: Pick<FileReference, 'path' | 'line'>) => void; codeVisible?: boolean; inspectorControls?: ReactNode; inspectorExpandControl?: ReactNode; onStatusChange?: (status: PaneStatus) => void; onBackgroundOutput?: () => void; fillPromptRef?: { current: ((text: string) => boolean) | null };
  /** The developer sent a line to an assistant (not a plain shell): their reply to whatever it asked. */
  onReply?: () => void }
export function TerminalPane({ workspace, active, launch, consumeLaunch, onOpenFileReference, codeVisible, inspectorControls, inspectorExpandControl, onStatusChange, onBackgroundOutput, fillPromptRef, onReply }: Props) {
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
  const [paneState, setPaneState] = useState<PaneState>({ kind: 'connecting' });
  const [endedByUser, setEndedByUser] = useState(false);
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
  const usageHistory = useQuery({
    queryKey: ['terminal-resume-sessions', workspace],
    queryFn: ({ signal }) => apiFetch<{ sessions: AISession[] }>(`/api/workspace/${encodeURIComponent(workspace)}/sessions`, { signal }),
    enabled: active && !!terminal && terminal.target !== 'shell',
    staleTime: 15_000,
    refetchInterval: active && terminal && paneState.kind === 'running' ? 30_000 : false,
  });
  const usageSession = terminal && usageHistory.data
    ? findTerminalUsageSession(terminal, usageHistory.data.sessions, status?.sessions)
    : undefined;
  // Derived from the backend's list, so a refresh after an expiry or restart
  // reports the terminal as ended rather than as a connection problem.
  const gone = !!terminal && !!status && !status.sessions.some(s => s.id === terminal.id);
  const shownState: PaneState = gone ? { kind: 'ended' } : paneState;
  const shownKind = shownState.kind;
  const live = !!terminal && !gone && terminal.state === 'running';
  const activeRef = useRef(active);
  const openFileRef = useRef(onOpenFileReference);
  const statusChangeRef = useRef(onStatusChange);
  const backgroundOutputRef = useRef(onBackgroundOutput);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { openFileRef.current = onOpenFileReference; }, [onOpenFileReference]);
  useEffect(() => { statusChangeRef.current = onStatusChange; backgroundOutputRef.current = onBackgroundOutput; }, [onStatusChange, onBackgroundOutput]);
  const replyRef = useRef(onReply);
  useEffect(() => { replyRef.current = onReply; }, [onReply]);
  // Read by the key handler, which is set up once per terminal.
  const targetRef = useRef<string | undefined>(undefined);
  useEffect(() => { targetRef.current = terminal?.target; }, [terminal]);
  useEffect(() => {
    statusChangeRef.current?.(paneStatusFor(shownKind));
  }, [shownKind]);
  const send = useCallback((message: object) => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message)); }, []);
  // Lets the Where Are We strip type a suggestion into the prompt. It only types: the text has every
  // line break and control character removed, so the developer is the one who presses Enter. Nothing is
  // typed while the terminal is disconnected, replaying or ended, and the caller is told so.
  useEffect(() => {
    if (!fillPromptRef) return;
    fillPromptRef.current = (text: string) => {
      const data = toPromptText(text);
      const term = renderer.current;
      if (!data || !term || term.options.disableStdin || socket.current?.readyState !== WebSocket.OPEN) return false;
      send({ type: 'input', data });
      if (activeRef.current) term.focus();
      return true;
    };
    return () => { fillPromptRef.current = null; };
  }, [fillPromptRef, send]);
  // Only the latest status request may replace the list; an older response that
  // lacks a just-created terminal would otherwise report it as ended.
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    try {
      const next = await terminalRequest<TerminalStatus>(workspace, 'status');
      if (seq !== refreshSeq.current) return;
      setStatus(next);
      // Recover backend-owned sessions after reloading or reopening a workspace.
      // Prefer the backend's view of the session we already track, so a session
      // that exited while the pane was closed is not shown as still running.
      setTerminal(current => next.sessions.find(s => s.id === current?.id) ?? current ?? next.sessions.find(s => s.state === 'running') ?? null);
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
        setError('The clipboard contains an image but no text. Copy text and paste again.');
      }
    };
    terminalHost.addEventListener('paste', onPaste, true);
    term.attachCustomKeyEventHandler(event => {
      switch (terminalKeyAction(event, term.hasSelection())) {
        case 'copy':
          event.preventDefault();
          void safeCopyToClipboard(term.getSelection()).then(copied => {
            if (!copied) setError('Select terminal output before copying, or check clipboard permissions.');
            else setError('');
          });
          return false;
        // Let the browser dispatch its native paste event into xterm's textarea.
        // xterm handles that event, including bracketed paste for CLI harnesses.
        case 'paste':
          return false;
        case 'newline':
          event.preventDefault();
          term.input(SHIFT_ENTER_SEQUENCE);
          return false;
        case 'suppress':
          return false;
        default:
          return true;
      }
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
      // Enter sends the line. To an assistant, the line the developer sends is their reply to what it asked.
      if (data.includes('\r') && targetRef.current && targetRef.current !== 'shell') replyRef.current?.();
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
    // Keyed on the session id: a status refresh replaces the session object and
    // must not pull focus back from another panel into the terminal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, terminal?.id]);
  useEffect(() => { if (renderer.current) renderer.current.options.screenReaderMode = screenReader; }, [screenReader]);

  useEffect(() => {
    if (!terminal) return;
    let cancelled = false;
    let ws: WebSocket | undefined;
    let ended = terminal.state === 'exited';
    let missing = false;
    let replayed = false;
    const term = renderer.current;
    if (!term) return;
    term.reset(); term.options.disableStdin = true; setPaneState({ kind: 'connecting' });
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
          setPaneState({ kind: 'connecting' });
        } else if (message.type === 'output' && typeof message.data === 'string') {
          if (replayed && !activeRef.current) backgroundOutputRef.current?.();
          term.write(message.data, () => { if (!cancelled && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', count: message.data.length })); });
        } else if (message.type === 'replayed') {
          replayed = true;
          term.write('', () => {
            if (cancelled) return;
            term.options.disableStdin = ended;
            // An exit that arrived while the replay flushed keeps its code.
            setPaneState(current => ended ? (current.kind === 'exited' ? current : { kind: 'exited', code: null }) : { kind: 'running' });
            if (!ended) { fit.current?.fit(); send({ type: 'resize', cols: Math.min(term.cols, 500), rows: Math.min(term.rows, 300) }); if (activeRef.current) term.focus(); }
          });
        } else if (message.type === 'exit') {
          const code = message.exitCode ?? null;
          // Measured with the backend's exit time, so a replayed exit is judged the same way.
          const early = terminal.target !== 'shell' && code !== null && code !== 0 && Date.parse(message.exitedAt ?? '') - Date.parse(terminal.startedAt ?? '') < EARLY_EXIT_MS;
          ended = true; term.options.disableStdin = true; setPaneState({ kind: 'exited', code, early });
          setTerminal(current => current?.id === terminal.id ? { ...current, state: 'exited', exitCode: message.exitCode } : current);
          setStatus(current => current && ({ ...current, sessions: current.sessions.map(s => s.id === terminal.id ? { ...s, state: 'exited' } : s) }));
        } else if (message.type === 'error') {
          term.options.disableStdin = true;
          // An ended terminal cannot be reconnected; say so instead of offering Reconnect forever.
          if (message.code === 'terminal_not_found') { missing = true; setError(''); void refresh(); }
          else setError(message.message);
        }
      };
      ws.onclose = () => { if (!cancelled) { term.options.disableStdin = true; setPaneState(missing ? { kind: 'ended' } : ended ? { kind: 'exited', code: null } : { kind: 'disconnected' }); } };
      ws.onerror = () => { if (!cancelled) setError('Connection failed. Reconnect to the existing terminal; it may still be running.'); };
    }).catch(e => { if (!cancelled) { setError((e as Error).message); setPaneState({ kind: 'disconnected' }); } });
    return () => { cancelled = true; term.options.disableStdin = true; ws?.close(); if (socket.current === ws) socket.current = null; };
    // Visibility changes only resize; they must never open another connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminal?.id, retry, workspace, send]);

  const start = useCallback(async (request: TerminalLaunch) => {
    lastLaunch.current = request; setRetryLaunch(request); setBusy(true); setError(''); setTarget(request.target);
    try {
      const { terminal: created } = await terminalRequest<{ terminal: TerminalInfo }>(workspace, 'create', { launchId: request.id, target: request.target, sessionId: request.sessionId, cwd: request.cwd });
      setStatus(current => current && ({ ...current, sessions: [...current.sessions.filter(s => s.id !== created.id), created] }));
      setTerminal(created);
      setShowHistory(false);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [workspace, refresh, setTarget]);
  // A launch for a session that is already running must attach to it. Creating a
  // second terminal would leave two shells on one session and lose the first.
  const resume = useCallback((request: TerminalLaunch): Promise<void> => {
    // Only the backend's list is authoritative: the pane's own copy of an ended
    // terminal still reads as running and must not swallow the resume.
    const existing = request.sessionId && (status?.sessions ?? []).find(item =>
      item.state === 'running' && item.target === request.target && item.sessionId === request.sessionId);
    if (existing) {
      setTerminal(existing);
      setTarget(existing.target);
      setShowHistory(false);
      return Promise.resolve();
    }
    return start(request);
  }, [status, start, setTarget]);
  useEffect(() => {
    if (!launch || launchSeen.current === launch.id) return;
    launchSeen.current = launch.id;
    void resume(launch).finally(() => consumeLaunch(launch.id));
  }, [launch, resume, consumeLaunch]);

  const stop = async () => {
    if (!terminal || !window.confirm('End this terminal and its running commands?')) return;
    try { await terminalRequest(workspace, `${terminal.id}/stop`); setEndedByUser(true); await refresh(); }
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
              ? `${harnessName(target)} is installed and uses its own sign-in. The session starts only when you press Start session.`
              : 'Choose a CLI tool to start a new session. Your choice is remembered for this workspace.';
  const harnessSelect = <Select value={target || null} onValueChange={value => { if (typeof value === 'string') setTarget(value); }}>
    <SelectTrigger aria-label="CLI harness" size="sm" className="w-auto min-w-40 text-xs">{target ? <span className="flex items-center gap-2"><HarnessIcon harness={target} />{harnessName(target)}</span> : 'Choose a CLI tool'}</SelectTrigger>
    <SelectPopup popupClassName="w-60 max-w-[calc(100vw-2rem)]">{(status?.targets ?? []).map(item => <SelectItem key={item.id} value={item.id} disabled={!item.available} title={item.reason || undefined}><span className="flex min-w-0 items-center gap-2"><HarnessIcon harness={item.id} /><span className="truncate">{harnessName(item.id)}</span>{!item.available && <span className="text-[10px] text-muted-foreground">· Unavailable<span className="sr-only">: {item.reason || 'Not installed'}</span></span>}</span></SelectItem>)}</SelectPopup>
  </Select>;
  const startNew = () => void start({ id: crypto.randomUUID(), target });
  // The first start is the way into the chat, so it says what it does. Starting another is a small extra beside a
  // running one, so it is only an icon with its name in a tooltip.
  const startButton = live
    ? <IconButton label="Start another terminal" icon={<Plus />} onClick={startNew} disabled={!canStart} />
    : <Button size="xs" onClick={startNew} disabled={!canStart}><Plus className="size-3" />{busy ? 'Starting…' : 'Start session'}</Button>;
  const disconnected = shownState.kind === 'disconnected';
  const exited = shownState.kind === 'exited' || shownState.kind === 'ended';
  const running = shownState.kind === 'running';
  const stateLabel = shownState.kind === 'exited' && endedByUser ? 'Ended' : shownState.kind === 'exited' && shownState.code != null ? `Exited (${shownState.code})` : PANE_STATE_LABEL[shownState.kind];
  const stateHelp = shownState.kind === 'exited' && shownState.early
    ? `${harnessName(terminal?.target ?? target)} stopped right after starting. Check its output above: if it asks you to sign in or finish setup, do that in an External terminal, then start again.`
    : PANE_STATE_HELP[shownState.kind];
  // Only the backend's link says which conversation an ended terminal ran; the
  // usage heuristic can pick a sibling's conversation once the list is empty.
  const resumableId = terminal && terminal.target !== 'shell' ? terminal.sessionId : undefined;
  const resumeButton = gone && terminal && (resumableId
    ? <Button size="xs" variant="ghost" disabled={busy} onClick={() => void resume({ id: crypto.randomUUID(), target: terminal.target, sessionId: resumableId })}><History className="size-3" />Resume conversation</Button>
    : terminal.target !== 'shell' && <Button size="xs" variant="ghost" onClick={() => setShowHistory(true)}><History className="size-3" />Continue a conversation</Button>);
  const stateDotClass = running ? 'bg-emerald-500' : exited ? 'bg-muted-foreground' : disconnected ? 'bg-warning' : 'bg-amber-500';
  const usageSummary = useMemo(() => {
    if (usageHistory.isPending) return 'Checking session usage…';
    if (usageHistory.isError) return 'Usage could not be loaded. Refresh to try again.';
    if (!usageSession) return 'No matching saved usage is available for this CLI session. Refresh after a turn.';
    return null;
  }, [usageHistory.isPending, usageHistory.isError, usageSession]);
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  return <div className="flex h-full min-h-0 flex-col" data-testid="terminal-pane">
    {!terminal && <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <p className="min-w-0 truncate text-xs text-muted-foreground">Chat in <span className="font-medium text-foreground">{workspace}</span></p>
      <div role="group" aria-label="Choose a CLI chat path" className="inline-flex shrink-0 rounded-md border border-border/70 p-0.5">
        {([[true, 'Continue a conversation', 'Continue', History], [false, 'Start new session', 'New', Plus]] as const).map(([history, name, shown, Icon]) => (
          <button
            key={name} type="button" aria-label={name} aria-pressed={showHistory === history} onClick={() => setShowHistory(history)}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${showHistory === history ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          ><Icon className="size-3" aria-hidden="true" />{shown}</button>
        ))}
      </div>
    </div>}
    {/* One toolbar for the pane. Session history, saved usage and the terminal
        tools used to occupy three further bordered rows; they are now
        popovers, and the transport state is a dot with a tooltip rather than a
        full row carrying a sentence that never changes. */}
    {terminal && <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden border-b border-border px-2.5 py-1.5">
      {harnessSelect}
      {startButton}
      <span className="flex items-center gap-1.5 px-1 text-xs" role="status" data-testid={disconnected ? 'terminal-disconnected' : 'terminal-state'} title={stateHelp}>
        {disconnected ? <WifiOff className="size-3.5 text-warning" aria-hidden="true" /> : <span aria-hidden="true" className={`size-1.5 rounded-full ${stateDotClass}`} />}
        <span className={disconnected ? 'text-warning' : 'text-muted-foreground'}>{stateLabel}</span>
      </span>
      {/* The help sentence is constant while running, so it is a tooltip
          there. Disconnected and exited need the user to react, so their
          explanation stays on screen. */}
      {(disconnected || exited) && <span className="min-w-0 truncate text-[11px] text-muted-foreground" data-testid="terminal-state-help">
        {disconnected && error ? `${stateHelp} ${error}` : stateHelp}
      </span>}
      <span className="flex-1" />
      {inspectorControls}
      {inspectorExpandControl}
      <Menu open={paneMenuOpen} onOpenChange={setPaneMenuOpen}>
        <MenuTrigger aria-label="Pane options" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" title="Open terminals, usage and terminal tools">
          <MoreHorizontal className="size-3" />
        </MenuTrigger>
        <MenuPopup align="end" className="w-64 p-1">
          {!!status?.sessions.length && <>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Open terminals</div>
            {status.sessions.map(s => <MenuItem key={s.id} onClick={() => { setTerminal(s); setTarget(s.target); }}
              className="flex items-center gap-2 text-xs">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${s.state === 'running' ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
              <span className="min-w-0 flex-1 truncate">{s.label}<span className="sr-only">, {s.state === 'running' ? 'running' : 'exited'}</span></span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground" title={s.sessionId ? `Conversation ${s.sessionId}` : `Terminal ${s.id}`}>{(s.sessionId ?? s.id).slice(0, 8)}</span>
            </MenuItem>)}
            <MenuItem onClick={() => setShowHistory(true)} className="flex items-center gap-2 text-xs"><History className="size-3" />Continue a conversation…</MenuItem>
            <div className="my-1 border-t border-border" />
          </>}
          {terminal.target !== 'shell' && <>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Session usage</div>
            <div className="px-2 pb-1">
              {/* Keep the landmark stable: the region exists whether or not a
                  matching conversation has been recorded yet, and only its
                  contents change. */}
              <div role="region" aria-label="CLI session usage">
                {usageSummary
                  ? <p className="text-[11px] text-muted-foreground">{usageSummary}</p>
                  : <SessionUsageDetails session={usageSession!} />}
              </div>
            </div>
            <MenuItem onClick={() => void usageHistory.refetch()} className="flex items-center gap-2 text-xs"><RefreshCw className="size-3" />Refresh usage</MenuItem>
            <div className="my-1 border-t border-border" />
          </>}
          <div className="px-1.5 py-1" onClick={event => event.stopPropagation()}>
            <MenuSearchInput aria-label="Search terminal output" placeholder="Search output" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') search.current?.findNext(query); }} />
          </div>
          <MenuItem onClick={() => search.current?.findNext(query)} className="flex items-center gap-2 text-xs"><Search className="size-3" />Find next match</MenuItem>
          <MenuItem onClick={() => void copySelection()} className="flex items-center gap-2 text-xs"><Copy className="size-3" />Copy selection</MenuItem>
          <MenuItem onClick={() => setScreenReader(value => !value)} className="flex items-center gap-2 text-xs">{screenReader ? '✓ ' : '  '}Screen reader mode</MenuItem>
          <div className="my-1 border-t border-border" />
          <MenuItem onClick={() => void refresh()} className="flex items-center gap-2 text-xs"><RefreshCw className="size-3" />Refresh CLI tools</MenuItem>
          <MenuItem disabled={!target} onClick={() => void external()} className="flex items-center gap-2 text-xs"><ExternalLink className="size-3" />External terminal</MenuItem>
          <div className="my-1 border-t border-border" />
          <p className="truncate px-2 py-1 font-mono text-[10px] text-muted-foreground" title={terminal.cwd}>{terminal.cwd}</p>
        </MenuPopup>
      </Menu>
      {resumeButton}
      {disconnected && <Button size="xs" variant="outline" onClick={() => setRetry(value => value + 1)}><PlugZap className="size-3" />Reconnect</Button>}
      {!exited && terminal.state !== 'exited' && <Button size="xs" variant="ghost" onClick={() => void stop()}><Square className="size-3" />End</Button>}
    </div>}
    {error && (!terminal || !disconnected) && <div role="alert" className="border-b border-border px-3 py-2 text-xs text-warning break-words">{error}{retryLaunch && <Button size="xs" variant="ghost" disabled={busy} onClick={() => void start(retryLaunch)}>Retry launch</Button>}</div>}
    {showHistory && <ResumeSessions workspace={workspace} active={active} busy={busy} status={status} fill={!terminal} onStartNew={() => setShowHistory(false)} onResume={session => void resume({ id: crypto.randomUUID(), target: session.assistant, sessionId: session.id, cwd: session.workspacePath })} />}
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
  </div>;
}
