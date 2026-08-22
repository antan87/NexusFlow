import { useState } from 'react';
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
  loading?: boolean;
}

export function DeleteWorkspaceDialog({
  workspaceName,
  open,
  onClose,
  onConfirm,
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
            This action cannot be undone. This will force-remove all git worktrees and delete the entire folder for{' '}
            <strong className="font-semibold text-foreground">{workspaceName}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
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
