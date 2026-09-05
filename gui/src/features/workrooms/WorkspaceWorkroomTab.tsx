import { useState, useMemo, type FormEvent } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  Send,
  RefreshCw,
  User,
  ShieldCheck,
  Layers,
  FileCode,
  Milestone,
  Radio,
  Network,
} from 'lucide-react';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { BsOpenai } from 'react-icons/bs';

import { AntigravityIcon } from '../../components/icons/AntigravityIcon.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Input } from '../../components/ui/input.js';
import { Spinner } from '../../components/ui/spinner.js';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { useWorkspaceStream, usePostWorkspaceStream } from '../../lib/api/queries.js';
import type { Feature, WorkspaceStreamMessage } from '../../types.js';

interface WorkspaceWorkroomTabProps {
  ws: Feature;
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function HarnessAvatar({ harness, author }: { harness?: string; author?: string }) {
  const norm = (harness || author || '').toLowerCase();
  if (norm.includes('claude')) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-[#D97757]/40 bg-[#D97757]/15 text-[#D97757] shadow-2xs">
        <SiClaude size={15} />
      </span>
    );
  }
  if (norm.includes('codex') || norm.includes('openai')) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 shadow-2xs">
        <BsOpenai size={14} />
      </span>
    );
  }
  if (norm.includes('copilot')) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-blue-500/40 bg-blue-500/15 text-blue-400 shadow-2xs">
        <SiGithubcopilot size={14} />
      </span>
    );
  }
  if (norm.includes('antigravity') || norm.includes('agy')) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/15 text-primary shadow-2xs">
        <AntigravityIcon className="size-4" />
      </span>
    );
  }
  if (norm.includes('dev') || norm.includes('human') || norm.includes('user')) {
    return (
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-foreground shadow-2xs">
        <User size={15} />
      </span>
    );
  }
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-muted text-muted-foreground shadow-2xs">
      <Activity size={15} />
    </span>
  );
}

function HarnessBadge({ harness, author }: { harness?: string; author?: string }) {
  const norm = (harness || author || '').toLowerCase();
  if (norm.includes('claude')) {
    return <Badge variant="outline" className="border-[#D97757]/50 text-[#D97757] bg-[#D97757]/10 font-mono text-[10px]">Claude Code</Badge>;
  }
  if (norm.includes('codex') || norm.includes('openai')) {
    return <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 bg-emerald-500/10 font-mono text-[10px]">OpenAI Codex</Badge>;
  }
  if (norm.includes('copilot')) {
    return <Badge variant="outline" className="border-blue-500/50 text-blue-400 bg-blue-500/10 font-mono text-[10px]">GitHub Copilot</Badge>;
  }
  if (norm.includes('antigravity') || norm.includes('agy')) {
    return <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 font-mono text-[10px]">Antigravity</Badge>;
  }
  if (norm.includes('dev') || norm.includes('human') || norm.includes('user')) {
    return <Badge variant="secondary" className="font-mono text-[10px]">Developer</Badge>;
  }
  return <Badge variant="outline" className="font-mono text-[10px]">{harness || 'Assistant'}</Badge>;
}

export function WorkspaceWorkroomTab({ ws, showToast }: WorkspaceWorkroomTabProps) {
  const { data, isLoading, refetch, isFetching } = useWorkspaceStream(ws.branchName, { refetchInterval: 3000 });
  const postMutation = usePostWorkspaceStream(ws.branchName);

  const [message, setMessage] = useState('');
  const [selectedHarness, setSelectedHarness] = useState<'developer' | 'antigravity' | 'claude' | 'codex'>('developer');
  const [stepId, setStepId] = useState('');
  const [evidence, setEvidence] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const messages: WorkspaceStreamMessage[] = useMemo(() => data?.messages ?? [], [data?.messages]);

  // Aggregate milestone progress from messages
  const milestones = useMemo(() => {
    const map = new Map<string, { stepId: string; status: 'proposed' | 'verified'; lastMessage: string; harness: string }>();
    for (const msg of messages) {
      if (msg.stepId) {
        const isVerified = Boolean(msg.evidence || (msg.message && msg.message.toLowerCase().includes('verified')));
        map.set(msg.stepId, {
          stepId: msg.stepId,
          status: isVerified ? 'verified' : 'proposed',
          lastMessage: msg.message || msg.content || '',
          harness: msg.harness || 'unknown',
        });
      }
    }
    return Array.from(map.values());
  }, [messages]);

  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    const cleanMsg = message.trim();
    if (!cleanMsg || postMutation.isPending) return;

    try {
      await postMutation.mutateAsync({
        message: cleanMsg,
        harness: selectedHarness,
        ...(stepId.trim() ? { stepId: stepId.trim() } : {}),
        ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
      });
      setMessage('');
      setEvidence('');
      showToast?.('Handoff update posted to workspace stream.', 'success');
    } catch (err) {
      showToast?.(`Failed to post update: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in pb-12" data-testid="workspace-workroom-tab">
      {/* Workroom Stream Header Card */}
      <Card className="p-4 bg-card/60 surface-card border-border/80">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary border border-primary/20">
                <Radio size={14} className="animate-pulse" />
              </span>
              <h3 className="text-sm font-semibold text-foreground tracking-tight">
                Workspace Workroom & Handoff Stream
              </h3>
              <Badge variant="success" className="gap-1">
                <span className="size-1.5 rounded-full bg-success" />
                Live Ledger
              </Badge>
              {data?.isRemoteActive && data.remoteStatus && (
                <Badge variant="info" className="gap-1">
                  <Network size={11} />
                  LAN Room Active ({data.remoteStatus.roomId.slice(0, 8)})
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Direct peer coordination ledger located at <code className="font-mono text-[11px] text-foreground/80">.nexusflow/chat.jsonl</code>.
              Harnesses record progress, exchange state, and verify milestones with zero network overhead.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="xs"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="gap-1.5 text-xs"
            >
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </Button>
          </div>
        </div>

        {/* Milestone Quick Summary (if any) */}
        {milestones.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border/60">
            <div className="flex items-center gap-2 mb-2">
              <Milestone size={13} className="text-primary" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Tracked Milestones ({milestones.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {milestones.map((m) => (
                <div
                  key={m.stepId}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs font-mono ${
                    m.status === 'verified'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  }`}
                  title={`${m.stepId} · ${m.status}: ${m.lastMessage}`}
                >
                  {m.status === 'verified' ? (
                    <CheckCircle2 size={12} className="text-emerald-400" />
                  ) : (
                    <Clock size={12} className="text-amber-400" />
                  )}
                  <span className="font-semibold">{m.stepId}</span>
                  <span className="text-[10px] opacity-75 capitalize">({m.status})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Stream Timeline */}
      <Card className="divide-y divide-border/60 overflow-hidden surface-card border-border/80">
        <div className="p-3.5 bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-muted-foreground" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Timeline Activity ({messages.length})
            </h4>
          </div>
          <span className="text-[11px] font-mono text-muted-foreground">
            Isolated to {ws.branchName}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            <Spinner className="size-5 mr-2" />
            <span className="text-xs">Loading workroom stream…</span>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
            <span className="grid size-10 place-items-center rounded-full bg-muted/50 text-muted-foreground mb-3">
              <Radio size={20} />
            </span>
            <p className="text-xs font-semibold text-foreground">No handoff events recorded yet</p>
            <p className="text-[11px] text-muted-foreground max-w-sm mt-1">
              AI assistants using the <code className="font-mono text-[10px]">post_workroom_handoff</code> tool will post updates here automatically. You can also write an update below.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40 max-h-[38rem] overflow-y-auto">
            {messages.map((entry, idx) => {
              const bodyText = entry.message || entry.content || '';
              const authorLabel = entry.author || entry.harness || 'Assistant';
              return (
                <div key={entry.id || idx} className="p-4 transition-colors hover:bg-muted/10">
                  <div className="flex items-start gap-3">
                    <HarnessAvatar harness={entry.harness} author={entry.author} />
                    <div className="min-w-0 flex-1">
                      {/* Top row: Actor, Badge, Timestamp */}
                      <div className="flex flex-wrap items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {authorLabel}
                        </span>
                        <HarnessBadge harness={entry.harness} author={entry.author} />
                        {entry.stepId && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/30 bg-primary/10 text-primary font-mono text-[10px]">
                            <Milestone size={10} />
                            {entry.stepId}
                          </span>
                        )}
                        <time className="text-[10px] font-mono text-muted-foreground ml-auto">
                          {formatRelativeTime(entry.timestamp)}
                        </time>
                      </div>

                      {/* Content */}
                      <div className="text-xs text-foreground/90 leading-relaxed break-words">
                        <ChatMarkdown content={bodyText} />
                      </div>

                      {/* Evidence block (if verified milestone) */}
                      {entry.evidence && (
                        <div className="mt-2.5 p-2.5 rounded-md border border-emerald-500/30 bg-emerald-500/5">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 mb-1">
                            <ShieldCheck size={13} />
                            <span>Verification Evidence</span>
                          </div>
                          <pre className="font-mono text-[11px] text-emerald-300/90 whitespace-pre-wrap break-all">
                            {entry.evidence}
                          </pre>
                        </div>
                      )}

                      {/* Artifacts pills (if any) */}
                      {Array.isArray(entry.artifacts) && entry.artifacts.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.artifacts.map((art, aIdx) => (
                            <span
                              key={aIdx}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/60 border border-border/80 text-[11px] font-mono text-muted-foreground"
                              title={art.summary || art.path}
                            >
                              <FileCode size={11} className="text-primary" />
                              <span>{art.title || art.path}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Composer Form */}
        <form onSubmit={handleSubmit} className="p-4 bg-muted/20 border-t border-border/80">
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Post as:</span>
                <div className="flex items-center gap-1 bg-card rounded-md border border-border/80 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setSelectedHarness('developer')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      selectedHarness === 'developer'
                        ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Developer
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedHarness('antigravity')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      selectedHarness === 'antigravity'
                        ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Antigravity
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedHarness('claude')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      selectedHarness === 'claude'
                        ? 'bg-[#D97757] text-white font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Claude
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedHarness('codex')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      selectedHarness === 'codex'
                        ? 'bg-emerald-600 text-white font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Codex
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors cursor-pointer"
              >
                {showAdvanced ? 'Hide Milestone Fields' : '+ Milestone & Evidence'}
              </button>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-2.5 rounded-md border border-border/70 bg-card/50 text-xs">
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase">Milestone ID (Optional)</label>
                  <Input
                    placeholder="e.g. step-1-api-routes"
                    value={stepId}
                    onChange={(e) => setStepId(e.target.value)}
                    className="h-7 text-xs font-mono mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-mono text-muted-foreground uppercase">Evidence / Test Output (Optional)</label>
                  <Input
                    placeholder="e.g. 12/12 unit tests passing"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    className="h-7 text-xs font-mono mt-1"
                  />
                </div>
              </div>
            )}

            <div className="relative">
              <Textarea
                placeholder="Share a decision, milestone result, blocker, or handoff instruction for other harnesses…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void handleSubmit();
                  }
                }}
                className="min-h-[4.5rem] text-xs leading-relaxed resize-y pr-24 bg-card"
              />
              <div className="absolute right-2 bottom-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={!message.trim() || postMutation.isPending}
                  className="gap-1.5 text-xs font-medium"
                >
                  {postMutation.isPending ? (
                    <Spinner className="size-3" />
                  ) : (
                    <Send size={12} />
                  )}
                  <span>Post</span>
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
              <span>Press <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px] font-mono">Ctrl</kbd> + <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[9px] font-mono">Enter</kbd> to send</span>
              <span>Logged to <code className="font-mono">.nexusflow/chat.jsonl</code></span>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
