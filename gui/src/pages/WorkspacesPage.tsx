import { useState, type ComponentProps } from 'react';
import {
  RefreshCw,
  MoreVertical,
  Copy,
  Trash2,
  FolderGit2,
  Terminal,
  Code2,
  ChevronDown,
  Sparkles,
  Puzzle,
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/ui/menu.js';
import { Spinner } from '../components/ui/spinner.js';
import { StatusBadge } from '../components/ui/status-badge.js';
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceServices, useWorkspaceLaunchTargets, useWorkspaceSkills, useSkills } from '../lib/api/queries.js';
import { safeCopyToClipboard } from '../lib/clipboard.js';
import { syncMeta, repoName } from '../lib/status.js';
import { apiFetch } from '../lib/api/client.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { AgentChat } from '../features/chat/AgentChat.js';
import { ServiceConsole } from '../features/services/ServiceConsole.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
import { WorkspaceSkillsTab } from '../features/skills/WorkspaceSkillsTab.js';
import { ChatMarkdown } from '../components/ChatMarkdown.js';

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

  // Active skills in this workspace
  const workspaceSkillsConfig = useWorkspaceSkills(selected?.branchName ?? null).data;
  const { data: allSkills = [], isLoading: skillsLoading } = useSkills(selected?.branchName);
  const activeSkills = allSkills.filter((s) => workspaceSkillsConfig?.enabledSkills?.includes(s.id));

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
    const st = workspaceStatuses[selected.branchName];
    const sync = selectedMode === 'in-place' ? null : (st ? syncMeta(st.syncStatus) : null);

    return (
      <div className="flex flex-col min-w-0 pb-8">
        {/* Workspace Hero Header */}
        <div className="border-b border-border/80 bg-card/40 px-5 py-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            {/* Left: Branch Title, Tag, and Sub-metrics */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-mono text-base sm:text-lg font-bold text-foreground tracking-tight" title={selected.branchName}>
                  {selected.branchName}
                </h1>
                <button
                  type="button"
                  onClick={async () => {
                    const copied = await safeCopyToClipboard(selected.branchName);
                    if (copied) showToast?.('Copied branch name to clipboard.', 'success');
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors p-0.5 cursor-pointer"
                  title="Copy branch name"
                >
                  <Copy size={13} />
                </button>
                <span className="inline-flex items-center rounded border border-border/80 bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  {selectedMode === 'in-place' ? 'In-place' : 'Worktree'}
                </span>
              </div>

              {/* Sub-strip with live status indicators */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
                <span>{selected.repos.length} {selected.repos.length === 1 ? 'repo' : 'repos'}</span>
                <span>•</span>
                <span>Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                {st && st.changedFiles > 0 ? (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-amber-400 font-semibold">
                      <span className="size-1.5 rounded-full bg-amber-400" />
                      {st.changedFiles} modified
                    </span>
                  </>
                ) : (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      Clean
                    </span>
                  </>
                )}
                {st && st.runningServices > 0 && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {st.runningServices} active
                    </span>
                  </>
                )}
                {sync && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-primary">
                      <RefreshCw size={10} /> {sync.label}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Split Launch Combobox & Actions */}
            <div className="flex items-center gap-1.5 shrink-0">
              {primaryEditor && (
                availableEditors.length > 1 ? (
                  <div className="inline-flex h-8 items-center rounded-md border border-border bg-card shadow-xs">
                    <button
                      type="button"
                      disabled={Boolean(openingEditor)}
                      onClick={() => void handleOpenEditor(primaryEditor.id)}
                      title={`Open workspace in ${primaryEditor.name}`}
                      className="inline-flex h-full items-center gap-1.5 px-3 text-xs font-semibold text-foreground hover:bg-accent transition-colors cursor-pointer rounded-l-md"
                    >
                      {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                      <span>{primaryEditor.name}</span>
                    </button>
                    <Menu>
                      <MenuTrigger className="inline-flex h-full w-6 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent border-l border-border transition-colors cursor-pointer rounded-r-md">
                        <ChevronDown size={12} />
                      </MenuTrigger>
                      <MenuPopup align="end" className="w-52">
                        <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Open Workspace In
                        </div>
                        {availableEditors.map((ed) => (
                          <MenuItem
                            key={ed.id}
                            onClick={() => void handleOpenEditor(ed.id)}
                            className={cn(
                              'flex items-center justify-between text-xs',
                              ed.id === primaryEditor.id && 'font-semibold text-primary'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {renderEditorIcon(ed.id, ed.name)}
                              <span className="truncate">{ed.name}</span>
                            </div>
                            {ed.id === primaryEditor.id && <span className="text-[10px] text-muted-foreground font-mono">(default)</span>}
                          </MenuItem>
                        ))}
                      </MenuPopup>
                    </Menu>
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

              {/* More Actions Menu */}
              <Menu>
                <MenuTrigger className="grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer">
                  <MoreVertical size={14} />
                </MenuTrigger>
                <MenuPopup align="end" className="w-48">
                  <MenuItem onClick={() => handleCopyPrompt(selected)} className="flex items-center gap-2 text-xs">
                    <Copy size={13} /> <span>Copy AI Context</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => void handleDeleteWorkspace(selected.branchName)}
                    disabled={deleteWsLoading === selected.branchName}
                    className="flex items-center gap-2 text-xs text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={13} />
                    <span>{deleteWsLoading === selected.branchName ? 'Deleting…' : 'Delete Workspace'}</span>
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </div>
          </div>
        </div>

        {/* Tab Navigation & Content Container */}
        <div className="px-5 pt-3">
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
                <div className="flex flex-col gap-3">
                  {/* Unified Divided Overview Card */}
                  <Card className="divide-y divide-border overflow-hidden surface-card">
                    {/* Section 1: AI Assistant & Fast Action Header */}
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between bg-muted/20">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 place-items-center rounded-lg border border-border bg-card text-foreground shadow-xs">
                          {selected.assistants[0] === 'claude' ? (
                            <SiClaude className="size-4 text-[#D97757]" />
                          ) : selected.assistants[0] === 'codex' ? (
                            <BsOpenai className="size-4 text-foreground" />
                          ) : selected.assistants[0] === 'copilot' ? (
                            <SiGithubcopilot className="size-4 text-blue-400" />
                          ) : (
                            <AntigravityIcon className="size-5" />
                          )}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs sm:text-sm font-semibold text-foreground capitalize">
                              {selected.assistants[0] || 'Antigravity'}
                            </h3>
                            <StatusBadge tone="running">Configured AI</StatusBadge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Workspace rules, prompt templates, and skills ready.
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

                    {/* Section 2: Workspace Description (if present) */}
                    {selected.description && (
                      <div className="p-4">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                          Description
                        </h4>
                        <div className="text-xs sm:text-sm leading-relaxed text-foreground/90">
                          <ChatMarkdown content={selected.description} />
                        </div>
                      </div>
                    )}

                    {/* Section 3: Repositories & Ports */}
                    <div className="p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Mapped Repositories ({selected.repos.length})
                        </h4>
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
                      <div className="divide-y divide-border/60">
                        {repoRows.map((r) => (
                          <div key={r.name} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 text-xs">
                            <div className="flex items-center gap-2 font-mono min-w-0">
                              <span
                                className={cn(
                                  'size-2 rounded-full shrink-0',
                                  r.changedCount === null ? 'bg-muted-foreground' : r.changedCount > 0 ? 'bg-warning' : 'bg-success',
                                )}
                                title={r.changedCount === null ? 'Status unknown' : r.changedCount > 0 ? `${r.changedCount} uncommitted changes` : 'Clean'}
                              />
                              <span className="truncate font-semibold text-foreground">{r.name}</span>
                            </div>
                            <div className="flex items-center gap-2 text-muted-foreground font-mono shrink-0">
                              {r.ports.map((p) => (
                                <span key={p} className="rounded border border-border bg-muted/80 px-1.5 py-0.5 text-[11px] text-running-foreground">
                                  :{p}
                                </span>
                              ))}
                              <span>
                                {r.changedCount === null ? '—' : r.changedCount > 0 ? `${r.changedCount} changed` : 'clean'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Section 4: Workspace Active Skills & Capabilities */}
                    <div className="p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Active Skills & Capabilities
                          </h4>
                          <span className={cn(
                            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono border',
                            activeSkills.length > 0
                              ? 'border-primary/20 bg-primary/10 text-primary'
                              : 'border-border/70 bg-muted/60 text-muted-foreground'
                          )}>
                            {activeSkills.length} active
                          </span>
                        </div>
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onSelectTab(selected.branchName, 'skills')}
                          className="text-xs gap-1.5"
                        >
                          <Puzzle size={12} />
                          <span>Manage Skills</span>
                        </Button>
                      </div>

                      {skillsLoading ? (
                        <div className="h-10 rounded bg-muted/40 animate-pulse" />
                      ) : activeSkills.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-3 py-3 sm:flex sm:items-center sm:justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-foreground">No active skills configured</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Attach PR review toolkits, linters, or test runners to enhance AI assistant context in this workspace.
                            </p>
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => onSelectTab(selected.branchName, 'skills')}
                            className="shrink-0 text-primary hover:text-primary mt-2 sm:mt-0 font-medium"
                          >
                            Configure Skills →
                          </Button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {activeSkills.map((skill) => (
                            <div
                              key={skill.id}
                              className="flex flex-col justify-between p-2.5 rounded-md border border-border/80 bg-card/60 hover:bg-card transition-colors shadow-2xs gap-1.5"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="grid size-5 place-items-center rounded bg-primary/10 text-primary shrink-0">
                                    <Puzzle size={11} />
                                  </span>
                                  <span className="text-xs font-semibold text-foreground truncate" title={skill.title || skill.name}>
                                    {skill.title || skill.name}
                                  </span>
                                </div>
                                <span
                                  className={cn(
                                    'text-[10px] font-mono uppercase px-1 py-0.5 rounded border shrink-0',
                                    skill.custom
                                      ? 'border-purple-500/20 bg-purple-500/10 text-purple-400'
                                      : 'border-border/70 bg-muted text-muted-foreground'
                                  )}
                                >
                                  {skill.custom ? 'Custom' : 'Template'}
                                </span>
                              </div>
                              {skill.description && (
                                <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                                  {skill.description}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                </div>
              )}
              {subTab === 'sessions' && (
                <div className="space-y-6">
                  <section aria-labelledby="embedded-harness-heading" className="space-y-2">
                    <div>
                      <h2 id="embedded-harness-heading" className="text-sm font-semibold text-foreground">
                        Embedded harness
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Start a first-party SDK or local CLI session in this workspace and choose its execution profile and model.
                      </p>
                    </div>
                    <div className="h-[36rem] min-h-[28rem] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                      <AgentChat key={selected.branchName} ws={selected} />
                    </div>
                  </section>

                  <section aria-labelledby="session-history-heading" className="space-y-2">
                    <div>
                      <h2 id="session-history-heading" className="text-sm font-semibold text-foreground">
                        Session history
                      </h2>
                      <p className="text-xs text-muted-foreground">
                        Inspect or resume sessions recorded by the installed harnesses.
                      </p>
                    </div>
                    <SessionHistory ws={selected} showToast={showToast} {...sessionProps} />
                  </section>
                </div>
              )}
              {subTab === 'services' && <ServiceConsole ws={selected} />}
              {subTab === 'changes' && <ChangesViewer ws={selected} {...changesProps} />}
              {subTab === 'knowledge' && <KnowledgeBase ws={selected} {...knowledgeProps} />}
              {subTab === 'plan' && <ImplementationPlan {...planProps} />}
              {subTab === 'skills' && <WorkspaceSkillsTab ws={selected} showToast={showToast} />}
            </TabsPanel>
          </Tabs>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full animate-fade-in w-full min-w-0 bg-background">
      {!selected ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full">
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
