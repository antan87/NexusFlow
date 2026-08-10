import { useState, useRef, useEffect, useCallback, memo } from 'react';
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

/** Session-history assistant ids mapped to their embedded CLI providers. */
const SESSION_PROVIDERS: Record<string, string> = {
  claude: 'claude-cli',
  codex: 'codex-cli',
};

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
  const [providers, setProviders] = useState<ChatProvider[]>([]);

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
    fetch(`${API_BASE}/api/adapters/status`)
      .then(res => res.json())
      .then(providerData => {
        setProviders(providerData);

        // Prefer the provider used last time, else the first configured one.
        const persisted = initialStore.providerId
          ? providerData.find((p: any) => p.id === initialStore.providerId)
          : undefined;
        const firstProvider = persisted || providerData.find((p: any) => p.isConfigured) || providerData[0];
        if (firstProvider) {
          setAgentName(firstProvider.id);
        }
      })
      .catch(err => console.error('Failed to fetch agent data', err));
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const currentProvider = providers.find(p => p.id === agentName);
  const canStart = Boolean(agentName) && (!currentProvider || currentProvider.isConfigured);

  const closeTurn = () => {
    turnOpenRef.current = false;
    setTurnOpen(false);
  };

  const appendSystemNote = (content: string, kind: 'error' | 'note') => {
    setMessages(prev => [...prev, { role: 'system', content, kind, ts: Date.now() }]);
  };

  // Dispatch a user turn on a given socket: send it, echo the bubble, mark busy.
  const sendTurn = (socket: WebSocket, text: string) => {
    socket.send(JSON.stringify({ type: 'input', input: text }));
    // A turn has been dispatched, so an already-known CLI session is now
    // persisted. Codex supplies its id asynchronously via `thread.started`.
    const knownSession = sessionsRef.current[agentName];
    if (knownSession) {
      sessionsRef.current = {
        ...sessionsRef.current,
        [agentName]: { ...knownSession, started: true },
      };
    }
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }]);
    setInput('');
    setBusy(true);
    closeTurn();
  };

  const noteSessionEnded = () => {
    if (endedNoteRef.current) return;
    endedNoteRef.current = true;
    appendSystemNote('Session ended', 'note');
  };

  const startAgent = () => {
    if (wsRef.current || !canStart) return;

    // Convert API_BASE to ws:// or wss://
    let wsUrl = API_BASE;
    if (wsUrl.startsWith('http')) {
      wsUrl = wsUrl.replace('http', 'ws');
    } else {
      wsUrl = window.location.origin.replace('http', 'ws');
    }
    wsUrl += '/ws';

    endedNoteRef.current = false;
    const socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      if (wsRef.current !== socket) return;
      setConnected(true);

      const startPayload: Record<string, unknown> = {
        type: 'start',
        command: agentName,
        // Sessions always run in the workspace dir — that's where the
        // generated context files live (see src/utils/feature.ts).
        cwd: ws.workspacePath,
      };
      if (currentProvider?.capabilities.sessionIdentity === 'client-assigned') {
        // Claude accepts a caller-assigned UUID for a new session.
        const existing = sessionsRef.current[agentName];
        const session = existing ?? { id: crypto.randomUUID(), started: false };
        sessionsRef.current = { ...sessionsRef.current, [agentName]: session };
        startPayload.sessionId = session.id;
        startPayload.resume = session.started;
      } else if (currentProvider?.capabilities.sessionIdentity === 'provider-assigned') {
        // ACP providers and Codex create their own session ids. Only pass one
        // when resuming an id captured from the provider's session event.
        const session = sessionsRef.current[agentName];
        if (session?.started) {
          startPayload.sessionId = session.id;
          startPayload.resume = true;
        }
      }
      socket.send(JSON.stringify(startPayload));

      // If the user already typed a message, send it as the first turn so
      // Enter connects and sends in one step instead of requiring a second Enter.
      const firstMessage = input.trim();
      if (firstMessage) {
        sendTurn(socket, firstMessage);
      }
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
            [agentName]: { id: payload.id, started: true },
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
      setConnected(false);
      setBusy(false);
      closeTurn();
      noteSessionEnded();
      wsRef.current = null;
    };

    wsRef.current = socket;
  };

  const stopAgent = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      const socket = wsRef.current;
      wsRef.current = null;
      socket.close();
      setConnected(false);
      setBusy(false);
      closeTurn();
      noteSessionEnded();
    }
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text || !wsRef.current || busy) return;
    sendTurn(wsRef.current, text);
  };

  const copyMessage = useCallback((idx: number, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(prev => (prev === idx ? null : prev)), 1500);
    }).catch(() => {});
  }, []);

  const pickSession = async (session: PickableSession) => {
    setPickerError(null);
    if (wsRef.current) {
      stopAgent();
    }
    try {
      const providerId = SESSION_PROVIDERS[session.assistant];
      if (!providerId) throw new Error('Unsupported session provider');
      const res = await fetch(`${API_BASE}/api/session/${encodeURIComponent(session.assistant)}/${encodeURIComponent(session.id)}/transcript`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const transcript: ChatMessage[] = (data.messages || [])
        // The transcript parser yields empty strings for tool_use/tool_result
        // records; drop them instead of rendering empty bubbles.
        .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m: any) => ({
          role: m.role,
          content: m.content,
          ts: m.timestamp ? Date.parse(m.timestamp) || undefined : undefined,
        }));

      sessionsRef.current = {
        ...sessionsRef.current,
        [providerId]: { id: session.id, started: true },
      };
      setAgentName(providerId);
      setMessages([
        ...transcript,
        { role: 'system', kind: 'note', content: 'Loaded session — your next message resumes it.', ts: Date.now() },
      ]);
      setPickerOpen(false);
    } catch {
      setPickerError('Failed to load the session transcript.');
    }
  };

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

      <SessionPicker open={pickerOpen} onClose={() => setPickerOpen(false)} ws={ws} onPick={pickSession} error={pickerError} />

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
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = 'auto';
                el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (busy) return;
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
              <Button className="h-11 shrink-0 rounded-lg" onClick={startAgent} disabled={!canStart}>
                <PlaySquare size={14} />
                Start
              </Button>
            ) : (
              <Button
                className="h-11 shrink-0 rounded-lg"
                onClick={sendMessage}
                disabled={!input.trim() || busy}
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
