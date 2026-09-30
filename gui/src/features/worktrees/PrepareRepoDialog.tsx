/**
 * "Prepare for editing": shows exactly where an editable copy of a reference
 * repository would be created (path, branch, base) and any conflict, before
 * anything is created. The user's own checkout is never changed.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button } from '../../components/ui/button.js';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '../../components/ui/dialog.js';
import { Spinner } from '../../components/ui/spinner.js';
import { invalidateDeliveryState } from '../../lib/api/queries.js';
import type { IsolationPlan } from '../../types.js';
import { planIsolation, prepareForEditing } from '../changes/deliveryApi.js';

interface Props {
  wsId: string;
  repoName: string | null;
  onClose: () => void;
}

export function PrepareRepoDialog({ wsId, repoName, onClose }: Props) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<IsolationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPlan(null);
    setError(null);
    if (!repoName) return;
    let current = true;
    void planIsolation(wsId, repoName).then((result) => {
      if (!current) return;
      if (result.ok) setPlan(result.data);
      else setError(result.error);
    });
    return () => { current = false; };
  }, [wsId, repoName]);

  const prepare = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    const result = await prepareForEditing(wsId, plan);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await invalidateDeliveryState(queryClient, wsId);
    onClose();
  };

  const blocked = !plan || plan.conflicts.length > 0 || plan.alreadyIsolated;
  return (
    <Dialog open={Boolean(repoName)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogPopup className="max-w-lg" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>Prepare {repoName} for editing</DialogTitle>
          <DialogDescription>
            Creates an editable copy on its own branch inside this workspace. Your checkout stays exactly as it is.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3 text-sm">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive-foreground">{error}</div>
          )}
          {!plan && !error && <div className="flex justify-center py-4"><Spinner className="size-5" /></div>}
          {plan && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs" data-testid="prepare-plan">
              <dt className="text-muted-foreground">Editable copy</dt><dd className="font-mono break-all">{plan.worktreePath}</dd>
              <dt className="text-muted-foreground">Branch</dt><dd className="font-mono">{plan.branchName}</dd>
              <dt className="text-muted-foreground">Based on</dt><dd className="font-mono">{plan.baseBranch}</dd>
              <dt className="text-muted-foreground">Your checkout</dt><dd className="font-mono break-all">{plan.sourcePath} (unchanged)</dd>
            </dl>
          )}
          {plan?.alreadyIsolated && <p role="status" className="text-xs">Already prepared for editing.</p>}
          {plan && plan.conflicts.length > 0 && (
            <ul role="alert" className="list-disc space-y-1 pl-4 text-xs text-destructive-foreground">
              {plan.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}
            </ul>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={() => void prepare()} disabled={busy || blocked}>
            {busy ? <Spinner className="size-3" /> : null}
            Prepare for editing
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
