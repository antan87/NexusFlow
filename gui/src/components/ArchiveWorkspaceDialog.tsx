import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from './ui/dialog.js';
import { Button } from './ui/button.js';
import { Checkbox } from './ui/checkbox.js';
import { Spinner } from './ui/spinner.js';
import { ApiError, apiFetch } from '../lib/api/client.js';

/** Mirrors ArchiveReport in src/core/archive.ts (the fields this dialog shows). */
export interface ArchivePreview {
  workspaceId: string;
  alreadyArchived: boolean;
  ready: boolean;
  blockers: string[];
  repos: Array<{
    name: string;
    action: 'remove-worktree' | 'already-removed' | 'untouched' | 'blocked';
    reason: string;
    branchState: string;
    headSha: string | null;
  }>;
  kept: string[];
  notes: string[];
  errors: string[];
  archived: boolean;
}

interface ArchiveWorkspaceDialogProps {
  workspaceName: string | null;
  open: boolean;
  onClose: () => void;
  /** Called after a successful archive. */
  onArchived: (name: string) => Promise<void> | void;
}

const ACTION_LABEL: Record<ArchivePreview['repos'][number]['action'], string> = {
  'remove-worktree': 'Worktree removed',
  'already-removed': 'Worktree already removed',
  untouched: 'Untouched reference',
  blocked: 'Blocks archive',
};

function archiveRequest(name: string, body: { park: boolean; dryRun?: boolean }) {
  return apiFetch<ArchivePreview>(`/api/workspace/${encodeURIComponent(name)}/archive`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Archive keeps a workspace's record and returns its worktrees. The dialog
 * previews exactly what happens (a dry run) before anything is removed, and
 * explains every repository that blocks it.
 */
export function ArchiveWorkspaceDialog({ workspaceName, open, onClose, onArchived }: ArchiveWorkspaceDialogProps) {
  const [park, setPark] = useState(false);
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !workspaceName) return;
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    setArchiveError(null);
    archiveRequest(workspaceName, { park, dryRun: true })
      .then((result) => { if (!cancelled) setPreview(result); })
      .catch((error: unknown) => { if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setLoadingPreview(false); });
    return () => { cancelled = true; };
  }, [open, workspaceName, park]);

  if (!workspaceName) return null;

  const handleClose = () => {
    if (archiving) return;
    setPark(false);
    setPreview(null);
    setPreviewError(null);
    setArchiveError(null);
    onClose();
  };

  const handleArchive = async () => {
    setArchiving(true);
    setArchiveError(null);
    try {
      const result = await archiveRequest(workspaceName, { park });
      if (result.archived) {
        await onArchived(workspaceName);
        setPark(false);
        setPreview(null);
        onClose();
      } else {
        setPreview(result);
      }
    } catch (error) {
      if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'repos' in error.body) {
        setPreview(error.body as ArchivePreview);
      }
      setArchiveError(error instanceof Error ? error.message : String(error));
    } finally {
      setArchiving(false);
    }
  };

  // Parking is offered only when pushed-but-unmerged work is the sole obstacle.
  const blocked = preview?.repos.filter((repo) => repo.action === 'blocked') ?? [];
  const onlyUnmerged = blocked.length > 0 && blocked.every((repo) => repo.branchState === 'unmerged');
  const showPark = park || onlyUnmerged;
  const canArchive = Boolean(preview && preview.ready && !preview.alreadyArchived) && !loadingPreview && !archiving;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Archive workspace</DialogTitle>
          <DialogDescription>
            Archiving <strong className="font-semibold text-foreground">{workspaceName}</strong> removes its worktrees once
            their work is merged. Milestones, verification results, planning notes, knowledge and documents stay readable,
            branches are kept, and your own checkouts are not changed. You can restore it later.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 text-sm">
          {loadingPreview && (
            <p className="flex items-center gap-2 text-muted-foreground" role="status"><Spinner className="size-3.5" /> Checking each repository…</p>
          )}
          {previewError && !loadingPreview && (
            <p className="text-destructive-foreground" role="alert">Could not check the workspace: {previewError}</p>
          )}
          {preview && !loadingPreview && (
            <>
              {preview.alreadyArchived && <p className="text-muted-foreground">This workspace is already archived.</p>}
              <ul className="space-y-2" aria-label="Repositories">
                {preview.repos.map((repo) => (
                  <li key={repo.name} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{repo.name}</span>
                      <span className={repo.action === 'blocked' ? 'text-xs font-semibold text-destructive-foreground' : 'text-xs text-muted-foreground'}>
                        {ACTION_LABEL[repo.action]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{repo.reason}</p>
                  </li>
                ))}
              </ul>
              {preview.kept.length > 0 && (
                <p className="text-xs text-muted-foreground">Kept in the workspace folder: {preview.kept.join(', ')}</p>
              )}
              {preview.notes.map((note) => <p key={note} className="text-xs text-warning-foreground">{note}</p>)}
              {!preview.ready && !preview.alreadyArchived && (
                <p className="text-xs text-destructive-foreground" role="alert">Nothing will be removed until every blocking repository is resolved.</p>
              )}
            </>
          )}
          {showPark && (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox checked={park} onCheckedChange={(checked) => setPark(Boolean(checked))} aria-label="Archive pushed but unmerged work" />
              <span>Archive pushed but unmerged work anyway. Its branch is kept, so it can be picked up again.</span>
            </label>
          )}
          {archiveError && <p className="text-xs text-destructive-foreground" role="alert">{archiveError}</p>}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={archiving}>
            Cancel
          </Button>
          <Button onClick={() => void handleArchive()} disabled={!canArchive}>
            {archiving ? 'Archiving…' : 'Archive workspace'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
