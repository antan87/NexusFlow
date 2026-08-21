import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  MessageSquare,
  Terminal,
  Plus,
  Search,
  ArrowUpDown,
  Check,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../../components/icons/AntigravityIcon.js';

import type { AISession, Feature, TranscriptMessage } from '../../types.js';
import { Card } from '../../components/ui/card.js';
import { Spinner } from '../../components/ui/spinner.js';
import { useWorkspaceLaunchTargets, useLaunchTerminal, useAiDetect } from '../../lib/api/queries.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { apiFetch } from '../../lib/api/client.js';
import { cn } from '../../lib/utils.js';

export type SessionSortOption =
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'messages-desc'
  | 'title-asc';

export type SessionViewMode = 'harness' | 'timeline';

interface SessionHistoryProps {
  ws: Feature;
  sessions: AISession[];
  sessionsLoading: boolean;
  setActiveSession: (val: AISession | null) => void;
  setTranscript: (val: TranscriptMessage[]) => void;
  fetchSessionTranscript: (assistant: string, sessionId: string) => Promise<void>;
  handleOpenDesktopSession: (ws: Feature, sessionId: string, assistant: string) => Promise<boolean>;
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
}

export const getResumeCliCommand = (assistant: string, sessionId: string): string => {
  switch (assistant) {
    case 'antigravity':
      return `agy --conversation ${sessionId}`;
    case 'claude':
      return `claude --resume ${sessionId}`;
    case 'codex':
      return `codex resume ${sessionId}`;
    case 'copilot':
      return `copilot --resume ${sessionId}`;
    default:
      return `agy --conversation ${sessionId}`;
  }
};

const renderAssistantIcon = (ast: string) => {
  switch (ast) {
    case 'antigravity':
      return (
        <span className="grid size-5.5 place-items-center rounded-md bg-card border border-border/80 shadow-2xs p-0.5 shrink-0" title="Google Antigravity">
          <AntigravityIcon className="size-3.5" />
        </span>
      );
    case 'claude':
      return (
        <span className="grid size-5.5 place-items-center rounded-md bg-[#D97757] text-white font-bold text-[9px] shadow-2xs shrink-0" title="Claude Code">
          <SiClaude className="size-2.5" />
        </span>
      );
    case 'codex':
      return (
        <span className="grid size-5.5 place-items-center rounded-md bg-foreground text-background font-bold text-[9px] shadow-2xs shrink-0" title="OpenAI Codex">
          <BsOpenai className="size-2.5" />
        </span>
      );
    case 'copilot':
      return (
        <span className="grid size-5.5 place-items-center rounded-md bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white font-bold text-[9px] shadow-2xs shrink-0" title="GitHub Copilot">
          <SiGithubcopilot className="size-2.5" />
        </span>
      );
    default:
      return null;
  }
};

const formatDate = (dStr?: string) => {
  if (!dStr) return '';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = now.toDateString() === d.toDateString();
  if (isToday) {
    return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  ws,
  sessions,
  sessionsLoading,
  setActiveSession,
  setTranscript,
  fetchSessionTranscript,
  handleOpenDesktopSession,
  showToast,
}) => {
  const launchTargets = useWorkspaceLaunchTargets();
  const launchTerminalMutation = useLaunchTerminal();
  const aiDetect = useAiDetect();

  const isAgyDetected = aiDetect.data?.find((a) => a.name === 'antigravity')?.detected ?? true;
  const isClaudeDetected = aiDetect.data?.find((a) => a.name === 'claude')?.detected ?? false;
  const isCodexDetected = aiDetect.data?.find((a) => a.name === 'codex')?.detected ?? false;
  const isCopilotDetected = aiDetect.data?.find((a) => a.name === 'copilot')?.detected ?? false;

  const hasAgyIde = Boolean(launchTargets.data?.some((t) => t.id === 'antigravity' && t.available));
  const hasCodexDesktop = Boolean(launchTargets.data?.some((t) => t.id === 'codex-desktop' && t.available));

  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);
  const [resumingTerminalId, setResumingTerminalId] = useState<string | null>(null);
  const [launchingNewAssistant, setLaunchingNewAssistant] = useState<string | null>(null);
  const [launchedInfo, setLaunchedInfo] = useState<{ assistant: string; cmd: string; timestamp: Date } | null>(null);

  // Sorting & Filtering state
  const [sortBy, setSortBy] = useState<SessionSortOption>('created-desc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<SessionViewMode>('harness');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssistantFilter, setSelectedAssistantFilter] = useState<string>('all');

  useEffect(() => {
    if (!sortMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [sortMenuOpen]);

  // Collapsed / expanded state per harness (default to false / collapsed)
  const [expandedHarnesses, setExpandedHarnesses] = useState<Record<string, boolean>>({
    antigravity: false,
    claude: false,
    codex: false,
    copilot: false,
  });

  const toggleHarness = (id: string) => {
    setExpandedHarnesses((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const resumingTerminalRef = useRef(false);
  const openingDesktopRef = useRef<string | null>(null);

  const openAppTarget = async (targetId: string) => {
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(ws.branchName)}/launch`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      });
      const name = targetId === 'claude-desktop' ? 'Claude Desktop' : targetId === 'codex-desktop' ? 'Codex Desktop' : targetId;
      showToast?.(`Launched ${name} for workspace ${ws.branchName}`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to launch desktop application';
      showToast?.(message, 'error');
    }
  };

  const startNewSession = async (assistant: string) => {
    if (launchingNewAssistant) return;
    setLaunchingNewAssistant(assistant);
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: ws.branchName,
        assistant,
      });
      const cmd = assistant === 'antigravity' ? 'agy' : assistant === 'claude' ? 'claude' : assistant === 'codex' ? 'codex' : 'copilot';
      setLaunchedInfo({
        assistant,
        cmd,
        timestamp: new Date(),
      });
      showToast?.(`Started new ${assistant} session in terminal`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to launch terminal';
      showToast?.(message, 'error');
    } finally {
      setLaunchingNewAssistant(null);
    }
  };

  const resumeTerminalSession = async (sessionId: string, assistant: string) => {
    if (resumingTerminalRef.current) return;
    resumingTerminalRef.current = true;
    setResumingTerminalId(sessionId);
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: ws.branchName,
        sessionId,
        assistant,
      });
      const cmd = getResumeCliCommand(assistant, sessionId);
      setLaunchedInfo({
        assistant,
        cmd,
        timestamp: new Date(),
      });
      showToast?.(`Resumed ${assistant} session in terminal`, 'success');
    } catch (err: unknown) {
      const fallbackCmd = getResumeCliCommand(assistant, sessionId);
      await safeCopyToClipboard(fallbackCmd);
      showToast?.(`Copied resume command to clipboard: ${fallbackCmd}`, 'info');
    } finally {
      setResumingTerminalId(null);
      resumingTerminalRef.current = false;
    }
  };

  const openCodexDesktop = async (sessionId: string) => {
    if (!hasCodexDesktop || openingDesktopRef.current) return;
    openingDesktopRef.current = sessionId;
    setOpeningDesktopId(sessionId);
    try {
      await handleOpenDesktopSession(ws, sessionId, 'codex');
    } finally {
      openingDesktopRef.current = null;
      setOpeningDesktopId(null);
    }
  };

  // Sort comparator function
  const sortSessions = (sessionList: AISession[], order: SessionSortOption): AISession[] => {
    return [...sessionList].sort((a, b) => {
      switch (order) {
        case 'created-desc': {
          const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
          const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
          return bTime - aTime;
        }
        case 'created-asc': {
          const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
          const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
          return aTime - bTime;
        }
        case 'updated-desc': {
          const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
          const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
          return bTime - aTime;
        }
        case 'messages-desc': {
          return (b.messageCount || 0) - (a.messageCount || 0);
        }
        case 'title-asc': {
          return (a.title || '').localeCompare(b.title || '');
        }
        default:
          return 0;
      }
    });
  };

  // Filtered & sorted master list
  const filteredSessions = useMemo(() => {
    let list = sessions;
    if (selectedAssistantFilter !== 'all') {
      list = list.filter((s) => s.assistant === selectedAssistantFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) => `${s.title} ${s.id} ${s.assistant}`.toLowerCase().includes(q));
    }
    return sortSessions(list, sortBy);
  }, [sessions, selectedAssistantFilter, searchQuery, sortBy]);

  // Group sessions by assistant with sorting applied
  const agySessions = useMemo(
    () => sortSessions(sessions.filter((s) => s.assistant === 'antigravity'), sortBy),
    [sessions, sortBy]
  );
  const claudeSessions = useMemo(
    () => sortSessions(sessions.filter((s) => s.assistant === 'claude'), sortBy),
    [sessions, sortBy]
  );
  const codexSessions = useMemo(
    () => sortSessions(sessions.filter((s) => s.assistant === 'codex'), sortBy),
    [sessions, sortBy]
  );
  const copilotSessions = useMemo(
    () => sortSessions(sessions.filter((s) => s.assistant === 'copilot'), sortBy),
    [sessions, sortBy]
  );

  const isAssistantConfigured = (id: string) => ws.assistants?.includes(id) ?? false;

  const allHarnesses = [
    {
      id: 'antigravity',
      name: 'Google Antigravity',
      cliCommand: 'agy',
      isDetected: isAgyDetected,
      isConfigured: isAssistantConfigured('antigravity'),
      hasApp: hasAgyIde,
      appName: 'IDE',
      appTargetId: 'antigravity',
      sessions: agySessions,
      icon: (
        <span className="grid size-6 place-items-center rounded-md bg-card border border-border/80 shadow-2xs p-0.5">
          <AntigravityIcon className="size-4" />
        </span>
      ),
    },
    {
      id: 'claude',
      name: 'Claude Code',
      cliCommand: 'claude',
      isDetected: isClaudeDetected,
      isConfigured: isAssistantConfigured('claude'),
      hasApp: false,
      appName: 'App',
      appTargetId: 'claude',
      sessions: claudeSessions,
      icon: (
        <span className="grid size-6 place-items-center rounded-md bg-[#D97757] text-white font-bold text-[10px] shadow-2xs">
          <SiClaude className="size-3" />
        </span>
      ),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      cliCommand: 'codex',
      isDetected: isCodexDetected,
      isConfigured: isAssistantConfigured('codex'),
      hasApp: hasCodexDesktop,
      appName: 'Desktop',
      appTargetId: 'codex-desktop',
      sessions: codexSessions,
      icon: (
        <span className="grid size-6 place-items-center rounded-md bg-foreground text-background font-bold text-[10px] shadow-2xs">
          <BsOpenai className="size-3" />
        </span>
      ),
    },
    {
      id: 'copilot',
      name: 'GitHub Copilot',
      cliCommand: 'copilot',
      isDetected: isCopilotDetected,
      isConfigured: isAssistantConfigured('copilot'),
      hasApp: false,
      appName: 'App',
      appTargetId: 'copilot',
      sessions: copilotSessions,
      icon: (
        <span className="grid size-6 place-items-center rounded-md bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white font-bold text-[10px] shadow-2xs">
          <SiGithubcopilot className="size-3" />
        </span>
      ),
    },
  ];

  const installedHarnesses = allHarnesses;

  const sortLabelMap: Record<SessionSortOption, string> = {
    'created-desc': 'Newest',
    'created-asc': 'Oldest',
    'updated-desc': 'Recently active',
    'messages-desc': 'Most turns',
    'title-asc': 'A–Z',
  };

  return (
    <div className="space-y-2.5">
      {/* Search, Filter & Sort Order Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between bg-card/60 p-2 rounded-lg border border-border/70">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="relative flex-1 min-w-0 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chat sessions..."
              className="w-full pl-7 pr-6 py-1 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[10px] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Assistant Filter Pills */}
          <div className="hidden md:flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSelectedAssistantFilter('all')}
              className={cn(
                'px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors cursor-pointer',
                selectedAssistantFilter === 'all'
                  ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                  : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
              )}
            >
              All ({sessions.length})
            </button>
            {['antigravity', 'claude', 'codex', 'copilot'].map((ast) => {
              const count = sessions.filter((s) => s.assistant === ast).length;
              return (
                <button
                  type="button"
                  key={ast}
                  onClick={() => setSelectedAssistantFilter(selectedAssistantFilter === ast ? 'all' : ast)}
                  className={cn(
                    'px-2 py-0.5 text-[11px] rounded-md font-medium capitalize transition-colors cursor-pointer',
                    selectedAssistantFilter === ast
                      ? 'bg-primary text-primary-foreground font-semibold shadow-2xs'
                      : 'bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted'
                  )}
                >
                  {ast} ({count})
                </button>
              );
            })}
          </div>

          {sessionsLoading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 pl-1">
              <Spinner className="size-3" />
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Order / Sort Dropdown Menu */}
          <div className="relative" ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setSortMenuOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent cursor-pointer shadow-2xs transition-colors"
              title="Change sort order"
              aria-expanded={sortMenuOpen}
            >
              <ArrowUpDown size={11} className="text-muted-foreground" />
              <span>{sortLabelMap[sortBy]}</span>
              <ChevronDown size={10} className={cn('text-muted-foreground opacity-70 transition-transform duration-150', sortMenuOpen && 'rotate-180')} />
            </button>

            {sortMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 z-50 rounded-lg border border-border bg-popover p-1 shadow-lg text-foreground animate-fade-in">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Order Chats By
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy('created-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'created-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>📅 Newest created</span>
                  {sortBy === 'created-desc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('created-asc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'created-asc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>⏳ Oldest created</span>
                  {sortBy === 'created-asc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('updated-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'updated-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>⚡ Recently active</span>
                  {sortBy === 'updated-desc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('messages-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'messages-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>💬 Most turns</span>
                  {sortBy === 'messages-desc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('title-asc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'title-asc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>🔤 Title (A–Z)</span>
                  {sortBy === 'title-asc' && <Check size={12} className="text-primary" />}
                </button>
              </div>
            )}
          </div>

          {/* View Mode Toggle: Grouped vs Timeline */}
          <div className="flex items-center rounded-md border border-border bg-background p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode('harness')}
              title="Group chats by AI Harness"
              className={cn(
                'px-2 py-0.5 text-xs rounded font-medium transition-colors cursor-pointer',
                viewMode === 'harness' ? 'bg-accent text-accent-foreground font-semibold shadow-2xs' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Grouped
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              title="Unified Chronological Timeline"
              className={cn(
                'px-2 py-0.5 text-xs rounded font-medium transition-colors cursor-pointer',
                viewMode === 'timeline' ? 'bg-accent text-accent-foreground font-semibold shadow-2xs' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Timeline
            </button>
          </div>
        </div>
      </div>

      {/* Live Session HUD Banner */}
      {launchedInfo && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs animate-fade-in">
          <div className="flex items-center gap-2 text-foreground min-w-0">
            <span className="size-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="truncate">
              <strong>Active in terminal:</strong>{' '}
              <code className="font-mono bg-background/80 px-1.5 py-0.5 rounded text-emerald-400">
                {launchedInfo.cmd}
              </code>
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={async () => {
                await safeCopyToClipboard(launchedInfo.cmd);
                showToast?.('Command copied to clipboard!', 'success');
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              <Copy size={11} /> Copy
            </button>
            <button
              type="button"
              onClick={() => setLaunchedInfo(null)}
              className="text-muted-foreground hover:text-foreground cursor-pointer text-xs px-1"
              title="Dismiss banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Timeline View (Unified sorted list across all harnesses) */}
      {viewMode === 'timeline' ? (
        <div className="space-y-1.5">
          {filteredSessions.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground bg-card/40 rounded-lg border border-border">
              {searchQuery ? 'No chat sessions match your search filter.' : 'No chat sessions recorded yet.'}
            </div>
          ) : (
            filteredSessions.map((sess) => (
              <div
                key={sess.id}
                className="group flex flex-col gap-2 rounded-lg border border-border/70 bg-card/70 p-2 transition-all hover:border-primary/40 hover:bg-card hover:shadow-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {renderAssistantIcon(sess.assistant)}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                      <span className="font-semibold capitalize text-foreground/90">
                        {sess.assistant === 'antigravity' ? 'Antigravity' : sess.assistant === 'claude' ? 'Claude' : sess.assistant === 'codex' ? 'Codex' : 'Copilot'}
                      </span>
                      <span>•</span>
                      <span className="font-mono text-muted-foreground/80">{sess.id.slice(0, 8)}</span>
                      <span>•</span>
                      <span>{formatDate(sess.createdAt || sess.updatedAt)}</span>
                      <span>•</span>
                      <span className="font-medium text-foreground/75">
                        {sess.messageCount} {sess.messageCount === 1 ? 'turn' : 'turns'}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-foreground truncate" title={sess.title}>
                      {sess.title}
                    </p>
                  </div>
                </div>

                {/* Sleek Balanced Action Toolbar */}
                <div className="flex items-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                  <button
                    type="button"
                    disabled={resumingTerminalId === sess.id}
                    onClick={() => void resumeTerminalSession(sess.id, sess.assistant)}
                    title={`Resume session in terminal (${sess.id})`}
                    className="inline-flex items-center justify-center gap-1 min-w-20 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600/90 text-white hover:bg-emerald-600 shadow-2xs hover:shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    {resumingTerminalId === sess.id ? <Spinner className="size-3" /> : <Terminal size={12} />}
                    <span>Resume</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setActiveSession(sess);
                      setTranscript([]);
                      fetchSessionTranscript(sess.assistant, sess.id);
                    }}
                    title="Inspect transcript log"
                    className="inline-flex items-center justify-center gap-1 min-w-16 px-2 py-1 text-xs font-medium rounded-md border border-border bg-background/80 text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <MessageSquare size={12} className="text-muted-foreground" />
                    <span>Logs</span>
                  </button>

                  {sess.assistant === 'codex' && hasCodexDesktop && (
                    <button
                      type="button"
                      disabled={openingDesktopId === sess.id}
                      onClick={() => void openCodexDesktop(sess.id)}
                      title="Open in Codex Desktop"
                      className="inline-flex items-center justify-center gap-1 min-w-18 px-2 py-1 text-xs font-medium rounded-md border border-border bg-background/80 text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {openingDesktopId === sess.id ? <Spinner className="size-3" /> : <ExternalLink size={12} />}
                      <span>Desktop</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={async () => {
                      const cmd = getResumeCliCommand(sess.assistant, sess.id);
                      await safeCopyToClipboard(cmd);
                      showToast?.(`Copied: ${cmd}`, 'success');
                    }}
                    title="Copy CLI resume command"
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Grouped View (By Harness) */
        <div className="space-y-2">
          {installedHarnesses.map((harness) => {
            const isExpanded = expandedHarnesses[harness.id] ?? false;
            const harnessSessions = harness.sessions.filter((s) => {
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return `${s.title} ${s.id}`.toLowerCase().includes(q);
            });

            return (
              <Card key={harness.id} className="overflow-hidden border border-border/80 bg-card shadow-2xs">
                {/* Sleek Minimal Harness Header Bar */}
                <div
                  className={cn(
                    'flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between bg-card/70 transition-colors',
                    isExpanded && 'border-b border-border/50'
                  )}
                >
                  <div
                    onClick={() => toggleHarness(harness.id)}
                    className="flex flex-1 items-center gap-2 cursor-pointer select-none"
                  >
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-transform"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>

                    {harness.icon}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-xs text-foreground">{harness.name}</span>

                      {harness.isDetected ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          CLI: {harness.cliCommand}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
                          {harness.cliCommand}
                        </span>
                      )}

                      {harness.hasApp && (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {harness.appName}
                        </span>
                      )}

                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">
                        {harnessSessions.length} {harnessSessions.length === 1 ? 'session' : 'sessions'}
                      </span>
                    </div>
                  </div>

                  {/* Uniform, Sleek Header Action Buttons */}
                  <div className="flex items-center gap-1.5 shrink-0 pl-6 sm:pl-0">
                    <button
                      type="button"
                      disabled={launchingNewAssistant === harness.id}
                      onClick={() => void startNewSession(harness.id)}
                      title={`Launch new ${harness.cliCommand} session in terminal`}
                      className="inline-flex items-center justify-center gap-1.5 min-w-28 px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shadow-2xs hover:shadow-xs transition-all cursor-pointer disabled:opacity-50"
                    >
                      {launchingNewAssistant === harness.id ? (
                        <Spinner className="size-3" />
                      ) : (
                        <Plus size={12} />
                      )}
                      <span>New Session</span>
                    </button>

                    {harness.hasApp && (
                      <button
                        type="button"
                        onClick={() => void openAppTarget(harness.appTargetId)}
                        title={`Open in ${harness.appName}`}
                        className="inline-flex items-center justify-center gap-1 min-w-18 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors cursor-pointer"
                      >
                        <ExternalLink size={12} className="opacity-80" />
                        <span>{harness.appName}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Session Cards List */}
                {isExpanded && (
                  <div className="bg-muted/15 p-2 space-y-1.5">
                    {harnessSessions.length === 0 ? (
                      <div className="py-2 px-3 text-center text-xs text-muted-foreground rounded border border-border/40 bg-card/40 flex items-center justify-center gap-2">
                        <span>
                          {searchQuery ? 'No sessions match your search query.' : `No previous sessions recorded for ${harness.name}.`}
                        </span>
                        {!searchQuery && (
                          <button
                            type="button"
                            onClick={() => void startNewSession(harness.id)}
                            className="text-primary font-medium hover:underline cursor-pointer inline-flex items-center gap-1 text-xs"
                          >
                            <Plus size={11} /> Start session
                          </button>
                        )}
                      </div>
                    ) : (
                      harnessSessions.map((sess) => (
                        <div
                          key={sess.id}
                          className="group flex flex-col gap-1.5 rounded-md border border-border/60 bg-card p-2 transition-all hover:border-primary/40 hover:shadow-2xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5 mb-0.5 text-[10px] text-muted-foreground">
                              <span className="font-mono text-muted-foreground/80">{sess.id.slice(0, 8)}</span>
                              <span>•</span>
                              <span>{formatDate(sess.createdAt || sess.updatedAt)}</span>
                              {sess.updatedAt && sess.updatedAt !== sess.createdAt && (
                                <>
                                  <span>•</span>
                                  <span className="text-muted-foreground/75">Active {formatDate(sess.updatedAt)}</span>
                                </>
                              )}
                              <span>•</span>
                              <span className="font-medium text-foreground/75">
                                {sess.messageCount} {sess.messageCount === 1 ? 'turn' : 'turns'}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-foreground truncate" title={sess.title}>
                              {sess.title}
                            </p>
                          </div>

                          {/* Sleek Balanced Action Toolbar */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={resumingTerminalId === sess.id}
                              onClick={() => void resumeTerminalSession(sess.id, sess.assistant)}
                              title={`Resume session in terminal (${sess.id})`}
                              className="inline-flex items-center justify-center gap-1 min-w-20 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-600/90 text-white hover:bg-emerald-600 shadow-2xs hover:shadow-xs transition-all cursor-pointer disabled:opacity-50"
                            >
                              {resumingTerminalId === sess.id ? <Spinner className="size-3" /> : <Terminal size={12} />}
                              <span>Resume</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveSession(sess);
                                setTranscript([]);
                                fetchSessionTranscript(sess.assistant, sess.id);
                              }}
                              title="Inspect transcript log"
                              className="inline-flex items-center justify-center gap-1 min-w-16 px-2 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors cursor-pointer"
                            >
                              <MessageSquare size={12} className="text-muted-foreground" />
                              <span>Logs</span>
                            </button>

                            {sess.assistant === 'codex' && hasCodexDesktop && (
                              <button
                                type="button"
                                disabled={openingDesktopId === sess.id}
                                onClick={() => void openCodexDesktop(sess.id)}
                                title="Open in Codex Desktop"
                                className="inline-flex items-center justify-center gap-1 min-w-18 px-2 py-1 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-accent transition-colors cursor-pointer disabled:opacity-50"
                              >
                                {openingDesktopId === sess.id ? <Spinner className="size-3" /> : <ExternalLink size={12} />}
                                <span>Desktop</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={async () => {
                                const cmd = getResumeCliCommand(sess.assistant, sess.id);
                                await safeCopyToClipboard(cmd);
                                showToast?.(`Copied: ${cmd}`, 'success');
                              }}
                              title="Copy CLI resume command"
                              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
