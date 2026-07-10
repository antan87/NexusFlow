import { useState, useRef, useEffect } from 'react';
import { Send, PlaySquare, Square, Sparkles, Cpu, Bot, History, Copy, Check, RefreshCw } from 'lucide-react';
import { Button, Textarea, Menu, StatusPill } from '../../components/ui/index.js';
import { cn } from '../../components/ui/cn.js';
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

/** Providers whose conversations can be resumed by session id. */
const SESSION_PROVIDER = 'claude-cli';

const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

export function AgentChat({ ws }: AgentChatProps) {
  const [providers, setProviders] = useState<{ id: string; name: string; icon?: string; isConfigured: boolean; message?: string }[]>([]);

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
  const sessionIdRef = useRef<string | null>(initialStore.sessionId);
  const sessionStartedRef = useRef<boolean>(initialStore.sessionStarted);
  // Whether stream chunks may append to the last assistant bubble (the one
  // opened by the current turn) — prevents merging into errors or old turns.
  const turnOpenRef = useRef(false);
  const endedNoteRef = useRef(false);

  useEffect(() => {
    // Don't yank the view down while the user is reading history; always
    // follow their own just-sent message.
    const last = messages[messages.length - 1];
    if (nearBottomRef.current || last?.role === 'user') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    saveChatStore(ws.branchName, {
      v: 2,
      sessionId: sessionIdRef.current,
      providerId: agentName || initialStore.providerId,
      sessionStarted: sessionStartedRef.current,
      messages,
    });
  }, [messages, agentName, ws.branchName]);

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
      setConnected(true);

      const startPayload: Record<string, unknown> = {
        type: 'start',
        command: agentName,
        cwd: ws.workspacePath,
      };
      // Only claude-cli supports resume-by-id; give it a stable session UUID
      // so the conversation survives reconnects and app restarts.
      if (agentName === SESSION_PROVIDER) {
        if (!sessionIdRef.current) {
          sessionIdRef.current = crypto.randomUUID();
          sessionStartedRef.current = false;
        }
        startPayload.sessionId = sessionIdRef.current;
        startPayload.resume = sessionStartedRef.current;
      }
      socket.send(JSON.stringify(startPayload));

      // If the user already typed a message, send it as the first turn so
      // Enter connects and sends in one step instead of requiring a second Enter.
      const firstMessage = input.trim();
      if (firstMessage) {
        socket.send(JSON.stringify({ type: 'input', input: firstMessage }));
        setMessages(prev => [...prev, { role: 'user', content: firstMessage, ts: Date.now() }]);
        setInput('');
        setBusy(true);
        closeTurn();
      }
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'stream') {
          sessionStartedRef.current = true;
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
      setConnected(false);
      setBusy(false);
      closeTurn();
      if (wsRef.current) {
        // Unexpected drop (server restart, network) — the intentional paths
        // clear wsRef before closing.
        noteSessionEnded();
      }
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

    wsRef.current.send(JSON.stringify({ type: 'input', input: text }));
    setMessages(prev => [...prev, { role: 'user', content: text, ts: Date.now() }]);
    setInput('');
    setBusy(true);
    closeTurn();
  };

  const copyMessage = (idx: number, content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(prev => (prev === idx ? null : prev)), 1500);
    }).catch(() => {});
  };

  const pickSession = async (session: PickableSession) => {
    setPickerError(null);
    if (wsRef.current) {
      stopAgent();
    }
    try {
      const res = await fetch(`${API_BASE}/api/session/claude/${encodeURIComponent(session.id)}/transcript`);
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

      sessionIdRef.current = session.id;
      sessionStartedRef.current = true;
      setAgentName(SESSION_PROVIDER);
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
      // A fresh UUID is required: the old session file still exists, so
      // reusing the id with --session-id would collide.
      sessionIdRef.current = null;
      sessionStartedRef.current = false;
      setMessages([]);
      clearChatStore(ws.branchName);
    }
  };

  const showThinking = busy && !turnOpen;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 shrink-0 bg-surface">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-display font-semibold text-content">Chat</h3>
          <StatusPill tone={connected ? 'running' : 'idle'} dot>
            {connected ? currentProvider?.name || 'Connected' : 'Disconnected'}
          </StatusPill>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-content-faint hover:text-rose-400 transition-colors cursor-pointer">
              Clear
            </button>
          )}
          <button
            onClick={() => { setPickerError(null); setPickerOpen(true); }}
            className="grid h-7 w-7 place-items-center rounded-md text-content-faint hover:text-content hover:bg-raised transition-colors cursor-pointer"
            title="Resume a past session"
          >
            <History size={14} />
          </button>
          {connected && (
            <Button size="sm" variant="secondary" icon={<Square size={14} className="text-rose-400" />} onClick={stopAgent}>
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
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.length === 0 && !showThinking && (
          <div className="flex h-full items-center justify-center text-content-faint">
            No messages yet. Start the agent and say hello.
          </div>
        )}
        {messages.map((msg, idx) => (
          msg.role === 'system' ? (
            <div key={idx} className="flex justify-center">
              <span className={cn(
                'text-[11px] px-3 py-1 rounded-full border text-center',
                msg.kind === 'error'
                  ? 'text-rose-400 border-rose-500/20 bg-rose-500/10'
                  : 'text-content-faint border-hairline bg-raised'
              )}>
                {msg.content}
              </span>
            </div>
          ) : (
          <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className={`group relative max-w-[85%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-surface border border-hairline'}`}>
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {msg.content.includes('\x1b') ? (
                    <div className="font-mono text-xs overflow-x-auto whitespace-pre-wrap bg-[#1e1e1e] text-gray-300 p-2 rounded-md">
                      <Ansi>{msg.content}</Ansi>
                    </div>
                  ) : (
                    <ChatMarkdown content={msg.content} />
                  )}
                  <button
                    onClick={() => copyMessage(idx, msg.content)}
                    className="absolute -top-2.5 -right-2.5 hidden group-hover:grid h-6 w-6 place-items-center rounded-md border border-hairline bg-surface text-content-faint hover:text-content shadow-sm cursor-pointer"
                    title="Copy message"
                  >
                    {copiedIdx === idx ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                  </button>
                </div>
              )}
            </div>
            {msg.ts && (
              <span className="mt-1 text-[10px] text-content-faint">{formatTime(msg.ts)}</span>
            )}
          </div>
          )
        ))}
        {showThinking && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-hairline bg-surface px-4 py-3">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-content-faint animate-pulse" />
                <span className="h-1.5 w-1.5 rounded-full bg-content-faint animate-pulse [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-content-faint animate-pulse [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="shrink-0 border-t border-hairline p-3 flex flex-col gap-2 bg-surface">
        {currentProvider && !currentProvider.isConfigured && (
          <div className="flex items-center gap-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs px-3 py-2 rounded-lg">
            <span className="font-semibold">{currentProvider.name} provider status:</span>
            <span>{currentProvider.message}</span>
          </div>
        )}
        <div className="flex flex-col bg-surface border border-hairline rounded-xl shadow-sm w-full">
          <div className="flex items-center border-b border-hairline/50 p-2 gap-2">
            <Menu
              label="Select Provider"
              trigger={
                <span className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md hover:bg-raised transition-colors cursor-pointer",
                  connected ? "opacity-50 pointer-events-none" : "text-content"
                )}>
                  {currentProvider?.icon === 'Sparkles' ? <Sparkles size={14} className="text-accent" /> : currentProvider?.icon === 'Bot' ? <Bot size={14} className="text-accent" /> : <Cpu size={14} className="text-accent" />}
                  {currentProvider?.name || 'Select Agent'}
                </span>
              }
              items={[
                ...providers.map(p => ({
                  label: p.name,
                  icon: p.icon === 'Sparkles' ? <Sparkles size={14} /> : p.icon === 'Bot' ? <Bot size={14} /> : <Cpu size={14} />,
                  onClick: () => { if (!connected) setAgentName(p.id) }
                }))
              ]}
            />
            <div className="h-4 w-px bg-hairline"></div>
            <span className="text-xs text-content-faint">Full access</span>
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
              className="flex-1 min-h-[44px] max-h-[200px] resize-none bg-transparent border-none focus:ring-0 px-3 py-2 text-sm text-content"
              rows={1}
            />
            {!connected ? (
              <Button variant="primary" className="h-[44px] rounded-lg shrink-0" icon={<PlaySquare size={14} />} onClick={startAgent} disabled={!canStart}>
                Start
              </Button>
            ) : (
              <Button
                variant="primary"
                className="h-[44px] rounded-lg shrink-0"
                icon={busy ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                onClick={sendMessage}
                disabled={!input.trim() || busy}
              >
                Send
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
