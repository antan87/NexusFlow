import { useState, useEffect } from 'react';
import { History, MessageSquare } from 'lucide-react';
import { Modal, Skeleton, EmptyState } from '../../components/ui/index.js';
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
    <Modal open={open} onClose={onClose} title="Resume a past session">
      <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto p-4">
        {(error || fetchError) && (
          <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
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
          <EmptyState
            icon={<History size={32} className="text-content-faint" />}
            title="No Claude sessions found"
            description="Past Claude Code conversations for this workspace will show up here."
          />
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onPick(s)}
              className="rounded-lg border border-hairline bg-surface p-3 text-left transition-colors cursor-pointer hover:border-hairline-strong hover:bg-raised"
            >
              <div className="truncate text-sm font-medium text-content" title={s.title}>{s.title}</div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-content-faint">
                <span>{new Date(s.updatedAt).toLocaleString()}</span>
                <span>·</span>
                <MessageSquare size={11} />
                <span>{s.messageCount} messages</span>
              </div>
            </button>
          ))
        )}
      </div>
    </Modal>
  );
}
