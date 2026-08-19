import { useRef, useState, useEffect } from 'react';
import { Copy, ExternalLink, Terminal } from 'lucide-react';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { findWorkspaceForSession } from '../../lib/status.js';
import { useWorkspaceLaunchTargets, useLaunchTerminal } from '../../lib/api/queries.js';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import type { AISession, Feature, TranscriptMessage } from '../../types.js';

interface TranscriptDialogProps {
  activeSession: AISession;
  transcript: TranscriptMessage[];
  transcriptLoading: boolean;
  setActiveSession: (session: AISession | null) => void;
  workspaces: Feature[];
  workspace?: Feature;
  handleOpenDesktopSession: (ws: Feature, sessionId: string, assistant: string) => Promise<boolean>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
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

const getResumeCommand = (assistant: string, sessionId: string): string => {
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

export function TranscriptDialog({
  activeSession,
  transcript,
  transcriptLoading,
  setActiveSession,
  workspaces,
  workspace,
  handleOpenDesktopSession,
  showToast,
}: TranscriptDialogProps) {
  const launchTargets = useWorkspaceLaunchTargets();
  const launchTerminalMutation = useLaunchTerminal();
  const codexDesktop = launchTargets.data?.find((target) => target.id === 'codex-desktop');
  const codexDesktopAvailable = codexDesktop?.available === true;
  const codexDesktopReason = launchTargets.isLoading
    ? 'Checking whether Codex Desktop is available…'
    : launchTargets.isError
      ? 'Could not check whether Codex Desktop is available.'
      : codexDesktop?.unavailableReason ?? 'Codex Desktop is not available on this computer.';
  const openingDesktopRef = useRef(false);
  const resumingTerminalRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [openingDesktop, setOpeningDesktop] = useState(false);
  const [resumingTerminal, setResumingTerminal] = useState(false);

  // Auto-scroll to the bottom (last message) when transcript finishes loading
  useEffect(() => {
    if (!transcriptLoading && transcript.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [transcriptLoading, transcript]);

  const resolveTargetWorkspace = () => {
    return workspace ?? findWorkspaceForSession(workspaces, activeSession.workspacePath);
  };

  const openCodexDesktop = async () => {
    if (!codexDesktopAvailable || openingDesktopRef.current) return;
    const ws = resolveTargetWorkspace();
    if (!ws) {
      showToast('Could not match this session to a workspace — it may have been removed.', 'error');
      return;
    }

    openingDesktopRef.current = true;
    setOpeningDesktop(true);
    try {
      if (await handleOpenDesktopSession(ws, activeSession.id, activeSession.assistant)) {
        setActiveSession(null);
      }
    } finally {
      openingDesktopRef.current = false;
      setOpeningDesktop(false);
    }
  };

  const resumeInTerminal = async () => {
    if (resumingTerminalRef.current) return;
    const ws = resolveTargetWorkspace();
    if (!ws) {
      showToast('Could not match this session to a workspace.', 'error');
      return;
    }
    resumingTerminalRef.current = true;
    setResumingTerminal(true);
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: ws.branchName,
        assistant: activeSession.assistant,
        sessionId: activeSession.id,
      });
      showToast(`Launched interactive terminal for ${assistantLabel(activeSession.assistant)}.`, 'success');
      setActiveSession(null);
    } catch {
      const cmd = getResumeCommand(activeSession.assistant, activeSession.id);
      const copied = await safeCopyToClipboard(cmd);
      if (copied) {
        showToast(`Could not open terminal automatically. Copied command to clipboard:\n\n${cmd}`, 'info');
      } else {
        showToast(`Could not open terminal automatically. Run manually:\n\n${cmd}`, 'error');
      }
    } finally {
      setResumingTerminal(false);
      resumingTerminalRef.current = false;
    }
  };

  return (
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
            <DialogDescription className="sr-only">
              Interactive transcript log and resume options for session {activeSession.id}
            </DialogDescription>
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
                <div className={`max-w-[85%] rounded-xl border px-4 py-3 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-tr-none border-primary/30 bg-primary/10 text-foreground dark:border-primary/40 dark:bg-primary/20'
                    : 'rounded-tl-none border-border bg-card text-foreground shadow-xs dark:bg-muted/30'
                }`}>
                  <ChatMarkdown content={msg.content} />
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </DialogPanel>

        {/* Modal Footer */}
        <DialogFooter className="sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            Historical transcript inspection. Resume directly in your preferred environment.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const cmd = getResumeCommand(activeSession.assistant, activeSession.id);
                await safeCopyToClipboard(cmd);
                showToast(`Copied run command to clipboard:\n\n${cmd}`, 'success');
              }}
            >
              <Copy size={13} /> Copy Resume Command
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={resumingTerminal}
              onClick={() => void resumeInTerminal()}
            >
              {resumingTerminal ? <Spinner className="size-3" /> : <Terminal size={12} />}
              Resume in Terminal
            </Button>
            {activeSession.assistant === 'codex' && (
              <Button
                variant="outline"
                size="sm"
                disabled={!codexDesktopAvailable || openingDesktop}
                title={codexDesktopAvailable ? 'Open this exact thread in Codex Desktop' : codexDesktopReason}
                aria-label={codexDesktopAvailable
                  ? 'Open in Codex Desktop'
                  : `Codex Desktop unavailable: ${codexDesktopReason}`}
                onClick={() => void openCodexDesktop()}
              >
                {openingDesktop ? <Spinner className="size-3" /> : <ExternalLink size={12} />}
                {openingDesktop ? 'Opening…' : 'Open in Codex Desktop'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
