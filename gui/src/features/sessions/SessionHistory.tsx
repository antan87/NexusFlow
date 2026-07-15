import React from 'react';
import { MessageSquareCode, MessageSquare, Play, Copy } from 'lucide-react';
import type { Feature } from '../../types.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';

interface SessionHistoryProps {
  ws: Feature;
  sessions: any[];
  sessionsLoading: boolean;
  activeSession: any | null;
  transcript: any[];
  transcriptLoading: boolean;
  workspaces: Feature[];
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

export const SessionHistory: React.FC<SessionHistoryProps> = ({
  ws,
  sessions,
  sessionsLoading,
  activeSession,
  transcript,
  transcriptLoading,
  workspaces,
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

      {/* Transcript Modal Overlay */}
      {activeSession && (
        <Dialog open onOpenChange={(open) => !open && setActiveSession(null)}>
          <DialogPopup className="h-[80vh] max-w-4xl">
            <DialogHeader>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <StatusBadge tone={assistantTone(activeSession.assistant)}>
                    {assistantLabel(activeSession.assistant)}
                  </StatusBadge>
                  <span className="text-[10px] text-muted-foreground">Session: {activeSession.id}</span>
                </div>
                <DialogTitle className="max-w-xl truncate text-sm" title={activeSession.title}>
                  {activeSession.title}
                </DialogTitle>
              </div>
            </DialogHeader>
 
            {/* Modal Body / Chat Messages */}
            <DialogPanel className="space-y-4">
              {transcriptLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <Spinner className="size-6 text-primary" />
                  <span className="text-xs font-medium text-muted-foreground">Loading conversation history...</span>
                </div>
              ) : transcript.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  No messages found in this transcript.
                </div>
              ) : (
                transcript.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className="mb-1 px-1 text-[10px] text-muted-foreground">
                      {msg.role === 'user' ? 'Developer' : activeSession.assistant === 'antigravity' ? 'Antigravity' : activeSession.assistant === 'claude' ? 'Claude' : activeSession.assistant === 'codex' ? 'Codex' : 'Copilot'}
                      {msg.timestamp && ` • ${new Date(msg.timestamp).toLocaleTimeString()}`}
                    </div>
                    <div className={`max-w-[85%] whitespace-pre-wrap rounded-xl border px-4 py-3 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'rounded-tr-none border-primary/20 bg-primary text-primary-foreground'
                        : 'rounded-tl-none border-border bg-muted/40 text-foreground'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))
              )}
            </DialogPanel>
 
            {/* Modal Footer */}
            <DialogFooter className="sm:justify-between">
              <span className="text-[11px] text-muted-foreground">
                Resuming will copy the shell command and open your code editor.
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const cmd = activeSession.assistant === 'antigravity' ? `agy --conversation ${activeSession.id}` :
                                activeSession.assistant === 'claude' ? `claude --resume ${activeSession.id}` :
                                activeSession.assistant === 'codex' ? `codex resume ${activeSession.id}` :
                                `copilot --resume ${activeSession.id}`;
                    navigator.clipboard.writeText(cmd);
                    alert(`Copied run command to clipboard:\n\n${cmd}`);
                  }}
                >
                  <Copy size={13} /> Copy Resume Command
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    const matchedWs = workspaces.find(w => w.branchName === activeSession.workspacePath.split(/[\\/]/).pop());
                    handleResumeSession(matchedWs || workspaces[0], activeSession.id, activeSession.assistant);
                    setActiveSession(null);
                  }}
                >
                  <Play size={12} /> Resume Conversation
                </Button>
              </div>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      )}
    </div>
  );
};
