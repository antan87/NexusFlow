import type { ReactNode } from 'react';
import { FolderGit2, GitBranch, Play, AlertTriangle, Plus, ArrowRight, RefreshCw } from 'lucide-react';
import type { Feature, WorkspaceStatus } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { StatusBadge } from '../components/ui/status-badge.js';
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
    <Card className="flex-row items-center gap-3.5 p-4">
      <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${tone}`}>{icon}</div>
      <div className="min-w-0">
        <div className="text-xl font-bold leading-none text-foreground">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{label}</div>
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
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your multi-repo environment at a glance.</p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<FolderGit2 size={18} className="text-primary" />} tone="bg-primary/10" label="Workspaces" value={workspaces.length} />
        <StatTile icon={<GitBranch size={18} className="text-warning" />} tone="bg-warning/10" label="With uncommitted changes" value={withChanges} />
        <StatTile icon={<Play size={18} className="text-running" />} tone="bg-running/10" label="Running services" value={running} />
        <StatTile icon={<AlertTriangle size={18} className="text-warning" />} tone="bg-warning/10" label="Need validation" value={needsValidation} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Workspaces</h2>
      </div>

      {workspacesLoading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : workspaces.length === 0 ? (
        <Card className="border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderGit2 />
              </EmptyMedia>
              <EmptyTitle>No workspaces yet</EmptyTitle>
              <EmptyDescription>
                Create a feature workspace to group repositories and give your AI assistants shared context.
              </EmptyDescription>
            </EmptyHeader>
            <Button onClick={onNewWorkspace}>
              <Plus size={16} /> New workspace
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {workspaces.map((ws) => {
            const st = workspaceStatuses[ws.branchName];
            const sync = st ? syncMeta(st.syncStatus) : null;
            return (
              <Card
                key={ws.id}
                className="group cursor-pointer flex-row items-center gap-4 p-4 transition-colors hover:border-foreground/15 hover:bg-accent/50"
                onClick={() => onOpenWorkspace(ws.branchName)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm font-semibold text-foreground">{ws.branchName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ws.repos.length} repos</span>
                  </div>
                  {ws.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{ws.description}</p>}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {!st && statusesLoading ? (
                    <Skeleton className="h-5 w-40" />
                  ) : st ? (
                    <>
                      {st.changedFiles > 0 ? (
                        <StatusBadge tone="warning" dot>
                          {st.changedFiles} changed
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="idle" dot>
                          Clean
                        </StatusBadge>
                      )}
                      {st.runningServices > 0 && (
                        <StatusBadge tone="running" dot>
                          {st.runningServices} running
                        </StatusBadge>
                      )}
                      {sync && (
                        <StatusBadge tone={sync.tone}>
                          <RefreshCw size={11} /> {sync.label}
                        </StatusBadge>
                      )}
                    </>
                  ) : null}
                  <ArrowRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
