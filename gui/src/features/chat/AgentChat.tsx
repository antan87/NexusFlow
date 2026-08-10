import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Send, PlaySquare, Square, Cpu, Bot, History, Copy, Check, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../../components/ui/menu.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { Textarea } from '../../components/ui/textarea.js';
import { cn } from '../../lib/utils.js';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { loadChatStore, saveChatStore, clearChatStore, type ChatMessage } from './chatStore.js';
import { providerForAssistant, readChatLaunchIntent } from './chatLaunch.js';
import { SessionPicker, type PickableSession } from './SessionPicker.js';
import AnsiImport from 'ansi-to-react';

const Ansi = (AnsiImport as any).default || AnsiImport;

interface AgentChatProps {
  ws: Feature;
}

interface ProviderCapabilities {
  transport: 'native-api' | 'cli-print' | 'acp';
  sessionIdentity: 'none' | 'client-assigned' | 'provider-assigned';
  workspaceAccess: 'read-only' | 'workspace-write' | 'harness-managed';
  sessionIdFormat?: 'uuid' | 'opaque';
}

interface ChatProvider {
  id: string;
  name: string;
  icon?: string;
  accessLabel?: string;
  isConfigured: boolean;
  message?: string;
  capabilities: ProviderCapabilities;
}

interface StartAgentOptions {
  firstMessage?: string | null;
  provider?: ChatProvider;
  session?: { id: string; started: boolean };
  resetSession?: boolean;
  resetMessagesOnDispatch?: boolean;
  onDispatched?: () => void;
  onFailure?: () => void;
}

interface RetryableKickoff {
  providerId: string;
  kickoff: string;
}

const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

/**
 * One chat message. Memoized so a streaming chunk only re-renders (and
 * re-parses the markdown of) the last bubble, not the whole history.
 */
const MessageBubble = memo(function MessageBubble({
  msg,
  idx,
  copied,
  onCopy,
}: {
  msg: ChatMessage;
  idx: number;
  copied: boolean;
  onCopy: (idx: number, content: string) => void;
}) {
  if (msg.role === 'system') {
    return (
      <div className="flex justify-center">
        <span className={cn(
          'rounded-full border px-3 py-1 text-center text-[11px]',
          msg.kind === 'error'
            ? 'border-destructive/25 bg-destructive/10 text-destructive-foreground'
            : 'border-border bg-muted text-muted-foreground'
        )}>
          {msg.content}
        </span>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const hasAnsi = !isUser && msg.content.includes('\x1b');

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div className={`group relative max-w-[85%] rounded-lg p-3 ${isUser ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-foreground'}`}>
        {isUser ? (
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        ) : (
          <div className="flex flex-col gap-2">
            {hasAnsi ? (
              <div className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs text-foreground">
                <Ansi>{msg.content}</Ansi>
              </div>
            ) : (
              <ChatMarkdown content={msg.content} />
            )}
            <button
              onClick={() => onCopy(idx, msg.content)}
              className="absolute -right-2.5 -top-2.5 hidden h-6 w-6 cursor-pointer place-items-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground group-hover:grid"
              title="Copy message"
            >
              {copied ? <Check size={12} className="text-success-foreground" /> : <Copy size={12} />}
            </button>
          </div>
        )}
      </div>
      {msg.ts && (
        <span className="mt-1 text-[10px] text-muted-foreground">{formatTime(msg.ts)}</span>
      )}
    </div>
  );
});

export function AgentChat({ ws }: AgentChatProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ChatProvider[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);

  // The component is remounted per workspace (keyed by branch), so the
  // one-time initializer always reads the right store.
  const [initialStore] = useState(() => loadChatStore(ws.branchName));
  const [messages, setMessages] = useState<ChatMessage[]>(initialStore.messages);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  // True once the current turn has streamed its first chunk.
  const [turnOpen, setTurnOpen] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [connectionProviderId, setConnectionProviderId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sessionSwitching, setSessionSwitching] = useState(false);
  const [retryableKickoff, setRetryableKickoff] = useState<RetryableKickoff | null>(null);
  const [retryChecking, setRetryChecking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const sessionsRef = useRef(initialStore.sessions);
  // Whether stream chunks may append to the last assistant bubble (the one
  // opened by the current turn) — prevents merging into errors or old turns.
  const turnOpenRef = useRef(false);
  const endedNoteRef = useRef(false);
  // Latest snapshot for the debounced/unmount flush.
  const latestRef = useRef({ messages, agentName });
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedIntentRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const providerRequestRef = useRef(0);
  const connectionProviderRef = useRef<string | null>(null);
  const sessionSwitchingRef = useRef(false);
  const sessionLoadRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const launchIntent = useMemo(() => readChatLaunchIntent(location.state), [location.state]);

  useEffect(() => {
    latestRef.current = { messages, agentName };
  }, [messages, agentName]);

  const flushPersist = useCallback(() => {
    persistTimer.current = null;
    saveChatStore(ws.branchName, {
      v: 3,
      sessions: sessionsRef.current,
      providerId: latestRef.current.agentName || initialStore.providerId,
      messages: latestRef.current.messages,
    });
  }, [ws.branchName, initialStore.providerId]);

  useEffect(() => {
    // Don't yank the view down while the user is reading history; always
    // follow their own just-sent message. Use smooth only for the user's own
    // send — a smooth animation restarted on every stream chunk stutters.
    const last = messages[messages.length - 1];
    if (nearBottomRef.current || last?.role === 'user') {
      messagesEndRef.current?.scrollIntoView({ behavior: last?.role === 'user' ? 'smooth' : 'auto' });
    }
    // Persisting the whole transcript on every stream chunk was O(chunks x
    // history); debounce so a burst of chunks writes at most once.
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(flushPersist, 400);
  }, [messages, agentName, flushPersist]);

  useEffect(() => {
    // pagehide fires on a hard window/tab close where React's unmount cleanup
    // may not run (e.g. the Electron window closing), so the last exchange is
    // still persisted despite the debounce.
    const onHide = () => flushPersist();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      flushPersist();
    };
  }, [flushPersist]);

  useEffect(() => {
    const requestId = ++providerRequestRef.current;
    const controller = new AbortController();
    let active = true;

    fetch(`${API_BASE}/api/adapters/status`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(providerData => {
        if (!active || requestId !== providerRequestRef.current) return;
        const nextProviders = Array.isArray(providerData) ? providerData : [];
        setProviders(nextProviders);

        // Prefer the provider used last time, else the first configured one.
        const persisted = initialStore.providerId
          ? nextProviders.find((p: ChatProvider) => p.id === initialStore.providerId)
          : undefined;
        const firstProvider = persisted || nextProviders.find((p: ChatProvider) => p.isConfigured) || nextProviders[0];
        // A StrictMode replay or delayed response must not overwrite a user
        // selection or the provider already bound to a connection.
        if (firstProvider) setAgentName(current => current || firstProvider.id);
      })
      .catch(err => {
        if (active && err?.name !== 'AbortError') console.error('Failed to fetch agent data', err);
      })
      .finally(() => {
        if (active && requestId === providerRequestRef.current) setProvidersLoaded(true);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialStore.providerId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionLoadRef.current.id += 1;
      sessionLoadRef.current.controller?.abort();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [ws.branchName, ws.workspacePath]);

  const displayedProviderId = connectionProviderId ?? agentName;
  const currentProvider = providers.find(p => p.id === displayedProviderId);
  const canStart = Boolean(agentName) && Boolean(currentProvider?.isConfigured) && !connecting && !sessionSwitching;

  const closeTurn = useCallback(() => {
    turnOpenRef.current = false;
    setTurnOpen(false);
  }, []);

  const appendSystemNote = useCallback((content: string, kind: 'error' | 'note') => {
    setMessages(prev => [...prev, { role: 'system', content, kind, ts: Date.now() }]);
  }, []);

  // Dispatch a user turn on a given socket: send it, echo the bubble, mark busy.
  const sendTurn = useCallback((socket: WebSocket, text: string, providerId: string) => {
    socket.send(JSON.stringify({ type: 'input', input: text }));
    // A turn has been dispatched, so an already-known CLI session is now
    // persisted. Codex supplies its id asynchronously via `thread.started`.
    const knownSession = sessionsRef.current[providerId];
    if (knownSession) {
      sessionsRef.current = {
        ...sessionsRef.current,
        [providerId]: { ...knownSession, started: true },
      };
    }
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }]);
    setInput('');
    setBusy(true);
    closeTurn();
  }, [closeTurn]);

  const noteSessionEnded = useCallback(() => {
    if (endedNoteRef.current) return;
    endedNoteRef.current = true;
    appendSystemNote('Session ended', 'note');
  }, [appendSystemNote]);

  const stopAgent = useCallback(() => {
    const socket = wsRef.current;
    if (!socket) return;

    // Closing a CONNECTING socket is valid, but sending on it throws. A stop
    // frame is only meaningful once the transport is open.
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'stop' }));
      } catch {
        // The close below is the authoritative local stop even if the socket
        // changed state between the readyState check and send.
      }
    }
    wsRef.current = null;
    connectionProviderRef.current = null;
    setConnectionProviderId(null);
    setConnecting(false);
    socket.close();
    setConnected(false);
    setBusy(false);
    closeTurn();
    noteSessionEnded();
  }, [closeTurn, noteSessionEnded]);

  const startAgent = useCallback((providerId = agentName, options: StartAgentOptions = {}): boolean => {
    if (wsRef.current) {
      options.onFailure?.();
      return false;
    }

    const selectedProvider = options.provider ?? providers.find((provider) => provider.id === providerId);
    setAgentName(providerId);
    if (!selectedProvider?.isConfigured) {
      appendSystemNote(
        selectedProvider?.message ?? `The ${providerId} provider is unavailable. Check its local CLI installation and login.`,
        'error',
      );
      options.onFailure?.();
      return false;
    }

    // Convert API_BASE to ws:// or wss://
    let wsUrl = API_BASE;
    if (wsUrl.startsWith('http')) {
      wsUrl = wsUrl.replace('http', 'ws');
    } else {
      wsUrl = window.location.origin.replace('http', 'ws');
    }
    wsUrl += '/ws';

    endedNoteRef.current = false;
    let dispatched = false;
    let failureReported = false;
    let socket: WebSocket;

    const failBeforeDispatch = () => {
      if (failureReported || dispatched || !mountedRef.current) return;
      failureReported = true;
      appendSystemNote('Could not open the local agent connection. Your current chat was preserved; retry explicitly when ready.', 'error');
      options.onFailure?.();
    };

    try {
      socket = new WebSocket(wsUrl);
    } catch {
      failBeforeDispatch();
      return false;
    }
    socket.onopen = () => {
      if (!mountedRef.current || wsRef.current !== socket) {
        socket.close();
        return;
      }
      const startPayload: Record<string, unknown> = {
        type: 'start',
        command: providerId,
        // Sessions always run in the workspace dir — that's where the
        // generated context files live (see src/utils/feature.ts).
        cwd: ws.workspacePath,
      };
      const nextSessions = { ...sessionsRef.current };
      if (options.resetSession) delete nextSessions[providerId];
      if (options.session) nextSessions[providerId] = options.session;

      if (selectedProvider.capabilities.sessionIdentity === 'client-assigned') {
        // Claude accepts a caller-assigned UUID for a new session.
        const existing = nextSessions[providerId];
        const session = existing ?? { id: crypto.randomUUID(), started: false };
        nextSessions[providerId] = session;
        startPayload.sessionId = session.id;
        startPayload.resume = session.started;
      } else if (selectedProvider.capabilities.sessionIdentity === 'provider-assigned') {
        // ACP providers and Codex create their own session ids. Only pass one
        // when resuming an id captured from the provider's session event.
        const session = nextSessions[providerId];
        if (session?.started) {
          startPayload.sessionId = session.id;
          startPayload.resume = true;
        }
      }

      // If the user already typed a message, send it as the first turn so
      // Enter connects and sends in one step instead of requiring a second Enter.
      // `null` is an explicit programmatic connect-without-send. This matters
      // for session resume: an unrelated draft in the composer must not become
      // a surprise write-capable first turn. `undefined` retains the manual
      // Start/Enter behavior of sending the visible draft.
      const firstMessage = options.firstMessage === null ? '' : (options.firstMessage ?? input).trim();

      try {
        socket.send(JSON.stringify(startPayload));
        if (firstMessage) socket.send(JSON.stringify({ type: 'input', input: firstMessage }));
      } catch {
        failBeforeDispatch();
        wsRef.current = null;
        connectionProviderRef.current = null;
        setConnectionProviderId(null);
        setConnecting(false);
        socket.close();
        return;
      }

      // Only commit session/chat replacement after both frames have been
      // accepted by an open transport. A failed kickoff therefore cannot
      // erase the user's prior local conversation.
      if (firstMessage && nextSessions[providerId]) {
        nextSessions[providerId] = { ...nextSessions[providerId], started: true };
      }
      sessionsRef.current = nextSessions;
      dispatched = true;
      setConnecting(false);
      setConnected(true);
      if (options.resetMessagesOnDispatch) setMessages([]);
      if (firstMessage) {
        setMessages(prev => [
          ...(options.resetMessagesOnDispatch ? [] : prev),
          { role: 'user', content: firstMessage, ts: Date.now() },
        ]);
        setInput('');
        setBusy(true);
        closeTurn();
      }
      options.onDispatched?.();
    };

    socket.onmessage = (event) => {
      if (wsRef.current !== socket) return;
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'stream') {
          const append = turnOpenRef.current;
          turnOpenRef.current = true;
          setTurnOpen(true);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (append && last?.role === 'assistant') {
              const newArr = [...prev];
              newArr[newArr.length - 1] = { ...last, content: last.content + payload.text };
              return newArr;
            }
            return [...prev, { role: 'assistant', content: payload.text, ts: Date.now() }];
          });
        } else if (payload.type === 'session' && typeof payload.id === 'string') {
          sessionsRef.current = {
            ...sessionsRef.current,
            [providerId]: { id: payload.id, started: true },
          };
        } else if (payload.type === 'status') {
          setBusy(payload.state === 'busy');
          if (payload.state !== 'busy') closeTurn();
        } else if (payload.type === 'system') {
          appendSystemNote(payload.message, 'note');
          closeTurn();
        } else if (payload.type === 'error') {
          appendSystemNote(payload.message, 'error');
          setBusy(false);
          closeTurn();
        } else if (payload.type === 'close') {
          setConnected(false);
          setBusy(false);
          closeTurn();
          noteSessionEnded();
          socket.close();
          wsRef.current = null;
        }
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    socket.onclose = () => {
      // Only the active socket's close affects UI state; a socket that was
      // already superseded (Stop then immediate Start) must not clobber the
      // new connection or emit a spurious "Session ended".
      if (wsRef.current !== socket) return;
      if (!dispatched) failBeforeDispatch();
      setConnected(false);
      setConnecting(false);
      setBusy(false);
      closeTurn();
      if (dispatched) noteSessionEnded();
      wsRef.current = null;
      connectionProviderRef.current = null;
      setConnectionProviderId(null);
    };

    socket.onerror = () => {
      if (wsRef.current !== socket) return;
      failBeforeDispatch();
      if (!dispatched) {
        wsRef.current = null;
        connectionProviderRef.current = null;
        setConnectionProviderId(null);
        setConnecting(false);
        setConnected(false);
        socket.close();
      }
    };

    wsRef.current = socket;
    connectionProviderRef.current = providerId;
    setConnectionProviderId(providerId);
    setConnecting(true);
    return true;
  }, [agentName, appendSystemNote, closeTurn, input, noteSessionEnded, providers, ws.workspacePath]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    const providerId = connectionProviderRef.current;
    if (!text || !wsRef.current || !providerId || busy || sessionSwitchingRef.current) return;
    sendTurn(wsRef.current, text, providerId);
  }, [busy, input, sendTurn]);

  const copyMessage = useCallback((idx: number, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(prev => (prev === idx ? null : prev)), 1500);
    }).catch(() => {});
  }, []);

  const finishSessionSwitch = useCallback((requestId: number) => {
    if (sessionLoadRef.current.id !== requestId) return;
    sessionLoadRef.current.controller = null;
    sessionSwitchingRef.current = false;
    if (mountedRef.current) setSessionSwitching(false);
  }, []);

  const loadSession = useCallback(async (session: PickableSession, connectAfterLoad = false): Promise<boolean> => {
    const requestId = sessionLoadRef.current.id + 1;
    sessionLoadRef.current.controller?.abort();
    const controller = new AbortController();
    sessionLoadRef.current = { id: requestId, controller };
    sessionSwitchingRef.current = true;
    setSessionSwitching(true);
    setPickerError(null);
    const providerId = providerForAssistant(session.assistant);
    if (!providerId) {
      appendSystemNote('Only Claude Code and Codex sessions can resume in embedded chat.', 'error');
      finishSessionSwitch(requestId);
      return false;
    }

    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider?.isConfigured) {
      appendSystemNote(
        provider?.message ?? `The ${providerId} provider is unavailable. Check its local CLI installation and login.`,
        'error',
      );
      finishSessionSwitch(requestId);
      return false;
    }

    const isCurrentRequest = () => (
      mountedRef.current
      && sessionLoadRef.current.id === requestId
      && !controller.signal.aborted
    );

    try {
      const res = await fetch(
        `${API_BASE}/api/session/${encodeURIComponent(session.assistant)}/${encodeURIComponent(session.id)}/transcript`,
        { signal: controller.signal },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!isCurrentRequest()) return false;
      const transcript: ChatMessage[] = (Array.isArray(data.messages) ? data.messages : [])
        // The transcript parser yields empty strings for tool_use/tool_result
        // records; drop them instead of rendering empty bubbles.
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m: any) => ({
          role: m.role,
          content: m.content,
          ts: m.timestamp ? Date.parse(m.timestamp) || undefined : undefined,
        }));

      if (wsRef.current && !window.confirm('Stop the current chat and resume this session?')) {
        finishSessionSwitch(requestId);
        return false;
      }
      if (wsRef.current) stopAgent();

      setAgentName(providerId);
      const commitTranscript = () => {
        if (!isCurrentRequest()) return;
        setMessages([
          ...transcript,
          { role: 'system', kind: 'note', content: 'Loaded session — your next message resumes it.', ts: Date.now() },
        ]);
        // A draft belongs to the previous context. Clear it only after the
        // requested session switch has actually succeeded.
        setInput('');
        setPickerOpen(false);
        finishSessionSwitch(requestId);
      };

      if (connectAfterLoad) {
        const started = startAgent(providerId, {
          firstMessage: null,
          session: { id: session.id, started: true },
          onDispatched: commitTranscript,
          onFailure: () => {
            if (!isCurrentRequest()) return;
            setPickerError('Failed to connect to the selected session.');
            finishSessionSwitch(requestId);
          },
        });
        return started;
      }

      sessionsRef.current = {
        ...sessionsRef.current,
        [providerId]: { id: session.id, started: true },
      };
      commitTranscript();
      return true;
    } catch (error) {
      if (!isCurrentRequest() || (error instanceof DOMException && error.name === 'AbortError')) return false;
      setPickerError('Failed to load the session transcript.');
      appendSystemNote('Failed to load the session transcript. Your current chat was preserved.', 'error');
      finishSessionSwitch(requestId);
      return false;
    }
  }, [appendSystemNote, finishSessionSwitch, providers, startAgent, stopAgent]);

  const pickSession = useCallback((session: PickableSession) => {
    void loadSession(session);
  }, [loadSession]);

  const dispatchKickoff = useCallback(async (claim: RetryableKickoff, refreshStatus = false): Promise<boolean> => {
    setRetryableKickoff(claim);
    let freshProvider: ChatProvider | undefined;

    if (refreshStatus) {
      setRetryChecking(true);
      try {
        const response = await fetch(`${API_BASE}/api/adapters/status`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const nextProviders: ChatProvider[] = Array.isArray(data) ? data : [];
        if (!mountedRef.current) return false;
        setProviders(nextProviders);
        freshProvider = nextProviders.find((provider) => provider.id === claim.providerId);
        if (!freshProvider?.isConfigured) {
          appendSystemNote(
            freshProvider?.message ?? 'The selected local CLI is still unavailable. Install it and sign in, then retry.',
            'error',
          );
          return false;
        }
      } catch {
        if (mountedRef.current) {
          appendSystemNote('Could not refresh the local CLI status. The task handoff was not dispatched.', 'error');
        }
        return false;
      } finally {
        if (mountedRef.current) setRetryChecking(false);
      }
    }

    return startAgent(claim.providerId, {
      firstMessage: claim.kickoff,
      provider: freshProvider,
      resetSession: true,
      resetMessagesOnDispatch: true,
      onDispatched: () => {
        if (mountedRef.current) setRetryableKickoff(null);
      },
      onFailure: () => {
        if (mountedRef.current) setRetryableKickoff(claim);
      },
    });
  }, [appendSystemNote, startAgent]);

  useEffect(() => {
    if (!providersLoaded || !launchIntent) return;

    let previouslyConsumed = consumedIntentRef.current === launchIntent.nonce;
    try {
      previouslyConsumed = previouslyConsumed
        || sessionStorage.getItem('nexusflow.chatLaunch.consumed') === launchIntent.nonce;
      sessionStorage.setItem('nexusflow.chatLaunch.consumed', launchIntent.nonce);
    } catch {
      // sessionStorage can be disabled; the component-local guard still
      // prevents repeats during this mount.
    }
    consumedIntentRef.current = launchIntent.nonce;

    // Remove the write-capable intent before opening a socket. Browser back,
    // reload, and React re-renders must never replay a kickoff.
    const nextState = location.state && typeof location.state === 'object'
      ? { ...(location.state as Record<string, unknown>) }
      : {};
    delete nextState.chatLaunch;
    navigate(`${location.pathname}${location.search}`, {
      replace: true,
      state: Object.keys(nextState).length > 0 ? nextState : null,
    });

    if (previouslyConsumed) return;

    const provider = providers.find((candidate) => candidate.id === launchIntent.providerId);
    setAgentName(launchIntent.providerId);
    if (!provider?.isConfigured) {
      appendSystemNote(
        provider?.message ?? 'The selected local CLI is unavailable. Install it and sign in, then try again.',
        'error',
      );
      if (launchIntent.kickoff) {
        setRetryableKickoff({ providerId: launchIntent.providerId, kickoff: launchIntent.kickoff });
      }
      return;
    }

    if (launchIntent.sessionId && launchIntent.assistant) {
      void loadSession({
        id: launchIntent.sessionId,
        assistant: launchIntent.assistant,
        title: '',
        createdAt: '',
        updatedAt: '',
        messageCount: 0,
      }, true);
      return;
    }

    if (wsRef.current && !window.confirm('Stop the current chat and continue with the selected local CLI?')) {
      return;
    }
    if (wsRef.current) stopAgent();

    if (launchIntent.kickoff) {
      void dispatchKickoff({ providerId: launchIntent.providerId, kickoff: launchIntent.kickoff });
    } else {
      startAgent(launchIntent.providerId, { firstMessage: null });
    }
  }, [
    appendSystemNote,
    dispatchKickoff,
    launchIntent,
    loadSession,
    location.pathname,
    location.search,
    location.state,
    navigate,
    providers,
    providersLoaded,
    startAgent,
    stopAgent,
  ]);

  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear this chat history? This also starts a new agent session.')) {
      // Tear down the live agent first so the next message can't resume the
      // conversation we're clearing.
      if (wsRef.current) stopAgent();
      // Forget only the selected provider's session; switching providers later
      // can still resume its own independently-scoped conversation.
      const remainingSessions = { ...sessionsRef.current };
      delete remainingSessions[agentName];
      sessionsRef.current = remainingSessions;
      endedNoteRef.current = false;
      setMessages([]);
      clearChatStore(ws.branchName);
    }
  };

  const showThinking = busy && !turnOpen;

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-semibold text-foreground">Chat</h3>
          <StatusBadge tone={connected ? 'running' : 'idle'} dot>
            {connected ? currentProvider?.name || 'Connected' : 'Disconnected'}
          </StatusBadge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <button onClick={clearChat} className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-destructive-foreground">
              Clear
            </button>
          )}
          <button
            onClick={() => { setPickerError(null); setPickerOpen(true); }}
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title="Resume a past session"
          >
            <History size={14} />
          </button>
          {connected && (
            <Button size="sm" variant="outline" onClick={stopAgent}>
              <Square size={14} className="text-destructive-foreground" />
              Stop
            </Button>
          )}
        </div>
      </div>

      <SessionPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        ws={ws}
        onPick={pickSession}
        error={pickerError}
        pending={sessionSwitching}
      />

      <div
        ref={listRef}
        onScroll={() => {
          const el = listRef.current;
          if (el) {
            nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }
        }}
        className="flex-1 space-y-4 overflow-y-auto p-4"
      >
        {messages.length === 0 && !showThinking && (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No messages yet. Start the agent and say hello.
          </div>
        )}
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} msg={msg} idx={idx} copied={copiedIdx === idx} onCopy={copyMessage} />
        ))}
        {showThinking && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
              <RefreshCw size={14} className="animate-spin" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-card p-3">
        {currentProvider && !currentProvider.isConfigured && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            <span className="font-semibold">{currentProvider.name} provider status:</span>
            <span>{currentProvider.message}</span>
          </div>
        )}
        {retryableKickoff && !connecting && !connected && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <span>The workspace kickoff was not dispatched.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void dispatchKickoff(retryableKickoff, true)}
              disabled={sessionSwitching || retryChecking}
            >
              {retryChecking ? 'Checking CLI…' : 'Retry task handoff'}
            </Button>
          </div>
        )}
        <div className="flex w-full flex-col rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-center gap-2 border-b border-border/50 p-2">
            <Menu>
              <MenuTrigger
                aria-label="Select Provider"
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent',
                  connected ? 'pointer-events-none opacity-50' : 'text-foreground',
                )}
              >
                {currentProvider?.icon === 'Bot' ? <Bot size={14} className="text-primary" /> : <Cpu size={14} className="text-primary" />}
                {currentProvider?.name || 'Select Agent'}
              </MenuTrigger>
              <MenuPopup align="start" side="top">
                {providers.map((p) => (
                  <MenuItem key={p.id} onClick={() => { if (!connected) setAgentName(p.id); }}>
                    {p.icon === 'Bot' ? <Bot size={14} /> : <Cpu size={14} />}
                    {p.name}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
            <div className="h-4 w-px bg-border"></div>
            <span className="text-xs text-muted-foreground">{currentProvider?.accessLabel ?? 'Harness-managed access'}</span>
          </div>
          <div className="flex items-end gap-2 p-2">
            <Textarea
              value={input}
              disabled={sessionSwitching}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy || connecting || sessionSwitchingRef.current) return;
                  if (!connected) {
                    startAgent();
                  } else {
                    sendMessage();
                  }
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                }
              }}
              placeholder={connected ? 'Message the agent... (Shift+Enter for new line)' : 'Start the agent or press Enter...'}
              unstyled
              className="flex-1 [&_[data-slot=textarea]]:max-h-[200px] [&_[data-slot=textarea]]:min-h-11 [&_[data-slot=textarea]]:resize-none [&_[data-slot=textarea]]:text-sm"
              rows={1}
            />
            {!connected ? (
              <Button className="h-11 shrink-0 rounded-lg" onClick={() => startAgent()} disabled={!canStart}>
                <PlaySquare size={14} />
                Start
              </Button>
            ) : (
              <Button
                className="h-11 shrink-0 rounded-lg"
                onClick={sendMessage}
                disabled={!input.trim() || busy || sessionSwitching}
              >
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
