import { cn } from './cn.js';

export type RepoState = 'clean' | 'changes' | 'conflict' | 'unknown';

const STATE_DOT: Record<RepoState, string> = {
  clean: 'bg-success',
  changes: 'bg-warning',
  conflict: 'bg-danger',
  unknown: 'bg-idle',
};

export interface RepoDot {
  name: string;
  state?: RepoState;
}

/** Signature element: a row of per-repo status dots, reused across dashboard, list and detail. */
export function RepoStatusStrip({ repos, className }: { repos: RepoDot[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {repos.map((r) => (
        <span
          key={r.name}
          title={`${r.name}${r.state ? ` · ${r.state}` : ''}`}
          className="inline-flex items-center gap-1.5 rounded border border-hairline bg-base px-2 py-0.5 font-mono text-[11px] font-medium text-content-muted"
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', STATE_DOT[r.state ?? 'unknown'])} />
          {r.name}
        </span>
      ))}
    </div>
  );
}
