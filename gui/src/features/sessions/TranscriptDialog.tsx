import { useRef, useState } from 'react';
import { Copy, ExternalLink, Play } from 'lucide-react';
import { ChatMarkdown } from '../../components/ChatMarkdown.js';
import { Button } from '../../components/ui/button.js';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Spinner } from '../../components/ui/spinner.js';
import { StatusBadge } from '../../components/ui/status-badge.js';
import { findWorkspaceForSession } from '../../lib/status.js';
import { useWorkspaceLaunchTargets } from '../../lib/api/queries.js';
import type { Feature } from '../../types.js';
import { providerForAssistant } from '../chat/chatLaunch.js';

interface TranscriptDialogProps {
  activeSession: any;
  transcript: any[];
  transcriptLoading: boolean;
  setActiveSession: (session: any | null) => void;
  workspaces: Feature[];
  handleResumeSession: (ws: Feature, sessionId?: string, assistant?: string) => Promise<void>;
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

export function TranscriptDialog({
  activeSession,
  transcript,
  transcriptLoading,
  setActiveSession,
  workspaces,
  handleResumeSession,
  handleOpenDesktopSession,
  showToast,
}: TranscriptDialogProps) {
  const launchTargets = useWorkspaceLaunchTargets();
  const codexDesktop = launchTargets.data?.find((target) => target.id === 'codex-desktop');
  const codexDesktopAvailable = codexDesktop?.available === true;
  const codexDesktopReason = launchTargets.isLoading
    ? 'Checking whether Codex Desktop is available…'
    : launchTargets.isError
      ? 'Could not check whether Codex Desktop is available.'
      : codexDesktop?.unavailableReason ?? 'Codex Desktop is not available on this computer.';
  const openingDesktopRef = useRef(false);
  const [openingDesktop, setOpeningDesktop] = useState(false);

  const openCodexDesktop = async () => {
    if (!codexDesktopAvailable || openingDesktopRef.current) return;
    const ws = findWorkspaceForSession(workspaces, activeSession.workspacePath);
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
                    ? 'rounded-tr-none border-primary/20 bg-primary text-primary-foreground'
                    : 'rounded-tl-none border-border bg-muted/40 text-foreground'
                }`}>
                  <ChatMarkdown content={msg.content} />
                </div>
              </div>
            ))
          )}
        </DialogPanel>
 
        {/* Modal Footer */}
        <DialogFooter className="sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {providerForAssistant(activeSession.assistant)
              ? 'This session can resume directly in NexusFlow chat.'
              : 'This provider remains available as a view-only transcript.'}
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
                showToast(`Copied run command to clipboard:\n\n${cmd}`, 'success');
              }}
            >
              <Copy size={13} /> Copy Resume Command
            </Button>
            {providerForAssistant(activeSession.assistant) && (
              <Button
                size="sm"
                onClick={() => {
                  // Never fall back to an arbitrary workspace — resuming a
                  // session against the wrong cwd silently loses its context.
                  const ws = findWorkspaceForSession(workspaces, activeSession.workspacePath);
                  if (!ws) {
                    showToast('Could not match this session to a workspace — it may have been removed.', 'error');
                    return;
                  }
                  handleResumeSession(ws, activeSession.id, activeSession.assistant);
                  setActiveSession(null);
                }}
              >
                <Play size={12} /> Resume in NexusFlow
              </Button>
            )}
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
