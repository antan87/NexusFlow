import React from 'react';
import { MessageSquareCode, MessageSquare, Play } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';

interface SessionHistoryProps {
  ws: Feature;
  sessions: any[];
  sessionsLoading: boolean;
  setActiveSession: (val: any | null) => void;
  setTranscript: (val: any[]) => void;
  fetchSessionTranscript: (assistant: string, sessionId: string) => Promise<void>;
  handleResumeSession: (ws: Feature, sessionId?: string, assistant?: string) => Promise<void>;
}

const assistantLabel = (assistant: string) =>
  assistant === 'antigravity'
    ? 'Antigravity'
    : assistant === 'claude'
      ? 'Claude Code'
      : assistant === 'codex'
        ? 'OpenAI Codex'
        : 'GitHub Copilot';

const assistantTone = (assistant: string) =>
  assistant === 'claude' ? 'warning' : assistant === 'codex' ? 'success' : assistant === 'antigravity' ? 'accent' : 'info';

/**
 * Lists a workspace's recorded agent sessions. The transcript itself is shown
 * by the app-level TranscriptDialog (App.tsx), which opens whenever
 * setActiveSession is called — this component must not render its own dialog.
 */
export const SessionHistory: React.FC<SessionHistoryProps> = ({
  ws,
  sessions,
  sessionsLoading,
  setActiveSession,
  setTranscript,
  fetchSessionTranscript,
  handleResumeSession,
}) => {
  return (
    <div>
      {sessionsLoading ? (
        <div className="flex justify-center py-10">
          <Spinner className="size-5 text-primary" />
        </div>
      ) : sessions.length === 0 ? (
        <Empty className="rounded-xl border border-border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageSquareCode />
            </EmptyMedia>
            <EmptyTitle>No Past AI Sessions Found</EmptyTitle>
            <EmptyDescription>
              Start a conversation with your AI assistant (e.g. running <code>claude</code>, <code>agy</code>, <code>codex</code>, or <code>copilot</code> inside this directory) to track session history here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-3 mb-6">
          {sessions.map((sess) => (
            <div key={sess.id} className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-foreground/15 md:flex-row md:items-center">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <StatusBadge tone={assistantTone(sess.assistant)}>{assistantLabel(sess.assistant)}</StatusBadge>
                  <span className="text-[10px] text-muted-foreground">
                    Updated: {new Date(sess.updatedAt).toLocaleString()}
                  </span>
                  <span className="text-[10px] text-muted-foreground">•</span>
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {sess.messageCount} messages
                  </span>
                </div>
                <h4 className="truncate pr-4 text-xs font-semibold text-foreground" title={sess.title}>
                  {sess.title}
                </h4>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveSession(sess);
                    setTranscript([]);
                    fetchSessionTranscript(sess.assistant, sess.id);
                  }}
                >
                  <MessageSquare size={13} /> View Chat Log
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleResumeSession(ws, sess.id, sess.assistant)}
                >
                  <Play size={11} /> Resume
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
