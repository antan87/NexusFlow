import { useState, useEffect } from 'react';
import { History, MessageSquare } from 'lucide-react';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../components/ui/empty.js';
import { Skeleton } from '../../components/ui/skeleton.js';
import type { Feature } from '../../types.js';
import { API_BASE } from '../../lib/apiBase.js';

export interface PickableSession {
  id: string;
  assistant: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface SessionPickerProps {
  open: boolean;
  onClose: () => void;
  ws: Feature;
  onPick: (session: PickableSession) => void;
  /** Set by the parent when loading a picked session's transcript fails. */
  error?: string | null;
}

export function SessionPicker({ open, onClose, ws, onPick, error }: SessionPickerProps) {
  const [sessions, setSessions] = useState<PickableSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFetchError(null);
    fetch(`${API_BASE}/api/workspace/${encodeURIComponent(ws.branchName)}/sessions`)
      .then(res => res.json())
      .then(data => {
        // Only claude sessions can be resumed by id in the chat.
        const claudeSessions = (data.sessions || []).filter((s: PickableSession) => s.assistant === 'claude');
        setSessions(claudeSessions);
      })
      .catch(() => setFetchError('Failed to load sessions.'))
      .finally(() => setLoading(false));
  }, [open, ws.branchName]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resume a past session</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex max-h-[60vh] flex-col gap-2">
        {(error || fetchError) && (
          <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
            {error || fetchError}
          </div>
        )}
        {loading ? (
          <>
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </>
        ) : sessions.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History />
              </EmptyMedia>
              <EmptyTitle>No Claude sessions found</EmptyTitle>
              <EmptyDescription>Past Claude Code conversations for this workspace will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="cursor-pointer rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/15 hover:bg-accent/50"
            >
              <div className="truncate text-sm font-medium text-foreground" title={s.title}>{s.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{new Date(s.updatedAt).toLocaleString()}</span>
                <span>·</span>
                <MessageSquare size={11} />
                <span>{s.messageCount} messages</span>
              </div>
            </button>
          ))
        )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
