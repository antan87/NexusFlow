import React, { useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  MessageSquare,
  Terminal,
  Plus,
  Check,
  Sparkles,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude } from 'react-icons/si';

import type { AISession, Feature, TranscriptMessage } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Spinner } from '../../components/ui/spinner.js';
import { useWorkspaceLaunchTargets, useLaunchTerminal, useAiDetect } from '../../lib/api/queries.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { apiFetch } from '../../lib/api/client.js';

interface SessionHistoryProps {
  ws: Feature;
  sessions: AISession[];
  sessionsLoading: boolean;
  setActiveSession: (val: AISession | null) => void;
  setTranscript: (val: TranscriptMessage[]) => void;
  fetchSessionTranscript: (assistant: string, sessionId: string) => Promise<void>;
  handleOpenDesktopSession: (ws: Feature, sessionId: string, assistant: string) => Promise<boolean>;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
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

  const hasAgyIde = Boolean(launchTargets.data?.some((t) => t.id === 'antigravity' && t.available));
  const hasClaudeDesktop = Boolean(launchTargets.data?.some((t) => t.id === 'claude-desktop' && t.available));
  const hasCodexDesktop = Boolean(launchTargets.data?.some((t) => t.id === 'codex-desktop' && t.available));

  const [openingDesktopId, setOpeningDesktopId] = useState<string | null>(null);
  const [resumingTerminalId, setResumingTerminalId] = useState<string | null>(null);
  const [launchingNewAssistant, setLaunchingNewAssistant] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Collapsed / expanded state per harness (default to expanded if it has sessions or is configured)
  const [expandedHarnesses, setExpandedHarnesses] = useState<Record<string, boolean>>({
    antigravity: true,
    claude: true,
    codex: true,
  });

  const toggleHarness = (id: string) => {
    setExpandedHarnesses((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const resumingTerminalRef = useRef(false);
  const openingDesktopRef = useRef<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    };
  }, []);

  const openAppTarget = async (targetId: string) => {
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(ws.branchName)}/launch`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      });
      showToast?.(`Launched ${targetId}.`, 'success');
    } catch (err) {
      console.error(`Failed to launch ${targetId}:`, err);
      showToast?.(`Failed to launch ${targetId}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const startNewSession = async (assistant: string) => {
    if (resumingTerminalRef.current) return;
    resumingTerminalRef.current = true;
    setLaunchingNewAssistant(assistant);
    const cmd = assistant === 'antigravity' ? 'agy' : assistant === 'claude' ? 'claude' : assistant === 'codex' ? 'codex' : 'copilot';
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: ws.branchName,
        assistant,
      });
      await safeCopyToClipboard(cmd);
      showToast?.(`Launched new ${assistant} session in terminal. Command '${cmd}' copied to clipboard.`, 'success');
    } catch (err) {
      const copied = await safeCopyToClipboard(cmd);
      if (copied) {
        showToast?.(`Could not spawn terminal window automatically. Copied '${cmd}' to clipboard.`, 'info');
      } else {
        showToast?.(`Could not spawn terminal (${err instanceof Error ? err.message : 'Error'}). Run: ${cmd}`, 'error');
      }
    } finally {
      setLaunchingNewAssistant(null);
      resumingTerminalRef.current = false;
    }
  };

  const resumeInTerminal = async (assistant: string, sessionId: string) => {
    if (resumingTerminalRef.current) return;
    resumingTerminalRef.current = true;
    setResumingTerminalId(sessionId);
    const cmd = getResumeCliCommand(assistant, sessionId);
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: ws.branchName,
        assistant,
        sessionId,
      });
      await safeCopyToClipboard(cmd);
      showToast?.(`Resumed ${assistant} session in terminal. Command copied to clipboard.`, 'success');
    } catch (err) {
      const copied = await safeCopyToClipboard(cmd);
      if (copied) {
        setCopiedId(sessionId);
        if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = window.setTimeout(() => setCopiedId(null), 2500);
        showToast?.(`Could not launch terminal automatically. Copied resume command to clipboard:\n\n${cmd}`, 'info');
      } else {
        showToast?.(`Could not launch terminal automatically (${err instanceof Error ? err.message : 'Error'}). Run manually:\n\n${cmd}`, 'error');
      }
    } finally {
      setResumingTerminalId(null);
      resumingTerminalRef.current = false;
    }
  };

  const copyResumeCommand = async (assistant: string, sessionId: string) => {
    const cmd = getResumeCliCommand(assistant, sessionId);
    const copied = await safeCopyToClipboard(cmd);
    if (copied) {
      setCopiedId(sessionId);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setCopiedId(null), 2500);
      showToast?.(`Copied resume command to clipboard:\n\n${cmd}`, 'success');
    } else {
      showToast?.(`Could not copy to clipboard. Run manually:\n\n${cmd}`, 'error');
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

  // Group sessions by assistant
  const agySessions = sessions.filter((s) => s.assistant === 'antigravity');
  const claudeSessions = sessions.filter((s) => s.assistant === 'claude');
  const codexSessions = sessions.filter((s) => s.assistant === 'codex');

  const allHarnesses = [
    {
      id: 'antigravity',
      name: 'Google Antigravity',
      cliCommand: 'agy',
      isDetected: isAgyDetected,
      hasApp: hasAgyIde,
      appName: 'Antigravity IDE',
      appTargetId: 'antigravity',
      sessions: agySessions,
      badgeTone: 'accent' as const,
      icon: (
        <span className="grid size-7 place-items-center rounded-lg bg-violet-600 text-white font-bold text-xs shadow-sm">
          A
        </span>
      ),
    },
    {
      id: 'claude',
      name: 'Claude Code',
      cliCommand: 'claude',
      isDetected: isClaudeDetected,
      hasApp: hasClaudeDesktop,
      appName: 'Claude Desktop',
      appTargetId: 'claude-desktop',
      sessions: claudeSessions,
      badgeTone: 'warning' as const,
      icon: (
        <span className="grid size-7 place-items-center rounded-lg bg-[#D97757] text-white font-bold text-xs shadow-sm">
          <SiClaude className="size-3.5" />
        </span>
      ),
    },
    {
      id: 'codex',
      name: 'OpenAI Codex',
      cliCommand: 'codex',
      isDetected: isCodexDetected,
      hasApp: hasCodexDesktop,
      appName: 'Codex Desktop',
      appTargetId: 'codex-desktop',
      sessions: codexSessions,
      badgeTone: 'success' as const,
      icon: (
        <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background font-bold text-xs shadow-sm">
          <BsOpenai className="size-3.5" />
        </span>
      ),
    },
  ];

  // ONLY display harnesses that are installed/detected OR have recorded sessions
  const installedHarnesses = allHarnesses.filter((h) => h.isDetected || h.hasApp || h.sessions.length > 0);

  return (
    <div className="space-y-3">
      {/* Header status bar */}
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <Sparkles className="size-3.5 text-primary" />
          <span>Active & Installed Harnesses</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            ({installedHarnesses.length} detected · {sessions.length} total {sessions.length === 1 ? 'session' : 'sessions'})
          </span>
        </div>

        {sessionsLoading && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Refreshing…
          </span>
        )}
      </div>

      {/* If no harnesses are detected at all */}
      {installedHarnesses.length === 0 ? (
        <Empty className="rounded-xl border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Terminal />
            </EmptyMedia>
            <EmptyTitle>No AI Coding Harnesses Detected</EmptyTitle>
            <EmptyDescription>
              Install <code>agy</code> (Google Antigravity), <code>claude</code> (Claude Code), or <code>codex</code> (OpenAI Codex) to start and resume interactive AI pair programming sessions.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2.5">
          {installedHarnesses.map((harness) => {
            const isExpanded = expandedHarnesses[harness.id] ?? true;
            return (
              <Card key={harness.id} className="overflow-hidden border border-border/80 bg-card transition-colors">
                {/* Minimal Harness Bar */}
                <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between bg-card/70">
                  <div
                    onClick={() => toggleHarness(harness.id)}
                    className="flex flex-1 items-center gap-2.5 cursor-pointer select-none"
                  >
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-transform"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </button>

                    {harness.icon}

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-xs text-foreground">{harness.name}</span>

                      {harness.isDetected && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          CLI: {harness.cliCommand}
                        </span>
                      )}

                      {harness.hasApp && (
                        <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                          {harness.appName}
                        </span>
                      )}

                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {harness.sessions.length} {harness.sessions.length === 1 ? 'session' : 'sessions'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 pl-6 sm:pl-0">
                    <Button
                      size="sm"
                      variant="default"
                      disabled={launchingNewAssistant === harness.id || !harness.isDetected}
                      onClick={() => void startNewSession(harness.id)}
                      title={`Launch new ${harness.cliCommand} session in terminal`}
                    >
                      {launchingNewAssistant === harness.id ? (
                        <Spinner className="size-3" />
                      ) : (
                        <Plus size={12} />
                      )}
                      <span>New {harness.cliCommand} Session</span>
                    </Button>

                    {harness.hasApp && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openAppTarget(harness.appTargetId)}
                        title={`Open in ${harness.appName}`}
                      >
                        <ExternalLink size={12} />
                        <span>{harness.appName}</span>
                      </Button>
                    )}
                  </div>
                </div>

                {/* Expanded Session Cards */}
                {isExpanded && (
                  <div className="border-t border-border/60 bg-muted/20 p-2.5 sm:p-3">
                    {harness.sessions.length === 0 ? (
                      <div className="py-3 text-center text-xs text-muted-foreground">
                        No previous sessions for {harness.name} in this workspace.{' '}
                        <button
                          onClick={() => void startNewSession(harness.id)}
                          className="text-primary underline hover:text-primary/80 cursor-pointer ml-1"
                        >
                          Start one now
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {harness.sessions.map((sess) => (
                          <div
                            key={sess.id}
                            className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card p-2.5 transition-colors hover:border-foreground/20 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] text-muted-foreground font-mono">
                                  {sess.id.slice(0, 8)}
                                </span>
                                <span className="text-[10px] text-muted-foreground">•</span>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(sess.updatedAt).toLocaleDateString()} {new Date(sess.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="text-[10px] text-muted-foreground">•</span>
                                <span className="text-[10px] font-medium text-muted-foreground">
                                  {sess.messageCount} {sess.messageCount === 1 ? 'msg' : 'msgs'}
                                </span>
                              </div>
                              <p className="text-xs font-medium text-foreground truncate" title={sess.title}>
                                {sess.title}
                              </p>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setActiveSession(sess);
                                  setTranscript([]);
                                  fetchSessionTranscript(sess.assistant, sess.id);
                                }}
                                title="Inspect chat history (opens at latest message)"
                              >
                                <MessageSquare size={12} />
                                <span>Chat</span>
                              </Button>

                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={resumingTerminalId === sess.id}
                                onClick={() => void resumeInTerminal(sess.assistant, sess.id)}
                                title={`Resume session in terminal (${sess.id})`}
                              >
                                {resumingTerminalId === sess.id ? <Spinner className="size-3" /> : <Terminal size={12} />}
                                <span>Resume</span>
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void copyResumeCommand(sess.assistant, sess.id)}
                                title="Copy resume CLI command"
                              >
                                {copiedId === sess.id ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                                <span>{copiedId === sess.id ? 'Copied' : 'Copy'}</span>
                              </Button>

                              {sess.assistant === 'codex' && hasCodexDesktop && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={openingDesktopId === sess.id}
                                  onClick={() => void openCodexDesktop(sess.id)}
                                  title="Open in Codex Desktop"
                                >
                                  {openingDesktopId === sess.id ? <Spinner className="size-3" /> : <ExternalLink size={12} />}
                                  <span>Desktop</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
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
