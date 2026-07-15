import { useMemo, useState, type ComponentProps } from 'react';
import { RefreshCw, Play, MoreVertical, ExternalLink, Sparkles, Trash2, Search, FolderGit2 } from 'lucide-react';
import type { Feature, WorkspaceStatus, RepoInfo } from '../types.js';
import { Button, Card, EmptyState, Menu, PageHeader, StatusPill, Tabs, Input, Skeleton, cn } from '../components/legacy-ui/index.js';
import type { TabItem } from '../components/legacy-ui/index.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { syncMeta, repoName } from '../lib/status.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { ServiceConsole } from '../features/services/ServiceConsole.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
import { AgentChat } from '../features/chat/AgentChat.js';

type SubTab = 'overview' | 'sessions' | 'services' | 'changes' | 'knowledge' | 'plan';

const TABS: TabItem[] = [
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
  statusesLoading: boolean;
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
  serviceProps: Omit<ComponentProps<typeof ServiceConsole>, 'ws'>;
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
    serviceProps,
    changesProps,
    knowledgeProps,
    planProps,
  } = props;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const selected = workspaces.find((w) => w.branchName === selectedId) ?? null;

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
        const svcs = (serviceProps.services ?? []).filter((s) => (s.cwd ?? '').split(/[\\/]/).includes(name));
        const ports = Array.from(new Set(svcs.map((s) => s.port).filter((p): p is number => typeof p === 'number')));
        return { name, changedCount, ports, serviceCount: svcs.length };
      })
    : [];

  const availableRepos = selected ? repos.filter((r) => !selected.repos.includes(r.path)) : [];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <PageHeader
        title="Workspaces"
        subtitle="Select a workspace to inspect its changes, services, sessions and context."
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw size={14} className={workspacesLoading ? 'animate-spin text-primary' : ''} />}
            onClick={fetchWorkspaces}
            disabled={workspacesLoading}
          >
            Refresh
          </Button>
        }
      />

      <div className="flex gap-4 h-[calc(100vh-120px)] overflow-x-auto overflow-y-hidden pb-4">
        {/* ── Left pane: Workspaces ─────────────────────────────────────────── */}
        <div className="w-60 shrink-0 flex flex-col overflow-y-auto pr-1">
          <div className="relative mb-3">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-faint" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search workspaces" className="pl-8" />
          </div>
          <div className="mb-3 flex items-center gap-1 bg-surface border border-hairline p-1 rounded-lg">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex-1 rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors cursor-pointer text-center',
                  filter === f ? 'bg-primary text-white shadow-sm' : 'text-content-faint hover:text-content hover:bg-surface-elevated',
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
            <Card className="p-6 text-center text-sm text-content-muted">No workspaces match.</Card>
          ) : (
            <div className="flex flex-col gap-1.5">
              {filtered.map((w) => {
                const st = workspaceStatuses[w.branchName];
                const active = w.branchName === selectedId;
                const sync = st ? syncMeta(st.syncStatus) : null;
                return (
                  <button
                    key={w.id}
                    onClick={() => onSelect(w.branchName)}
                    className={cn(
                      'rounded-lg border p-3 text-left transition-colors cursor-pointer',
                      active ? 'border-primary/50 bg-primary-soft' : 'border-hairline bg-surface hover:border-hairline-strong hover:bg-raised',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm font-semibold text-content">{w.branchName}</span>
                      <span className="shrink-0 text-[11px] text-content-faint">{w.repos.length} repos</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span
                        className={cn('h-1.5 w-1.5 rounded-full', st?.changedFiles ? 'bg-warning' : 'bg-success')}
                        title={st?.changedFiles ? `${st.changedFiles} uncommitted` : 'Clean'}
                      />
                      {st?.runningServices ? <span className="h-1.5 w-1.5 rounded-full bg-running" title="Running services" /> : null}
                      {sync && <span className="text-[11px] text-content-faint">{sync.label}</span>}
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
                <Card className="border-dashed bg-surface/30 border-hairline-strong shadow-sm p-6 backdrop-blur-sm">
                  <EmptyState
                    icon={<FolderGit2 size={40} className="text-content-faint" />}
                    title="No workspace selected"
                    description="Pick a workspace from the list to see its status, repositories, changes, services and sessions."
                  />
                </Card>
              </div>
            </div>
          ) : (
            <div>
              <Card className="mb-4 p-5">
                <div className="flex flex-row justify-between items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-xl font-bold text-content truncate" title={selected.branchName}>{selected.branchName}</h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-content-faint flex-wrap">
                      <span>Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                      <span>·</span>
                      <span>{selected.repos.length} repos</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="primary"
                      icon={<Play size={13} className={resumingWs === selected.branchName ? 'animate-spin' : ''} />}
                      disabled={resumingWs === selected.branchName}
                      onClick={() => handleResumeSession(selected)}
                    >
                      {resumingWs === selected.branchName ? 'Resuming…' : 'Resume in Editor'}
                    </Button>
                    <Menu
                      label="More actions"
                      trigger={
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-hairline bg-surface text-content-muted hover:bg-raised hover:text-content">
                          <MoreVertical size={16} />
                        </span>
                      }
                      items={[
                        { label: 'Open Folder', icon: <ExternalLink size={14} />, onClick: () => void handleOpenInEditor(selected.workspacePath) },
                        { label: 'Copy AI Context', icon: <Sparkles size={14} className="text-primary" />, onClick: () => handleCopyPrompt(selected) },
                        {
                          label: deleteWsLoading === selected.branchName ? 'Deleting…' : 'Delete Workspace',
                          icon: <Trash2 size={14} />,
                          danger: true,
                          disabled: deleteWsLoading === selected.branchName,
                          onClick: () => void handleDeleteWorkspace(selected.branchName),
                        },
                      ]}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {(() => {
                    const st = workspaceStatuses[selected.branchName];
                    if (!st) return null;
                    const sync = syncMeta(st.syncStatus);
                    return (
                      <>
                        {st.changedFiles > 0 ? (
                          <StatusPill tone="warning" dot>
                            {st.changedFiles} uncommitted
                          </StatusPill>
                        ) : (
                          <StatusPill tone="idle" dot>
                            Clean
                          </StatusPill>
                        )}
                        {st.runningServices > 0 ? (
                          <StatusPill tone="running" dot>
                            {st.runningServices} running
                          </StatusPill>
                        ) : (
                          <StatusPill tone="idle" dot>
                            No services
                          </StatusPill>
                        )}
                        <StatusPill tone={sync.tone}>
                          <RefreshCw size={11} /> {sync.label}
                        </StatusPill>
                        {st.pendingValidation && <StatusPill tone="warning">Needs validation</StatusPill>}
                      </>
                    );
                  })()}
                </div>
              </Card>

              <Tabs items={TABS} value={subTab} onChange={(v) => onSelectTab(selected.branchName, v as SubTab)} className="mb-4" />

              <div className="animate-fade-in">
                {subTab === 'overview' && (
                  <div className="flex flex-col gap-4">
                    <Card className="p-5">
                      <h3 className="mb-2 font-display text-sm font-semibold text-content">Description</h3>
                      {selected.description ? (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-content-muted">{selected.description}</p>
                      ) : (
                        <p className="text-sm text-content-faint">No description provided.</p>
                      )}
                    </Card>
                    <Card className="p-5">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 className="font-display text-sm font-semibold text-content">
                          Repositories <span className="text-content-faint">({selected.repos.length})</span>
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
                      <div className="divide-y divide-hairline">
                        {repoRows.map((r) => (
                          <div key={r.name} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                            <span
                              className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                r.changedCount === null ? 'bg-idle' : r.changedCount > 0 ? 'bg-warning' : 'bg-success',
                              )}
                              title={r.changedCount === null ? 'Status unknown' : r.changedCount > 0 ? 'Uncommitted changes' : 'Clean'}
                            />
                            <span className="min-w-0 flex-1 truncate font-mono text-sm text-content">{r.name}</span>
                            <div className="flex shrink-0 items-center gap-2">
                              {r.ports.map((p) => (
                                <span key={p} className="rounded border border-hairline bg-base px-1.5 py-0.5 font-mono text-[11px] text-running">
                                  :{p}
                                </span>
                              ))}
                              <span className="w-24 text-right text-xs text-content-faint">
                                {r.changedCount === null ? '—' : r.changedCount > 0 ? `${r.changedCount} changed` : 'clean'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-[11px] text-content-faint">Per-repo git state and detected service ports.</p>
                    </Card>
                  </div>
                )}
                {subTab === 'sessions' && <SessionHistory ws={selected} {...sessionProps} />}
                {subTab === 'services' && <ServiceConsole ws={selected} {...serviceProps} />}
                {subTab === 'changes' && <ChangesViewer ws={selected} {...changesProps} />}
                {subTab === 'knowledge' && <KnowledgeBase ws={selected} {...knowledgeProps} />}
                {subTab === 'plan' && <ImplementationPlan {...planProps} />}
              </div>
            </div>
          )}
        </div>

        {/* ── Right pane: Agent Chat ───────────────────────────────────────── */}
        <div className="w-[340px] 2xl:w-[400px] shrink-0 flex flex-col border border-hairline rounded-xl overflow-hidden bg-surface shadow-sm">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center p-10 text-center text-sm text-content-faint">
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
