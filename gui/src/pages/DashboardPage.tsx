import type { ReactNode } from 'react';
import { FolderGit2, GitBranch, Play, AlertTriangle, Plus, ArrowRight, RefreshCw } from 'lucide-react';
import type { Feature, WorkspaceStatus } from '../types.js';
import { Button, Card, EmptyState, PageHeader, Skeleton, StatusPill } from '../components/ui/index.js';
import { syncMeta } from '../lib/status.js';

interface DashboardPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading: boolean;
  statusesLoading: boolean;
  onOpenWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
}

function StatTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <div className="font-display text-xl font-bold leading-none text-content">{value}</div>
        <div className="mt-1 text-xs text-content-muted">{label}</div>
      </div>
    </Card>
  );
}

export function DashboardPage({
  workspaces,
  workspaceStatuses,
  workspacesLoading,
  statusesLoading,
  onOpenWorkspace,
  onNewWorkspace,
}: DashboardPageProps) {
  const statuses = Object.values(workspaceStatuses);
  const withChanges = statuses.filter((s) => s.changedFiles > 0).length;
  const running = statuses.reduce((n, s) => n + s.runningServices, 0);
  const needsValidation = statuses.filter((s) => s.pendingValidation).length;

  return (
    <div className="mx-auto max-w-6xl animate-fade-in">
      <PageHeader
        title="Overview"
        subtitle="Your multi-repo environment at a glance."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<FolderGit2 size={18} className="text-primary" />} tone="bg-primary-soft" label="Workspaces" value={workspaces.length} />
        <StatTile icon={<GitBranch size={18} className="text-warning" />} tone="bg-warning/10" label="With uncommitted changes" value={withChanges} />
        <StatTile icon={<Play size={18} className="text-running" />} tone="bg-running/10" label="Running services" value={running} />
        <StatTile icon={<AlertTriangle size={18} className="text-warning" />} tone="bg-warning/10" label="Need validation" value={needsValidation} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-content-muted">Workspaces</h2>
      </div>

      {workspacesLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : workspaces.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderGit2 size={40} />}
            title="No workspaces yet"
            description="Create a feature workspace to group repositories and give your AI assistants shared context."
            action={<Button variant="primary" icon={<Plus size={16} />} onClick={onNewWorkspace}>New workspace</Button>}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => {
            const st = workspaceStatuses[ws.branchName];
            const sync = st ? syncMeta(st.syncStatus) : null;
            return (
              <Card
                key={ws.id}
                className="group flex cursor-pointer items-center gap-4 p-4 transition-colors hover:border-hairline-strong hover:bg-raised"
                onClick={() => onOpenWorkspace(ws.branchName)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold text-content">{ws.branchName}</span>
                    <span className="shrink-0 text-xs text-content-faint">{ws.repos.length} repos</span>
                  </div>
                  {ws.description && <p className="mt-0.5 truncate text-xs text-content-muted">{ws.description}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!st && statusesLoading ? (
                    <Skeleton className="h-5 w-40" />
                  ) : st ? (
                    <>
                      {st.changedFiles > 0 ? (
                        <StatusPill tone="warning" dot>
                          {st.changedFiles} changed
                        </StatusPill>
                      ) : (
                        <StatusPill tone="idle" dot>
                          Clean
                        </StatusPill>
                      )}
                      {st.runningServices > 0 && (
                        <StatusPill tone="running" dot>
                          {st.runningServices} running
                        </StatusPill>
                      )}
                      {sync && (
                        <StatusPill tone={sync.tone}>
                          <RefreshCw size={11} /> {sync.label}
                        </StatusPill>
                      )}
                    </>
                  ) : null}
                  <ArrowRight size={16} className="text-content-faint transition-transform group-hover:translate-x-0.5 group-hover:text-content" />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
