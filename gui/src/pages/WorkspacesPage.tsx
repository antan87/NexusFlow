import { useMemo, useState, useEffect, type ComponentProps } from 'react';
import {
  RefreshCw,
  Play,
  MoreVertical,
  Copy,
  Trash2,
  Search,
  FolderGit2,
  Columns2,
  LayoutTemplate,
  LayoutDashboard,
  MessageSquare,
  PanelLeft,
} from 'lucide-react';
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
import { WorkspaceLauncher } from '../features/workspace-launch/WorkspaceLauncher.js';
import { WorkspaceSkillsTab } from '../features/skills/WorkspaceSkillsTab.js';

export type WorkspaceLayoutMode = 'cockpit' | 'split' | 'chat-only' | 'inspector-only';

type SubTab = 'overview' | 'sessions' | 'services' | 'changes' | 'knowledge' | 'plan' | 'skills';

const TABS: Array<{ value: SubTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'changes', label: 'Changes' },
  { value: 'services', label: 'Services' },
  { value: 'sessions', label: 'Sessions' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'plan', label: 'Plan' },
  { value: 'skills', label: 'Skills' },
];

const FILTERS = ['all', 'changes', 'running'] as const;
type Filter = (typeof FILTERS)[number];

const isVsCode = new URLSearchParams(window.location.search).get('env') === 'vscode';

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
  handleDeleteWorkspace: (wsName: string) => Promise<void>;
  deleteWsLoading: string | null;
  repos: RepoInfo[];
  addRepoLoading: boolean;
  handleAddRepo: (wsName: string, repoPath: string) => Promise<void>;
  showToast?: (message: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
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
    handleDeleteWorkspace,
    deleteWsLoading,
    repos,
    addRepoLoading,
    handleAddRepo,
    showToast,
    sessionProps,
    changesProps,
    knowledgeProps,
    planProps,
  } = props;

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const [layoutMode, setLayoutMode] = useState<WorkspaceLayoutMode>(() => {
    try {
      const saved = localStorage.getItem('nexusflow:workspaces:layoutMode');
      if (saved === 'cockpit' || saved === 'split' || saved === 'chat-only' || saved === 'inspector-only') {
        return saved;
      }
    } catch {
      // Storage can be unavailable in hardened or private browser contexts.
    }
    return 'cockpit';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nexusflow:workspaces:sidebarCollapsed') === 'true';
    } catch {
      // Fall back to the expanded sidebar when storage is unavailable.
    }
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('nexusflow:workspaces:layoutMode', layoutMode);
    } catch {
      // The in-memory layout still works when persistence is unavailable.
    }
  }, [layoutMode]);

  useEffect(() => {
    try {
      localStorage.setItem('nexusflow:workspaces:sidebarCollapsed', String(sidebarCollapsed));
    } catch {
      // The in-memory sidebar state still works without persistence.
    }
  }, [sidebarCollapsed]);

  // Ctrl/Cmd shortcuts only apply outside text-editing controls.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
      ) return;

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && e.key === '\\') {
        e.preventDefault();
        setLayoutMode((prev) => {
          if (prev === 'cockpit') return 'split';
          if (prev === 'split') return 'chat-only';
          if (prev === 'chat-only') return 'inspector-only';
          return 'cockpit';
        });
      } else if (isCmdOrCtrl && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault();
        setLayoutMode((prev) => (prev === 'chat-only' ? 'cockpit' : 'chat-only'));
      } else if (isCmdOrCtrl && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const selected = workspaces.find((w) => w.branchName === selectedId) ?? null;
  const selectedMode = selected?.mode ?? 'worktree';

  // Detected services for the overview topology panel
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

  const renderInspector = () => {
    if (!selected) return null;
    return (
      <div className="flex flex-col gap-4">
        <Card className="p-5">
          <div className="flex flex-col items-start gap-4">
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={resumingWs === selected.branchName}
                onClick={() => handleResumeSession(selected)}
              >
                <Play size={13} className={resumingWs === selected.branchName ? 'animate-spin' : ''} />
                {resumingWs === selected.branchName ? 'Opening…' : 'Continue in Chat'}
              </Button>
              <WorkspaceLauncher
                workspaceId={selected.branchName}
                workspacePath={selected.workspacePath}
                isVsCode={isVsCode}
              />
              <Menu>
                <MenuTrigger
                  aria-label="More actions"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <MoreVertical size={16} />
                </MenuTrigger>
                <MenuPopup align="end">
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
          <TabsPanel value={subTab} className="animate-fade-in pt-3">
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
            {subTab === 'skills' && <WorkspaceSkillsTab ws={selected} showToast={showToast} />}
          </TabsPanel>
        </Tabs>
      </div>
    );
  };

  const renderChat = () => {
    if (!selected) {
      return (
        <div className="flex-1 flex items-center justify-center p-10 text-center text-sm text-muted-foreground">
          Select a workspace to start chatting.
        </div>
      );
    }
    return <AgentChat key={selected.branchName} ws={selected} />;
  };

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Workspaces</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Inspect workspace changes, services, context, and collaborate with embedded agents.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Switcher Toolbar */}
          <div
            role="group"
            aria-label="Workspace layout"
            className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1"
          >
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className={cn(
                'rounded-md p-1.5 text-xs font-medium transition-colors cursor-pointer',
                sidebarCollapsed
                  ? 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  : 'bg-background text-foreground shadow-sm',
              )}
              title={sidebarCollapsed ? 'Show workspaces sidebar (Ctrl+B)' : 'Hide workspaces sidebar (Ctrl+B)'}
              aria-label="Toggle sidebar"
              aria-expanded={!sidebarCollapsed}
            >
              <PanelLeft size={15} />
            </button>
            <div className="h-3.5 w-px bg-border my-auto mx-0.5" />
            <button
              onClick={() => setLayoutMode('cockpit')}
              aria-label="Cockpit layout"
              aria-pressed={layoutMode === 'cockpit'}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                layoutMode === 'cockpit'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title="Cockpit mode: Spacious chat canvas with contextual inspector (Ctrl+\)"
            >
              <LayoutTemplate size={13} />
              <span className="hidden sm:inline">Cockpit</span>
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              aria-label="Split layout"
              aria-pressed={layoutMode === 'split'}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                layoutMode === 'split'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title="Dual-Split mode: 50/50 side-by-side chat and inspector (Ctrl+\)"
            >
              <Columns2 size={13} />
              <span className="hidden sm:inline">Split</span>
            </button>
            <button
              onClick={() => setLayoutMode('chat-only')}
              aria-label="Chat-only layout"
              aria-pressed={layoutMode === 'chat-only'}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                layoutMode === 'chat-only'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title="Chat focus mode: Full width chat canvas (Ctrl+J)"
            >
              <MessageSquare size={13} />
              <span className="hidden sm:inline">Chat</span>
            </button>
            <button
              onClick={() => setLayoutMode('inspector-only')}
              aria-label="Inspector-only layout"
              aria-pressed={layoutMode === 'inspector-only'}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer',
                layoutMode === 'inspector-only'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent',
              )}
              title="Inspector focus mode: Full width inspector"
            >
              <LayoutDashboard size={13} />
              <span className="hidden sm:inline">Inspector</span>
            </button>
          </div>

          <Button variant="outline" onClick={fetchWorkspaces} disabled={workspacesLoading}>
            <RefreshCw size={14} className={workspacesLoading ? 'animate-spin text-primary' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex gap-4 h-[calc(100vh-125px)] overflow-hidden pb-3">
        {/* ── Left rail: Workspaces List ─────────────────────────────────────────── */}
        {!sidebarCollapsed && (
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
                  aria-pressed={filter === f}
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
        )}

        {/* ── Main content area based on layout mode ─────────────────────────── */}
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
                      Pick a workspace from the list to see its status, repositories, changes, services, sessions and chat.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </Card>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'flex-1 min-w-0 h-full gap-4',
              (layoutMode === 'cockpit' || layoutMode === 'split')
                && 'flex flex-col overflow-y-auto xl:grid xl:overflow-hidden',
              layoutMode === 'cockpit'
                && 'xl:grid-cols-[minmax(440px,960px)_minmax(380px,640px)]',
              layoutMode === 'split' && 'xl:grid-cols-2',
              layoutMode === 'chat-only' && 'flex justify-center overflow-hidden',
              layoutMode === 'inspector-only' && 'overflow-y-auto pr-1',
            )}
          >
            {/* Keep one AgentChat mounted while layout classes change. Unmounting
                it closes the active WebSocket and interrupts the current turn. */}
            <div
              className={cn(
                'min-w-0 flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm',
                (layoutMode === 'cockpit' || layoutMode === 'split')
                  && 'w-full min-h-[420px] flex-none xl:h-full xl:min-h-0',
                layoutMode === 'chat-only' && 'w-full max-w-5xl h-full',
                layoutMode === 'inspector-only' && 'hidden',
              )}
            >
              {renderChat()}
            </div>

            <div
              className={cn(
                'min-w-0',
                (layoutMode === 'cockpit' || layoutMode === 'split')
                  && 'w-full flex-none overflow-visible xl:h-full xl:overflow-y-auto xl:pr-1',
                layoutMode === 'chat-only' && 'hidden',
                layoutMode === 'inspector-only' && 'h-full overflow-y-auto',
              )}
            >
              <div className={cn(layoutMode === 'inspector-only' && 'mx-auto flex w-full max-w-6xl flex-col')}>
                {renderInspector()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
