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
  LayoutDashboard,
  GitCompare,
  Bot,
  Brain,
  ListTodo,
  GitBranch,
  Zap,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
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
import { Tabs, TabsList, TabsPanel, TabsTab } from '../components/ui/tabs.js';
import { AddRepoPicker } from '../components/AddRepoPicker.js';
import { useWorkspaceLaunchTargets, useWorkspaceSkills, useSkills } from '../lib/api/queries.js';
import { safeCopyToClipboard } from '../lib/clipboard.js';
import { syncMeta, repoName } from '../lib/status.js';
import { apiFetch } from '../lib/api/client.js';
import { cn } from '../lib/utils.js';
import { SessionHistory } from '../features/sessions/SessionHistory.js';
import { AgentChat } from '../features/chat/AgentChat.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';
import { ChangesViewer } from '../features/changes/ChangesViewer.js';
import { KnowledgeBase } from '../features/knowledge/KnowledgeBase.js';
import { ImplementationPlan } from '../features/plan/ImplementationPlan.js';
import { WorkspaceSkillsTab } from '../features/skills/WorkspaceSkillsTab.js';
import { ChatMarkdown } from '../components/ChatMarkdown.js';

export type WorkspaceLayoutMode = 'cockpit' | 'split' | 'chat-only' | 'inspector-only';

type SubTab = 'overview' | 'sessions' | 'changes' | 'knowledge' | 'plan' | 'skills';

interface TabDef {
  value: SubTab;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'changes', label: 'Changes', icon: GitCompare },
  { value: 'sessions', label: 'AI & Sessions', icon: Bot },
  { value: 'knowledge', label: 'Knowledge', icon: Brain },
  { value: 'plan', label: 'Plan', icon: ListTodo },
  { value: 'skills', label: 'Skills', icon: Puzzle },
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
  const { open: openFloatingChat } = useFloatingChat();

  // Active skills in this workspace
  const workspaceSkillsConfig = useWorkspaceSkills(selected?.branchName ?? null).data;
  const { data: allSkills = [], isLoading: skillsLoading } = useSkills(selected?.branchName);
  const activeSkills = allSkills.filter((s) => workspaceSkillsConfig?.enabledSkills?.includes(s.id));

  const repoRows = selected
    ? selected.repos.map((rp) => {
        const name = repoName(rp);
        const change = changesProps.gitChanges?.find((c: { repoName: string; files?: unknown[] }) => c.repoName === name);
        const changedCount: number | null = change ? change.files?.length ?? 0 : null;
        return { name, path: rp, changedCount };
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
    const totalChangedFiles = st?.changedFiles ?? 0;

    return (
      <div className="flex flex-col min-w-0 pb-12">
        {/* Workspace Hero Cockpit Header */}
        <div className="border-b border-border/80 bg-card/75 backdrop-blur-md px-6 py-5 shadow-xs">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            {/* Left: Branch Title, Badges, and Live Telemetry */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary border border-primary/25 shrink-0">
                  <GitBranch size={15} />
                </div>
                <h1 className="truncate font-mono text-base sm:text-lg font-extrabold text-foreground tracking-tight" title={selected.branchName}>
                  {selected.branchName}
                </h1>
                <button
                  type="button"
                  onClick={async () => {
                    const copied = await safeCopyToClipboard(selected.branchName);
                    if (copied) showToast?.('Copied branch name to clipboard.', 'success');
                  }}
                  className="text-muted-foreground hover:text-primary transition-colors p-1 rounded-md hover:bg-accent cursor-pointer"
                  title="Copy branch name"
                >
                  <Copy size={13} />
                </button>
                <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-bold text-primary uppercase tracking-wider">
                  {selectedMode === 'in-place' ? 'In-Place Mode' : 'Worktree Mode'}
                </span>
              </div>

              {/* High-tech Sub-strip with live status indicators */}
              <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5 text-foreground/80 font-medium">
                  <FolderGit2 size={13} className="text-muted-foreground" />
                  {selected.repos.length} {selected.repos.length === 1 ? 'repo' : 'repos'}
                </span>
                <span>•</span>
                {totalChangedFiles > 0 ? (
                  <button
                    type="button"
                    onClick={() => onSelectTab(selected.branchName, 'changes')}
                    className="flex items-center gap-1.5 text-amber-400 font-semibold hover:underline cursor-pointer"
                  >
                    <span className="size-2 rounded-full bg-amber-400 animate-pulse" />
                    {totalChangedFiles} modified files
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                    <span className="size-2 rounded-full bg-emerald-400" />
                    Clean worktrees
                  </span>
                )}
                <span>•</span>
                <span className="text-muted-foreground/80">Created {new Date(selected.createdAt).toLocaleDateString()}</span>
                {sync && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1.5 text-primary font-medium">
                      <RefreshCw size={11} className="animate-spin-slow" /> {sync.label}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Right: Quick Action Controls */}
            <div className="flex items-center gap-2 shrink-0">
              {primaryEditor && (
                availableEditors.length > 1 ? (
                  <div className="inline-flex h-9 items-center rounded-lg border border-border bg-card shadow-xs hover:border-primary/40 transition-colors">
                    <button
                      type="button"
                      disabled={Boolean(openingEditor)}
                      onClick={() => void handleOpenEditor(primaryEditor.id)}
                      title={`Open workspace in ${primaryEditor.name}`}
                      className="inline-flex h-full items-center gap-2 px-3.5 text-xs font-bold text-foreground hover:bg-accent transition-colors cursor-pointer rounded-l-lg"
                    >
                      {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                      <span>{primaryEditor.name}</span>
                    </button>
                    <Menu>
                      <MenuTrigger className="inline-flex h-full w-7 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent border-l border-border transition-colors cursor-pointer rounded-r-lg">
                        <ChevronDown size={13} />
                      </MenuTrigger>
                      <MenuPopup align="end" className="w-56">
                        <div className="px-2.5 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          Open Workspace In
                        </div>
                        {availableEditors.map((ed) => (
                          <MenuItem
                            key={ed.id}
                            onClick={() => void handleOpenEditor(ed.id)}
                            className={cn(
                              'flex items-center justify-between text-xs py-2',
                              ed.id === primaryEditor.id && 'font-bold text-primary bg-primary/5'
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {renderEditorIcon(ed.id, ed.name)}
                              <span className="truncate">{ed.name}</span>
                            </div>
                            {ed.id === primaryEditor.id && <span className="text-[10px] text-primary font-mono font-bold">(default)</span>}
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
                    className="font-bold h-9 gap-2"
                  >
                    {openingEditor === primaryEditor.id ? <Spinner className="size-3.5" /> : renderEditorIcon(primaryEditor.id, primaryEditor.name)}
                    <span>{primaryEditor.name}</span>
                  </Button>
                )
              )}

              {/* Fast Copy Prompt Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopyPrompt(selected)}
                title="Copy AI Context prompt for external LLM"
                className="h-9 gap-1.5 text-xs font-semibold"
              >
                <Copy size={13} />
                <span className="hidden sm:inline">Copy Context</span>
              </Button>

              {/* More Actions Menu */}
              <Menu>
                <MenuTrigger className="grid size-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer shadow-xs">
                  <MoreVertical size={15} />
                </MenuTrigger>
                <MenuPopup align="end" className="w-52">
                  <MenuItem onClick={() => handleCopyPrompt(selected)} className="flex items-center gap-2 text-xs py-2">
                    <Copy size={13} /> <span>Copy AI Context</span>
                  </MenuItem>
                  <MenuItem
                    onClick={() => void handleDeleteWorkspace(selected.branchName)}
                    disabled={deleteWsLoading === selected.branchName}
                    className="flex items-center gap-2 text-xs py-2 text-destructive hover:bg-destructive/10"
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
        <div className="px-6 pt-5">
          <Tabs
            value={subTab}
            onValueChange={(v) => typeof v === 'string' && onSelectTab(selected.branchName, v as SubTab)}
            className="mb-6"
          >
            {/* Rich Luxury Segmented Menu Bar */}
            <TabsList className="w-full flex-wrap justify-start gap-1.5 p-1.5 rounded-xl border border-border/70 bg-card/60 backdrop-blur-md shadow-xs">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = subTab === tab.value;
                let badge: React.ReactNode = null;

                if (tab.value === 'changes' && totalChangedFiles > 0) {
                  badge = (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono font-bold text-amber-400">
                      {totalChangedFiles}
                    </span>
                  );
                } else if (tab.value === 'skills' && activeSkills.length > 0) {
                  badge = (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-mono font-bold text-primary">
                      {activeSkills.length}
                    </span>
                  );
                }

                return (
                  <TabsTab
                    key={tab.value}
                    value={tab.value}
                    className={cn(
                      'flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer',
                      isActive
                        ? 'bg-card text-foreground shadow-xs border border-primary/30 text-primary ring-1 ring-primary/20'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/70'
                    )}
                  >
                    <Icon size={14} className={cn('shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    <span>{tab.label}</span>
                    {badge}
                  </TabsTab>
                );
              })}
            </TabsList>

            {/* Embedded Harness (AI & Sessions) */}
            <section
              aria-labelledby="embedded-harness-heading"
              aria-hidden={subTab !== 'sessions'}
              className={cn('space-y-3 pt-4', subTab !== 'sessions' && 'hidden')}
            >
              <div>
                <h2 id="embedded-harness-heading" className="text-sm font-bold text-foreground">
                  Embedded Harness & Live Chat
                </h2>
                <p className="text-xs text-muted-foreground">
                  Direct execution engine for Claude, OpenAI, Antigravity, and Copilot in this workspace.
                </p>
              </div>
              <div className="h-[38rem] min-h-[28rem] overflow-hidden rounded-2xl border border-border/80 bg-card shadow-sm">
                <AgentChat key={selected.branchName} ws={selected} />
              </div>
            </section>

            {/* Tab Panels */}
            <TabsPanel value={subTab} className="animate-fade-in pt-4">
              {subTab === 'overview' && (
                <div className="flex flex-col gap-6">
                  {/* COCKPIT DECK: 3 HIGH-UTILITY TELEMETRY TILES */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {/* Tile 1: Git Worktrees */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'changes')}
                      className="group p-4 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                            <GitCompare size={15} />
                          </span>
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Git Changes</span>
                        </div>
                        <ArrowRight size={13} className="text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
                      </div>
                      <div>
                        <div className="text-2xl font-black font-mono text-foreground">
                          {totalChangedFiles > 0 ? (
                            <span className="text-amber-400">{totalChangedFiles} Modified</span>
                          ) : (
                            <span className="text-emerald-400">Clean</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {selected.repos.length} mapped {selected.repos.length === 1 ? 'repository' : 'repositories'}
                        </div>
                      </div>
                    </div>

                    {/* Tile 2: AI Assistant Engine */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'sessions')}
                      className="group p-4 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                            <Bot size={15} />
                          </span>
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">AI Assistant</span>
                        </div>
                        <ArrowRight size={13} className="text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
                      </div>
                      <div>
                        <div className="text-xl font-black text-foreground capitalize">
                          {selected.assistants[0] || 'Antigravity'}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          Context rules & templates ready
                        </div>
                      </div>
                    </div>

                    {/* Tile 3: Attached Skills */}
                    <div
                      onClick={() => onSelectTab(selected.branchName, 'skills')}
                      className="group p-4 rounded-xl border border-border/80 bg-card/70 hover:bg-card hover:border-primary/40 transition-all cursor-pointer shadow-xs flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                            <Puzzle size={15} />
                          </span>
                          <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Skills & Toolkits</span>
                        </div>
                        <ArrowRight size={13} className="text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
                      </div>
                      <div>
                        <div className="text-2xl font-black font-mono text-foreground">
                          {activeSkills.length} <span className="text-sm font-semibold text-muted-foreground">Active</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-1">
                          {activeSkills.length === 0 ? 'Click to attach capabilities' : 'Reviewers, linters & test suites'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: WORKSPACE DESCRIPTION (IF PRESENT) */}
                  {selected.description && (
                    <Card className="p-5 border-border/80 bg-card/60 backdrop-blur-md rounded-xl">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                        <Zap size={13} className="text-primary" /> Feature Intent & Description
                      </h4>
                      <div className="text-xs sm:text-sm leading-relaxed text-foreground/90">
                        <ChatMarkdown content={selected.description} />
                      </div>
                    </Card>
                  )}

                  {/* SECTION 3: MAPPED REPOSITORIES LIVE MATRIX */}
                  <Card className="border-border/80 bg-card/70 backdrop-blur-md rounded-xl overflow-hidden shadow-xs">
                    <div className="flex items-center justify-between p-4 border-b border-border/60 bg-muted/20">
                      <div className="flex items-center gap-2.5">
                        <FolderGit2 size={16} className="text-primary" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                          Mapped Repositories & Worktrees ({selected.repos.length})
                        </h3>
                      </div>
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
                        <div key={r.name} className="flex items-center justify-between p-4 hover:bg-accent/40 transition-colors text-xs">
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={cn(
                                'size-2.5 rounded-full shrink-0 shadow-xs',
                                r.changedCount === null ? 'bg-muted-foreground' : r.changedCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400',
                              )}
                              title={r.changedCount === null ? 'Status unknown' : r.changedCount > 0 ? `${r.changedCount} uncommitted changes` : 'Clean'}
                            />
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-foreground text-xs sm:text-sm truncate">
                                {r.name}
                              </div>
                              <div className="font-mono text-[10px] text-muted-foreground/80 truncate max-w-md">
                                {r.path}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className={cn(
                              'font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md border',
                              r.changedCount === null
                                ? 'border-border bg-muted/60 text-muted-foreground'
                                : r.changedCount > 0
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            )}>
                              {r.changedCount === null ? '—' : r.changedCount > 0 ? `${r.changedCount} modified` : 'Clean'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* SECTION 4: ACTIVE SKILLS & CAPABILITIES */}
                  <Card className="border-border/80 bg-card/70 backdrop-blur-md rounded-xl p-5 shadow-xs">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Puzzle size={16} className="text-primary" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-foreground">
                          Attached Skills & Capabilities
                        </h3>
                        <span className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold font-mono border',
                          activeSkills.length > 0
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-border/70 bg-muted/60 text-muted-foreground'
                        )}>
                          {activeSkills.length} active
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onSelectTab(selected.branchName, 'skills')}
                        className="text-xs font-semibold gap-1.5 h-8"
                      >
                        <Puzzle size={13} />
                        <span>Configure Skills</span>
                      </Button>
                    </div>

                    {skillsLoading ? (
                      <div className="h-16 rounded-xl bg-muted/40 animate-pulse" />
                    ) : activeSkills.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4 sm:flex sm:items-center sm:justify-between gap-4">
                        <div>
                          <p className="text-xs font-bold text-foreground">No skills attached to this workspace</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Equip the AI assistant with specialized toolkits (PR reviewers, linters, test harnesses).
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => onSelectTab(selected.branchName, 'skills')}
                          className="shrink-0 font-bold mt-2 sm:mt-0 h-8 text-xs"
                        >
                          Attach Skills →
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {activeSkills.map((skill) => (
                          <div
                            key={skill.id}
                            className="flex flex-col justify-between p-3.5 rounded-xl border border-border/80 bg-card/60 hover:bg-card hover:border-primary/30 transition-all shadow-xs gap-2"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="grid size-6 place-items-center rounded-lg bg-primary/15 text-primary shrink-0">
                                  <Puzzle size={12} />
                                </span>
                                <span className="text-xs font-bold text-foreground truncate" title={skill.title || skill.name}>
                                  {skill.title || skill.name}
                                </span>
                              </div>
                              <span
                                className={cn(
                                  'text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-md border shrink-0',
                                  skill.custom
                                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-400'
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
                  </Card>
                </div>
              )}
              {subTab === 'sessions' && (
                <section aria-labelledby="session-history-heading" className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border bg-card shadow-xs">
                    <div>
                      <h2 id="session-history-heading" className="text-sm font-semibold text-foreground">
                        AI Sessions & History
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Inspect recorded session logs, turns, and token usage, or open active conversations in the floating chat.
                      </p>
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => openFloatingChat(selected.branchName)}
                      className="text-xs h-8 gap-1.5 shrink-0 cursor-pointer self-start sm:self-auto"
                      title="Open floating multi-workspace chat"
                    >
                      <Bot className="size-3.5" />
                      <span>Open Floating Chat</span>
                    </Button>
                  </div>
                  <SessionHistory ws={selected} showToast={showToast} {...sessionProps} />
                </section>
              )}
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
    <div className="flex flex-col h-full animate-fade-in w-full min-w-0 bg-transparent">
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
                  Select a workspace from the sidebar to inspect git changes, context, or launch AI assistants.
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
