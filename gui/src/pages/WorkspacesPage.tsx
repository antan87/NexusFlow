import { useState, useRef, useEffect, type ComponentProps } from 'react';
import {
  RefreshCw,
  MoreVertical,
  Copy,
  Trash2,
  FolderGit2,
  Terminal,
  MessageSquare,
  Code2,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { VscVscode, VscVscodeInsiders } from 'react-icons/vsc';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import type { Feature, WorkspaceStatus, RepoInfo } from '../types.js';

const renderEditorIcon = (id: string, name: string) => {
  const lower = `${id} ${name}`.toLowerCase();
  if (lower.includes('insiders')) {
    return <VscVscodeInsiders size={15} className="text-[#24C05A] shrink-0" />;
  }
  if (lower.includes('code') || lower.includes('vscode')) {
    return <VscVscode size={15} className="text-[#007ACC] shrink-0" />;
  }
  if (lower.includes('antigravity')) {
    return <AntigravityIcon className="size-3.5 shrink-0" />;
  }
  if (lower.includes('cursor')) {
    return <Sparkles size={14} className="text-purple-400 shrink-0" />;
  }
  if (lower.includes('powershell') || lower.includes('pwsh')) {
    return <Terminal size={14} className="text-sky-400 shrink-0" />;
  }
  if (lower.includes('cmd') || lower.includes('command prompt')) {
    return <Terminal size={14} className="text-amber-400 shrink-0" />;
  }
  return <Code2 size={14} className="shrink-0" />;
};
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.js';
import { Spinner } from '../components/ui/spinner.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceServices, useWorkspaceLaunchTargets } from '../lib/api/queries.js';
import { syncMeta, repoName } from '../lib/status.js';
import { apiFetch } from '../lib/api/client.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { ServiceConsole } from '../features/services/ServiceConsole.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
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

interface WorkspacesPageProps {
  workspaces: Feature[];
  workspaceStatuses: Record<string, WorkspaceStatus>;
  workspacesLoading?: boolean;
  fetchWorkspaces?: () => Promise<void>;
  selectedId: string | null;
  subTab: SubTab;
  onSelect?: (id: string) => void;
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
    selectedId,
    subTab,
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

  const selected = workspaces.find((w) => w.branchName === selectedId) ?? null;
  const selectedMode = selected?.mode ?? 'worktree';

  // Detected services for the overview topology panel
  const detectedServices = useWorkspaceServices(selected?.branchName ?? null).data?.services ?? [];

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

  const launchTargets = useWorkspaceLaunchTargets();
  const [openingEditor, setOpeningEditor] = useState<string | null>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const editorMenuRef = useRef<HTMLDivElement>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editorMenuOpen && !moreMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (editorMenuRef.current && !editorMenuRef.current.contains(e.target as Node)) {
        setEditorMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [editorMenuOpen, moreMenuOpen]);

  const availableEditors = launchTargets.data?.filter((t) => t.kind === 'editor' && t.available) ?? [];
  const primaryEditor = availableEditors.find((e) => e.id === 'vscode-insiders')
    || availableEditors.find((e) => e.id === 'vscode')
    || availableEditors[0];

  const handleOpenEditor = async (targetId: string) => {
    if (openingEditor || !selected) return;
    setOpeningEditor(targetId);
    try {
      await apiFetch(`/api/workspace/${encodeURIComponent(selected.branchName)}/launch`, {
        method: 'POST',
        body: JSON.stringify({ targetId }),
      });
      showToast?.(`Opened workspace in ${targetId}.`, 'success');
    } catch (e) {
      showToast?.(`Failed to open ${targetId}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      setOpeningEditor(null);
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
              {primaryEditor && (
                availableEditors.length > 1 ? (
                  <div className="relative flex items-center rounded-md border border-border bg-card shadow-xs" ref={editorMenuRef}>
                    <button
                      type="button"
                      disabled={Boolean(openingEditor)}
                      onClick={() => void handleOpenEditor(primaryEditor.id)}
                      title={`Open workspace in ${primaryEditor.name}`}
                      className="inline-flex items-center gap-1.5 rounded-l-md px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors cursor-pointer border-r border-border"
                    >
                      {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                      <span>{primaryEditor.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorMenuOpen((prev) => !prev)}
                      aria-label="Select Editor or Shell"
                      aria-expanded={editorMenuOpen}
                      className="grid h-8 w-6 place-items-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer transition-colors"
                    >
                      <ChevronDown size={13} className={cn('transition-transform duration-150', editorMenuOpen && 'rotate-180')} />
                    </button>

                    {editorMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-52 z-50 rounded-lg border border-border bg-popover p-1 shadow-lg text-foreground animate-fade-in">
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Open Workspace In
                        </div>
                        {availableEditors.map((ed) => (
                          <button
                            key={ed.id}
                            type="button"
                            onClick={() => {
                              setEditorMenuOpen(false);
                              void handleOpenEditor(ed.id);
                            }}
                            className={cn(
                              'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                              ed.id === primaryEditor.id && 'font-semibold text-primary bg-primary/10'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {renderEditorIcon(ed.id, ed.name)}
                              <span className="truncate">{ed.name}</span>
                            </div>
                            {ed.id === primaryEditor.id && <span className="text-[10px] text-muted-foreground font-mono shrink-0">(default)</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={Boolean(openingEditor)}
                    onClick={() => void handleOpenEditor(primaryEditor.id)}
                    title={`Open workspace in ${primaryEditor.name}`}
                    className="font-medium"
                  >
                    {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                    <span>{primaryEditor.name}</span>
                  </Button>
                )
              )}
              <div className="relative" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setMoreMenuOpen((prev) => !prev)}
                  aria-label="More actions"
                  aria-expanded={moreMenuOpen}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
                >
                  <MoreVertical size={15} />
                </button>

                {moreMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-44 z-50 rounded-lg border border-border bg-popover p-1 shadow-lg text-foreground animate-fade-in">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenuOpen(false);
                        handleCopyPrompt(selected);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Copy size={13} /> <span>Copy AI Context</span>
                    </button>
                    <div className="my-1 h-px bg-border/60" />
                    <button
                      type="button"
                      disabled={deleteWsLoading === selected.branchName}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        void handleDeleteWorkspace(selected.branchName);
                      }}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 size={13} />
                      <span>{deleteWsLoading === selected.branchName ? 'Deleting…' : 'Delete Workspace'}</span>
                    </button>
                  </div>
                )}
              </div>
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
                      {selected.assistants[0] === 'claude' ? (
                        <span className="grid size-9 place-items-center rounded-xl bg-[#D97757] text-white shadow-sm">
                          <SiClaude className="size-5" />
                        </span>
                      ) : selected.assistants[0] === 'codex' ? (
                        <span className="grid size-9 place-items-center rounded-xl bg-foreground text-background shadow-sm">
                          <BsOpenai className="size-5" />
                        </span>
                      ) : selected.assistants[0] === 'copilot' ? (
                        <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white shadow-sm">
                          <SiGithubcopilot className="size-5" />
                        </span>
                      ) : (
                        <span className="grid size-9 place-items-center rounded-xl bg-card border border-border/80 shadow-sm p-1.5">
                          <AntigravityIcon className="size-6" />
                        </span>
                      )}
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
                              title="Inspect read-only transcript log"
                            >
                              <MessageSquare size={12} />
                              <span>Transcript</span>
                            </Button>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onSelectTab(selected.branchName, 'sessions')}
                              title="Go to Sessions"
                            >
                              <Terminal size={12} />
                              <span>Sessions</span>
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
                        onAdd={(repoPath: string) => {
                          if (
                            window.confirm(
                              `Add repository "${repoName(repoPath)}" to this workspace?\nThis creates a new git worktree and re-runs analysis.`,
                            )
                          ) {
                            void handleAddRepo(selected.branchName, repoPath);
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
    <div className="flex flex-col h-full animate-fade-in w-full min-w-0">
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
                    Select a workspace from the sidebar to inspect git changes, services, context, or launch AI assistants.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </Card>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-w-0 h-full overflow-y-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col">
            {renderInspector()}
          </div>
        </div>
      )}
    </div>
  );
}
