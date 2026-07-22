import { useMemo, useState, type ComponentProps } from 'react';
import { RefreshCw, Play, MoreVertical, ExternalLink, Copy, Trash2, Search, FolderGit2 } from 'lucide-react';
import type { Feature, WorkspaceStatus, RepoInfo } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Input } from '../components/ui/input.js';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../components/ui/menu.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceServices } from '../lib/api/queries.js';
import { syncMeta, repoName } from '../lib/status.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { ServiceConsole } from '../features/services/ServiceConsole.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
import { AgentChat } from '../features/chat/AgentChat.js';

type SubTab = 'overview' | 'sessions' | 'services' | 'changes' | 'knowledge' | 'plan';

const TABS: Array<{ value: SubTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'changes', label: 'Changes' },
  { value: 'services', label: 'Services' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'plan', label: 'Plan' },
];

const FILTERS = ['all', 'changes', 'running'] as const;
type Filter = (typeof FILTERS)[number];

interface WorkspacesPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading: boolean;
  fetchWorkspaces: () => Promise<void>;
  selectedId: string | null;
  subTab: SubTab;
  onSelect: (id: string) => void;
  onSelectTab: (id: string, tab: SubTab) => void;
  resumingWs: string | null;
  handleResumeSession: (ws: Feature, sessionId?: string, assistant?: string) => Promise<void>;
  handleCopyPrompt: (ws: Feature) => void;
  handleOpenInEditor: (workspacePath: string) => Promise<void>;
  handleDeleteWorkspace: (wsName: string) => Promise<void>;
  deleteWsLoading: string | null;
  repos: RepoInfo[];
  addRepoLoading: boolean;
  handleAddRepo: (wsName: string, repoPath: string) => Promise<void>;
  sessionProps: Omit<ComponentProps<typeof SessionHistory>, 'ws'>;
  changesProps: Omit<ComponentProps<typeof ChangesViewer>, 'ws'>;
  knowledgeProps: Omit<ComponentProps<typeof KnowledgeBase>, 'ws'>;
  planProps: ComponentProps<typeof ImplementationPlan>;
}

export function WorkspacesPage(props: WorkspacesPageProps) {
  const {
    workspaces,
    workspaceStatuses,
    workspacesLoading,
    fetchWorkspaces,
    selectedId,
    subTab,
    onSelect,
    onSelectTab,
    resumingWs,
    handleResumeSession,
    handleCopyPrompt,
    handleOpenInEditor,
    handleDeleteWorkspace,
    deleteWsLoading,
    repos,
    addRepoLoading,
    handleAddRepo,
    sessionProps,
    changesProps,
    knowledgeProps,
    planProps,
  } = props;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const selected = workspaces.find((w) => w.branchName === selectedId) ?? null;
  const selectedMode = selected?.mode ?? 'worktree';

  // Detected services for the overview topology panel (shares the react-query
  // cache with the Services tab's ServiceConsole — one fetch, not two).
  const detectedServices = useWorkspaceServices(selected?.branchName ?? null).data?.services ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workspaces.filter((w) => {
      const st = workspaceStatuses[w.branchName];
      if (q && !`${w.branchName} ${w.description}`.toLowerCase().includes(q)) return false;
      if (filter === 'changes' && !(st && st.changedFiles > 0)) return false;
      if (filter === 'running' && !(st && st.runningServices > 0)) return false;
      return true;
    });
  }, [workspaces, workspaceStatuses, query, filter]);

  const repoRows = selected
    ? selected.repos.map((rp) => {
        const name = repoName(rp);
        const change = changesProps.gitChanges?.find((c: { repoName: string; files?: unknown[] }) => c.repoName === name);
        const changedCount: number | null = change ? change.files?.length ?? 0 : null;
        const svcs = detectedServices.filter((s) => (s.cwd ?? '').split(/[\\/]/).includes(name));
        const ports = Array.from(new Set(svcs.map((s) => s.port).filter((p): p is number => typeof p === 'number')));
        return { name, changedCount, ports, serviceCount: svcs.length };
      })
    : [];

  const availableRepos = selected ? repos.filter((r) => !selected.repos.includes(r.path)) : [];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Workspaces</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a workspace to inspect its changes, services, sessions and context.
          </p>
        </div>
        <Button variant="outline" onClick={fetchWorkspaces} disabled={workspacesLoading}>
          <RefreshCw size={14} className={workspacesLoading ? 'animate-spin text-primary' : ''} />
          Refresh
        </Button>
      </header>

      <div className="flex gap-4 h-[calc(100vh-120px)] overflow-x-auto overflow-y-hidden pb-4">
        {/* ── Left pane: Workspaces ─────────────────────────────────────────── */}
        <div className="w-60 shrink-0 flex flex-col overflow-y-auto pr-1">
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workspaces" className="[&_[data-slot=input]]:pl-8" />
          </div>
          <div className="mb-3 flex items-center gap-1 rounded-lg border border-border bg-muted p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors cursor-pointer text-center',
                  filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground hover:bg-accent',
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {workspacesLoading ? (
            <div className="flex flex-col gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">No workspaces match.</Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((w) => {
                const st = workspaceStatuses[w.branchName];
                const active = w.branchName === selectedId;
                const sync = w.mode === 'in-place' ? null : st ? syncMeta(st.syncStatus) : null;
                return (
                  <button
                    key={w.id}
                    onClick={() => onSelect(w.branchName)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors cursor-pointer',
                      active ? 'border-primary/50 bg-primary/10' : 'border-border bg-card hover:border-foreground/15 hover:bg-accent/50',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-semibold text-foreground">{w.branchName}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{w.repos.length} repos</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', st?.changedFiles ? 'bg-warning' : 'bg-success')}
                        title={st?.changedFiles ? `${st.changedFiles} uncommitted` : 'Clean'}
                      />
                      {st?.runningServices ? <span className="h-1.5 w-1.5 rounded-full bg-running" title="Running services" /> : null}
                      {sync && <span className="text-[11px] text-muted-foreground">{sync.label}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Center pane: Detail & Context ───────────────────────────────────────── */}
        <div className="flex-1 min-w-[360px] flex flex-col overflow-y-auto pr-4 pl-1">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-md w-full">
                <Card className="border-dashed p-0 shadow-sm">
                  <Empty>
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FolderGit2 />
                      </EmptyMedia>
                      <EmptyTitle>No workspace selected</EmptyTitle>
                      <EmptyDescription>
                        Pick a workspace from the list to see its status, repositories, changes, services and sessions.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </Card>
              </div>
            </div>
          ) : (
            <div>
              <Card className="mb-4 p-5">
                <div className="flex flex-row justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-xl font-bold text-foreground" title={selected.branchName}>
                        {selected.branchName}
                      </h2>
                      <StatusBadge tone={selectedMode}>
                        {selectedMode === 'in-place' ? 'In-place' : 'Worktree'}
                      </StatusBadge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                      <span>·</span>
                      <span>{selected.repos.length} repos</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      disabled={resumingWs === selected.branchName}
                      onClick={() => handleResumeSession(selected)}
                    >
                      <Play size={13} className={resumingWs === selected.branchName ? 'animate-spin' : ''} />
                      {resumingWs === selected.branchName ? 'Resuming…' : 'Resume in Editor'}
                    </Button>
                    <Menu>
                      <MenuTrigger
                        aria-label="More actions"
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <MoreVertical size={16} />
                      </MenuTrigger>
                      <MenuPopup align="end">
                        <MenuItem onClick={() => void handleOpenInEditor(selected.workspacePath)}>
                          <ExternalLink size={14} /> Open Folder
                        </MenuItem>
                        <MenuItem onClick={() => handleCopyPrompt(selected)}>
                          <Copy size={14} /> Copy AI Context
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          variant="destructive"
                          disabled={deleteWsLoading === selected.branchName}
                          onClick={() => void handleDeleteWorkspace(selected.branchName)}
                        >
                          <Trash2 size={14} />
                          {deleteWsLoading === selected.branchName ? 'Deleting…' : 'Delete Workspace'}
                        </MenuItem>
                      </MenuPopup>
                    </Menu>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(() => {
                    const st = workspaceStatuses[selected.branchName];
                    if (!st) return null;
                    const sync = selectedMode === 'in-place' ? null : syncMeta(st.syncStatus);
                    return (
                      <>
                        {st.changedFiles > 0 ? (
                          <StatusBadge tone="warning" dot>
                            {st.changedFiles} uncommitted
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="idle" dot>
                            Clean
                          </StatusBadge>
                        )}
                        {st.runningServices > 0 ? (
                          <StatusBadge tone="running" dot>
                            {st.runningServices} running
                          </StatusBadge>
                        ) : (
                          <StatusBadge tone="idle" dot>
                            No services
                          </StatusBadge>
                        )}
                        {sync && (
                          <StatusBadge tone={sync.tone}>
                            <RefreshCw size={11} /> {sync.label}
                          </StatusBadge>
                        )}
                        {st.pendingValidation && <StatusBadge tone="warning">Needs validation</StatusBadge>}
                      </>
                    );
                  })()}
                </div>
              </Card>

              <Tabs
                value={subTab}
                onValueChange={(v) => typeof v === 'string' && onSelectTab(selected.branchName, v as SubTab)}
                className="mb-4"
              >
                <TabsList className="max-w-full overflow-x-auto">
                  {TABS.map((tab) => (
                    <TabsTab key={tab.value} value={tab.value}>
                      {tab.label}
                    </TabsTab>
                  ))}
                </TabsList>
                <TabsPanel value={subTab} className="animate-fade-in">
                {subTab === 'overview' && (
                  <div className="flex flex-col gap-4">
                    <Card className="p-5">
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Description</h3>
                      {selected.description ? (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{selected.description}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">No description provided.</p>
                      )}
                    </Card>
                    <Card className="p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="text-sm font-semibold text-foreground">
                          Repositories <span className="text-muted-foreground">({selected.repos.length})</span>
                        </h3>
                        {availableRepos.length > 0 && (
                          <AddRepoPicker
                            repos={availableRepos}
                            disabled={addRepoLoading}
                            onAdd={(path) => {
                              if (
                                window.confirm(
                                  `Add repository "${repoName(path)}" to this workspace?\nThis creates a new git worktree and re-runs analysis.`,
                                )
                              ) {
                                void handleAddRepo(selected.branchName, path);
                              }
                            }}
                          />
                        )}
                      </div>
                      <div className="divide-y divide-border">
                        {repoRows.map((r) => (
                          <div key={r.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                            <span
                              className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                r.changedCount === null ? 'bg-muted-foreground' : r.changedCount > 0 ? 'bg-warning' : 'bg-success',
                              )}
                              title={r.changedCount === null ? 'Status unknown' : r.changedCount > 0 ? 'Uncommitted changes' : 'Clean'}
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">{r.name}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              {r.ports.map((p) => (
                                <span key={p} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-running-foreground">
                                  :{p}
                                </span>
                              ))}
                              <span className="w-24 text-right text-xs text-muted-foreground">
                                {r.changedCount === null ? '—' : r.changedCount > 0 ? `${r.changedCount} changed` : 'clean'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-muted-foreground">Per-repo git state and detected service ports.</p>
                    </Card>
                  </div>
                )}
                {subTab === 'sessions' && <SessionHistory ws={selected} {...sessionProps} />}
                {subTab === 'services' && <ServiceConsole ws={selected} />}
                {subTab === 'changes' && <ChangesViewer ws={selected} {...changesProps} />}
                {subTab === 'knowledge' && <KnowledgeBase ws={selected} {...knowledgeProps} />}
                {subTab === 'plan' && <ImplementationPlan {...planProps} />}
                </TabsPanel>
              </Tabs>
            </div>
          )}
        </div>

        {/* ── Right pane: Agent Chat ───────────────────────────────────────── */}
        <div className="w-[340px] 2xl:w-[400px] shrink-0 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center p-10 text-center text-sm text-muted-foreground">
              Select a workspace to start chatting.
            </div>
          ) : (
            <AgentChat key={selected.branchName} ws={selected} />
          )}
        </div>
      </div>
    </div>
  );
}
