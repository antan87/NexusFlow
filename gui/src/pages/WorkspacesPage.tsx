import { useMemo, useState, useEffect, useRef, type ComponentProps } from 'react';
import {
  RefreshCw,
  MoreVertical,
  Copy,
  Trash2,
  Search,
  FolderGit2,
  Terminal,
  PanelLeft,
  MessageSquare,
} from 'lucide-react';
import type { Feature, WorkspaceStatus, RepoInfo } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Input } from '../components/ui/input.js';
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../components/ui/menu.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Spinner } from '../components/ui/spinner.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceServices, useLaunchTerminal, useAiDetect } from '../lib/api/queries.js';
import { safeCopyToClipboard } from '../lib/clipboard.js';
import { syncMeta, repoName } from '../lib/status.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { ServiceConsole } from '../features/services/ServiceConsole.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
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
  const [launchingHarness, setLaunchingHarness] = useState<string | null>(null);
  const launchInFlightRef = useRef(false);

  const launchTerminalMutation = useLaunchTerminal();
  const aiDetect = useAiDetect();
  const isClaudeDetected = aiDetect.data?.find((a) => a.name === 'claude')?.detected ?? false;
  const isCodexDetected = aiDetect.data?.find((a) => a.name === 'codex')?.detected ?? false;

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('nexusflow:workspaces:sidebarCollapsed') === 'true';
    } catch {
      // Fall back to expanded sidebar
    }
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('nexusflow:workspaces:sidebarCollapsed', String(sidebarCollapsed));
    } catch {
      // Storage unavailable
    }
  }, [sidebarCollapsed]);

  // Ctrl/Cmd+B shortcut toggles sidebar (guarded against active modals)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable)
        || document.querySelector('[role="dialog"]') !== null
      ) return;

      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      if (isCmdOrCtrl && (e.key === 'b' || e.key === 'B')) {
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

  const launchHarnessTerminal = async (assistant: string) => {
    if (!selected || launchInFlightRef.current) return;
    if (assistant === 'codex' && !isCodexDetected) {
      showToast?.('OpenAI Codex CLI is not installed on your system.', 'info');
      return;
    }
    if (assistant === 'claude' && !isClaudeDetected) {
      showToast?.('Claude CLI is not installed on your system. Run: npm install -g @anthropic-ai/claude-code', 'info');
      return;
    }
    launchInFlightRef.current = true;
    setLaunchingHarness(`term:${assistant}`);
    try {
      await launchTerminalMutation.mutateAsync({
        workspaceId: selected.branchName,
        assistant,
      });
      showToast?.(`Launched interactive ${assistant} session in terminal.`, 'success');
    } catch (err) {
      console.error(`Failed to launch terminal for ${assistant}:`, err);
      const cmd = assistant === 'antigravity' ? 'agy' : assistant === 'claude' ? 'claude' : assistant === 'codex' ? 'codex' : 'copilot';
      const copied = await safeCopyToClipboard(cmd);
      if (copied) {
        showToast?.(`Could not launch terminal automatically. Copied command to clipboard:\n\n${cmd}`, 'info');
      } else {
        showToast?.(`Could not launch terminal automatically. Run manually:\n\n${cmd}`, 'error');
      }
    } finally {
      setLaunchingHarness(null);
      launchInFlightRef.current = false;
    }
  };

  const renderInspector = () => {
    if (!selected) return null;
    return (
      <div className="flex flex-col gap-3.5">
        {/* Workspace Summary Header Card */}
        <Card className="p-3.5 sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-lg sm:text-xl font-bold text-foreground" title={selected.branchName}>
                  {selected.branchName}
                </h2>
                <StatusBadge tone={selectedMode}>
                  {selectedMode === 'in-place' ? 'In-place' : 'Worktree'}
                </StatusBadge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                <span>·</span>
                <span>{selected.repos.length} {selected.repos.length === 1 ? 'repo' : 'repos'}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <WorkspaceLauncher
                workspaceId={selected.branchName}
                workspacePath={selected.workspacePath}
                isVsCode={isVsCode}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={Boolean(launchingHarness?.startsWith('term:'))}
                onClick={() => launchHarnessTerminal(selected.assistants[0] || 'antigravity')}
                title="Launch terminal shell in workspace"
              >
                {launchingHarness?.startsWith('term:') ? <Spinner className="size-3.5" /> : <Terminal size={13} />}
                Terminal
              </Button>
              <Menu>
                <MenuTrigger
                  aria-label="More actions"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  <MoreVertical size={15} />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => handleCopyPrompt(selected)} className="cursor-pointer">
                    <Copy size={14} /> Copy AI Context
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    variant="destructive"
                    disabled={deleteWsLoading === selected.branchName}
                    onClick={() => void handleDeleteWorkspace(selected.branchName)}
                    className="cursor-pointer"
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

        {/* Tab Navigation */}
        <Tabs
          value={subTab}
          onValueChange={(v) => typeof v === 'string' && onSelectTab(selected.branchName, v as SubTab)}
          className="mb-4"
        >
          <TabsList className="max-w-full overflow-x-auto">
            {TABS.map((tab) => (
              <TabsTab key={tab.value} value={tab.value}>
                {tab.value === 'sessions' ? 'AI & Sessions' : tab.label}
              </TabsTab>
            ))}
          </TabsList>
          <TabsPanel value={subTab} className="animate-fade-in pt-3">
            {subTab === 'overview' && (
              <div className="flex flex-col gap-3.5">
                {/* Configured AI Assistant Banner */}
                <Card className="p-3.5 sm:p-4 bg-gradient-to-r from-card to-card/60">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-xl bg-violet-600 text-white font-bold text-xs shadow-sm">
                        {selected.assistants[0] === 'claude' ? 'C' : selected.assistants[0] === 'codex' ? 'O' : 'A'}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground capitalize">
                            {selected.assistants[0] || 'Antigravity'}
                          </h3>
                          <StatusBadge tone="running">Configured AI</StatusBadge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Context and instructions generated for this workspace.
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => onSelectTab(selected.branchName, 'sessions')}
                    >
                      AI Sessions & Harnesses →
                    </Button>
                  </div>
                </Card>

                {/* Recent AI Sessions Quick Panel (if any sessions exist) */}
                {sessionProps.sessions.length > 0 && (
                  <Card className="p-3.5 sm:p-4">
                    <div className="mb-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Recent Sessions</h3>
                        <span className="text-xs text-muted-foreground">({sessionProps.sessions.length})</span>
                      </div>
                      <button
                        onClick={() => onSelectTab(selected.branchName, 'sessions')}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer flex items-center gap-1"
                      >
                        View all sessions →
                      </button>
                    </div>
                    <div className="space-y-2">
                      {sessionProps.sessions.slice(0, 2).map((sess) => (
                        <div
                          key={sess.id}
                          className="flex flex-col gap-2 rounded-lg border border-border bg-card/50 p-2.5 transition-colors hover:border-foreground/15 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <StatusBadge tone={sess.assistant === 'claude' ? 'warning' : 'running'}>
                                {sess.assistant}
                              </StatusBadge>
                              <span className="text-[11px] text-muted-foreground">
                                {new Date(sess.updatedAt).toLocaleDateString()}
                              </span>
                              <span className="text-[11px] text-muted-foreground">•</span>
                              <span className="text-[11px] font-medium text-muted-foreground">
                                {sess.messageCount} msgs
                              </span>
                            </div>
                            <p className="text-xs font-medium text-foreground truncate" title={sess.title}>
                              {sess.title}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                sessionProps.setActiveSession(sess);
                                sessionProps.setTranscript([]);
                                sessionProps.fetchSessionTranscript(sess.assistant, sess.id);
                              }}
                            >
                              <MessageSquare size={12} />
                              <span>Chat</span>
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => void launchHarnessTerminal(sess.assistant)}
                            >
                              <Terminal size={12} />
                              <span>Resume</span>
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Description Card */}
                <Card className="p-5">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">Description</h3>
                  {selected.description ? (
                    <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{selected.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">No description provided.</p>
                  )}
                </Card>

                {/* Repositories Card */}
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
            {subTab === 'sessions' && <SessionHistory ws={selected} showToast={showToast} {...sessionProps} />}
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

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-foreground">Workspaces</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Inspect workspace changes, services, context, and launch external AI harnesses.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={sidebarCollapsed ? 'Show workspace list (Ctrl+B)' : 'Hide workspace list (Ctrl+B)'}
            aria-label={sidebarCollapsed ? 'Show workspace list' : 'Hide workspace list'}
            aria-expanded={!sidebarCollapsed}
          >
            <PanelLeft size={14} className={cn('transition-transform', sidebarCollapsed && 'opacity-60')} />
            <span className="hidden sm:inline">{sidebarCollapsed ? 'Show List' : 'Hide List'}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={fetchWorkspaces} disabled={workspacesLoading}>
            <RefreshCw size={13} className={workspacesLoading ? 'animate-spin text-primary' : ''} />
            Refresh
          </Button>
        </div>
      </header>

      <div className="flex gap-3 h-[calc(100vh-115px)] overflow-hidden pb-2">
        {/* ── Left rail: Workspaces List ─────────────────────────────────────────── */}
        {!sidebarCollapsed && (
          <div className="w-52 sm:w-56 shrink-0 flex flex-col overflow-y-auto pr-1">
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

        {/* ── Main content area ────────────────────────────────────────────── */}
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
                      Pick a workspace from the list to see its status, repositories, changes, services, and AI harness launchpad.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </Card>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-w-0 h-full overflow-y-auto pr-1">
            <div className="mx-auto flex w-full max-w-6xl flex-col">
              {renderInspector()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
