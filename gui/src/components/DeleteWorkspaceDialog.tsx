import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Input } from './ui/input.js';

interface DeleteWorkspaceDialogProps {
  workspaceName: string | null;
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
  /** Offer archive, which keeps the record, instead of deleting it. */
  onArchiveInstead?: (name: string) => void;
  /** Whether the workspace is already archived (then there is nothing to archive instead). */
  archived?: boolean;
  loading?: boolean;
}

export function DeleteWorkspaceDialog({
  workspaceName,
  open,
  onClose,
  onConfirm,
  onArchiveInstead,
  archived = false,
  loading = false,
}: DeleteWorkspaceDialogProps) {
  const [typedName, setTypedName] = useState('');

  if (!workspaceName) return null;

  const isConfirmed = typedName.trim() === workspaceName.trim();

  const handleClose = () => {
    setTypedName('');
    onClose();
  };

  const handleConfirm = async () => {
    if (!isConfirmed || loading) return;
    await onConfirm(workspaceName);
    setTypedName('');
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-destructive">Delete workspace</DialogTitle>
          <DialogDescription>
            This action cannot be undone. This will force-remove all git worktrees, including uncommitted changes, and delete the entire folder for{' '}
            <strong className="font-semibold text-foreground">{workspaceName}</strong>: its milestones, verification results, planning notes, knowledge and documents.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {onArchiveInstead && !archived && (
            <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs">
              <p className="text-foreground">To keep the record and only give back the worktrees, archive the workspace instead.</p>
              <Button
                variant="outline"
                size="xs"
                className="mt-2"
                onClick={() => { const name = workspaceName; handleClose(); onArchiveInstead(name); }}
                disabled={loading}
              >
                Archive instead
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Source repositories outside this workspace remain. Global ContextSpace chat and approvals, assistant-owned histories, and shared Workroom copies are separate. <Link className="underline" to="/settings#data-and-privacy" onClick={handleClose}>Review data and deletion boundaries</Link>.</p>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              Please type <strong className="font-mono text-foreground">{workspaceName}</strong> to confirm:
            </span>
            <Input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={workspaceName}
              autoFocus
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isConfirmed && !loading) {
                  void handleConfirm();
                }
              }}
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleConfirm()}
            disabled={!isConfirmed || loading}
          >
            {loading ? 'Deleting…' : 'Delete workspace'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
