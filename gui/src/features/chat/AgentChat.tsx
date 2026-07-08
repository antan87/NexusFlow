import { useState, useRef, useEffect } from 'react';
import { Send, PlaySquare, Square, Sparkles, Cpu, Bot } from 'lucide-react';
import { Button, Textarea } from '../../components/ui/index.js';
import { cn } from '../../components/ui/cn.js';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { DiffPanel } from './DiffPanel.js';

interface AgentChatProps {
  ws: Feature;
}

export function AgentChat({ ws }: AgentChatProps) {
  const [aiAssistants, setAiAssistants] = useState<{ name: string; displayName: string; detected: boolean; command?: string }[]>([]);
  const storageKey = `nexusflow_chat_${ws.branchName}`;

  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string; diff?: string; diffStatus?: 'pending' | 'approved' | 'rejected' }[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [agentName, setAgentName] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    try {
      localStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (e) {
      console.error('Failed to save chat to localStorage', e);
    }
  }, [messages, storageKey]);

  useEffect(() => {
    fetch(`${API_BASE}/api/ai-detect`)
      .then(res => res.json())
      .then(data => {
        setAiAssistants(data);
        const first = data.find((ai: any) => ai.detected && ai.command);
        if (first) setAgentName(first.command);
      })
      .catch(err => console.error('Failed to fetch aiAssistants', err));
  }, []);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const startAgent = () => {
    if (wsRef.current) return;
    
    // Convert API_BASE to ws:// or wss://
    let wsUrl = API_BASE;
    if (wsUrl.startsWith('http')) {
      wsUrl = wsUrl.replace('http', 'ws');
    } else {
      wsUrl = window.location.origin.replace('http', 'ws');
    }
    wsUrl += '/ws';

    const socket = new WebSocket(wsUrl);
    socket.onopen = () => {
      setConnected(true);
      socket.send(JSON.stringify({
        type: 'start',
        command: agentName,
        args: [], // maybe need to pass specific args later
        cwd: ws.workspacePath
      }));
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'stream') {
          setMessages(prev => {
            if (prev.length > 0) {
              const last = prev[prev.length - 1];
              if (last.role === 'assistant') {
                const newArr = [...prev];
                newArr[newArr.length - 1] = { ...last, content: last.content + payload.text };
                return newArr;
              }
            }
            return [...prev, { role: 'assistant', content: payload.text }];
          });
        } else if (payload.type === 'diff') {
          setMessages(prev => [
            ...prev,
            { role: 'assistant', content: 'I have proposed some code changes for your review:', diff: payload.diff, diffStatus: 'pending' }
          ]);
        }
      } catch (err) {
        console.error('Failed to parse WS message', err);
      }
    };

    socket.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };

    wsRef.current = socket;
  };

  const stopAgent = () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
      wsRef.current.close();
      wsRef.current = null;
      setConnected(false);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: 'input',
      input: input
    }));

    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
  };

  const handleApproveDiff = (msgIdx: number) => {
    if (!wsRef.current) return;
    const msg = 'Looks good, please apply those changes.';
    wsRef.current.send(JSON.stringify({ type: 'input', input: msg }));
    setMessages(prev => {
      const newArr = [...prev];
      newArr[msgIdx] = { ...newArr[msgIdx], diffStatus: 'approved' };
      return [...newArr, { role: 'user', content: msg }];
    });
  };

  const handleRejectDiff = (msgIdx: number, feedback: string) => {
    if (!wsRef.current) return;
    const msg = `I am rejecting the proposed diff. Please fix it based on this feedback:\n\n${feedback}`;
    wsRef.current.send(JSON.stringify({ type: 'input', input: msg }));
    setMessages(prev => {
      const newArr = [...prev];
      newArr[msgIdx] = { ...newArr[msgIdx], diffStatus: 'rejected' };
      return [...newArr, { role: 'user', content: msg }];
    });
  };

  const clearChat = () => {
    if (window.confirm('Are you sure you want to clear this chat history?')) {
      setMessages([]);
      localStorage.removeItem(storageKey);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface relative">
      <div className="flex items-center justify-between border-b border-hairline p-4 shrink-0 bg-surface z-10">
        <div className="flex items-center gap-3">
          <h3 className="font-display font-semibold text-content">Live Agent Chat</h3>
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-xs text-content-faint hover:text-rose-400 transition-colors cursor-pointer">
              Clear
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex bg-raised rounded-lg p-1 border border-hairline gap-1">
            <button
              onClick={() => setAgentName('openai-native')}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                agentName === 'openai-native' ? 'bg-accent text-white shadow-sm' : 'text-content-muted hover:text-content'
              )}
              disabled={connected}
            >
              <Sparkles size={14} />
              OpenAI
            </button>
            <button
              onClick={() => setAgentName('claude-native')}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                agentName === 'claude-native' ? 'bg-accent text-white shadow-sm' : 'text-content-muted hover:text-content'
              )}
              disabled={connected}
            >
              <Bot size={14} />
              Claude
            </button>
            {aiAssistants.filter(ai => ai.detected && ai.command).map(ai => (
              <button
                key={ai.name}
                onClick={() => setAgentName(ai.command!)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  agentName === ai.command ? 'bg-accent text-white shadow-sm' : 'text-content-muted hover:text-content'
                )}
                disabled={connected}
              >
                <Cpu size={14} />
                {ai.displayName}
              </button>
            ))}
          </div>
          {!connected ? (
            <Button variant="primary" icon={<PlaySquare size={14} />} onClick={startAgent} disabled={!agentName}>
              Start Agent
            </Button>
          ) : (
            <Button variant="secondary" icon={<Square size={14} />} onClick={stopAgent}>
              Stop
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-40">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-content-faint">
            No messages yet. Start the agent and say hello.
          </div>
        )}
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-accent text-white' : 'bg-surface border border-hairline'}`}>
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  <ChatMarkdown content={msg.content} />
                  {msg.diff && (
                    <DiffPanel
                      diffText={msg.diff}
                      onApprove={() => handleApproveDiff(idx)}
                      onReject={(feedback) => handleRejectDiff(idx, feedback)}
                      disabled={msg.diffStatus !== 'pending'}
                    />
                  )}
                  {msg.diffStatus === 'approved' && (
                    <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">✓ Approved</span>
                  )}
                  {msg.diffStatus === 'rejected' && (
                    <span className="text-[10px] text-rose-500 font-bold uppercase tracking-wider">✗ Rejected</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 p-4 pt-10 bg-gradient-to-t from-surface via-surface/80 to-transparent pointer-events-none">
        <div className="flex items-end gap-2 bg-surface/50 backdrop-blur-md border border-hairline p-2 rounded-xl shadow-lg pointer-events-auto max-w-4xl mx-auto">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder={connected ? 'Message the agent... (Shift+Enter for new line)' : 'Start the agent first...'}
            disabled={!connected}
            className="flex-1 min-h-[44px] max-h-[200px] resize-none bg-transparent border-none focus:ring-0 px-3 py-2 text-sm text-content"
            rows={1}
          />
          <Button variant="primary" className="h-[44px] rounded-lg shrink-0" icon={<Send size={14} />} onClick={sendMessage} disabled={!connected || !input.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
