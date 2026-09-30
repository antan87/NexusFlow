import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { apiFetch } from '../../lib/api/client.js';
import type { WorkGuidance } from '../../types.js';
export function WorkspaceContextPeek({ workspace, active }: { workspace: string; active: boolean }) {
  const [assignment, setAssignment] = useState<WorkGuidance['assignment'] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setError('');
    void apiFetch<{ guidance: WorkGuidance }>(`/api/workspace/${encodeURIComponent(workspace)}/work`, { signal: controller.signal })
      .then(result => setAssignment(result.guidance.assignment))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load the work brief.'); });
    return () => controller.abort();
  }, [workspace, active, revision]);

  if (!assignment && !error) return null;
  // One line by default. The objective used to sit in a full-width bordered bar
  // of its own; the three labelled fields now appear only when it is opened.
  return <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-2.5 py-1 text-[11px]">
    <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-primary"
      title={assignment?.objective}>
      {assignment
        ? <><span className="font-semibold capitalize text-foreground">{assignment.stage}</span><span aria-hidden="true"> · </span><span>{assignment.objective || 'No current objective set'}</span></>
        : <span className="text-warning">Work brief unavailable</span>}
    </button>
    {expanded && <div className="w-full shrink-0 space-y-0.5 border-t border-border/60 pt-1 text-muted-foreground">
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {assignment && <><p><strong>Objective:</strong> {assignment.objective || 'Not set'}</p><p><strong>Expected output:</strong> {assignment.expectedOutput || 'Not set'}</p><p><strong>Stop when:</strong> {assignment.stopCondition || 'Not set'}</p></>}
    </div>}
    <Button size="xs" variant="ghost" aria-label="Refresh work brief" onClick={() => setRevision(value => value + 1)} className="shrink-0"><RefreshCw className="size-3" /></Button>
  </div>;
}
