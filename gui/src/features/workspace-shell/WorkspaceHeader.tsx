import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Circle, Copy, Loader2 } from 'lucide-react';
import { safeCopyToClipboard } from '../../lib/clipboard.js';
import { cn } from '../../lib/utils.js';
import type { LifecycleStep, WorkGuidance } from '../../types.js';
import type { VerificationGateTelemetry } from '../cockpit/cockpitStore.js';
import { nextMilestone, verificationText } from './workspaceStatus.js';

interface WorkspaceHeaderProps {
  workspaceId: string;
  title: string;
  /** Shown next to a custom name; omitted when the title already is the branch. */
  branchName?: string;
  brief?: string;
  mode: 'in-place' | 'worktree' | string;
  repoCount: number;
  changedFiles: number | null;
  stage?: WorkGuidance['assignment']['stage'];
  milestones: LifecycleStep[];
  verification: VerificationGateTelemetry;
  actions?: ReactNode;
}

const STAGE_LABELS: Record<WorkGuidance['assignment']['stage'], string> = {
  investigate: 'Investigate',
  design: 'Design',
  implement: 'Implement',
  verify: 'Verify',
  review: 'Review',
  release: 'Release',
};

function Fact({ label, children, to }: { label: string; children: ReactNode; to?: string }) {
  const body = <><span className="text-muted-foreground">{label}</span> <span className="font-medium text-foreground">{children}</span></>;
  return to
    ? <Link to={to} className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">{body}</Link>
    : <span className="inline-flex items-center gap-1">{body}</span>;
}

/**
 * One header per workspace: who it is, the brief, and where the task stands
 * (stage, next milestone, changes, verification). Each status fact links to
 * the destination where the user acts on it.
 */
export function WorkspaceHeader({ workspaceId, title, branchName, brief, mode, repoCount, changedFiles, stage, milestones, verification, actions }: WorkspaceHeaderProps) {
  const [copied, setCopied] = useState(false);
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const next = nextMilestone(milestones);
  const done = milestones.length > 0 && !next;

  return (
    <header className="border-b border-border bg-card/80 px-4 pt-3 pb-2 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="min-w-0 truncate text-lg font-semibold text-foreground" title={title}>{title}</h1>
            {branchName && <button
              type="button"
              onClick={async () => { if (await safeCopyToClipboard(branchName)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
              className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={copied ? 'Branch name copied' : `Copy branch name ${branchName}`}
            >
              {branchName}{copied ? <Check aria-hidden="true" size={12} /> : <Copy aria-hidden="true" size={12} />}
            </button>}
            <span className="text-xs text-muted-foreground">{mode === 'in-place' ? 'In place' : 'Worktree'} · {repoCount} {repoCount === 1 ? 'repository' : 'repositories'}</span>
          </div>
          {brief && <p className="mt-0.5 line-clamp-2 max-w-3xl text-sm text-muted-foreground">{brief}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>

      <div aria-label="Task status" role="group" className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {stage && <Fact label="Stage" to={`${base}/plan`}>{STAGE_LABELS[stage]}</Fact>}
        {next ? (
          <Fact label="Next" to={`${base}/plan`}>
            <span className="inline-flex max-w-[28ch] items-center gap-1 truncate sm:max-w-[40ch]" title={next.title}><ArrowRight aria-hidden="true" size={12} />{next.title}</span>
          </Fact>
        ) : done ? <Fact label="Milestones">All done</Fact> : null}
        <Fact label="Changes" to={`${base}/changes`}>
          {changedFiles === null ? 'Unknown' : changedFiles === 0 ? 'None' : `${changedFiles} ${changedFiles === 1 ? 'file' : 'files'}`}
        </Fact>
        <Link
          to={`${base}/plan`}
          className={cn(
            'inline-flex items-center gap-1 rounded px-1 -mx-1 font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
            verification.overallStatus === 'pass' ? 'text-success' : verification.overallStatus === 'fail' ? 'text-destructive' : 'text-muted-foreground',
          )}
          title={verification.summaryText}
        >
          {verification.overallStatus === 'pass' ? <CheckCircle2 aria-hidden="true" size={12} />
            : verification.overallStatus === 'fail' ? <AlertCircle aria-hidden="true" size={12} />
              : verification.overallStatus === 'running' ? <Loader2 aria-hidden="true" size={12} className="animate-spin" />
                : <Circle aria-hidden="true" size={12} />}
          {verificationText(verification)}
        </Link>
      </div>
    </header>
  );
}
