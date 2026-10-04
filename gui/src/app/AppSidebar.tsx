import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Menu as MenuIcon,
  FolderGit2,
  Workflow,
  Boxes,
  Settings as SettingsIcon,
  BookOpen,
  Plus,
  Sun,
  Moon,
  Search,
  ChevronDown,
  ArrowUpDown,
  Check,
  Activity,
  Users,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  GitBranch,
  type LucideIcon,
} from 'lucide-react';
import { HarnessIcon, harnessName } from '../components/icons/HarnessIcon.js';
import { ContextSpaceIcon } from '../components/icons/ContextSpaceIcon.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/ui/menu.js';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { BRAND_NAME } from '../brand.js';
import { Sheet, SheetPopup, SheetTitle, SheetTrigger } from '../components/ui/sheet.js';
import { useIsMobile, useMediaQuery } from '../components/ui/use-mobile.js';
import { QuickSwitch } from './QuickSwitch.js';
import { useTheme, COLOR_THEMES } from './ThemeProvider.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';
import { useChatThreads } from '../features/chat/useChatThreads.js';
import type { Feature, WorkspaceStatus } from '../types.js';
import { RepositoriesList } from '../features/worktrees/RepositoriesList.js';
import { hasUnpreparedRepo } from '../features/worktrees/normalizeWorktrees.js';
import { normalizeWorktreeGroups } from '../features/worktrees/normalizeWorktrees.js';
import { PrepareRepoDialog } from '../features/worktrees/PrepareRepoDialog.js';
import { useWorkspaceRepositories } from '../lib/api/queries.js';
import { useWorktreeNavigationState } from '../features/worktrees/worktreeStore.js';

export type WorkspaceSortOption =
  | 'created-desc'
  | 'created-asc'
  | 'changes-desc'
  | 'name-asc'
  | 'repos-desc';

interface NavItem {
  label: string;
  description: string;
  to: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const SETUP_ITEMS: NavItem[] = [
  { label: 'Projects', description: 'Saved repository groups', to: '/projects', icon: FolderGit2, match: (p) => p.startsWith('/projects') },
  { label: 'Skills & agents', description: 'Assistant instructions', to: '/skills', icon: Boxes, match: (p) => p.startsWith('/skills') || p.startsWith('/agents') },
];

const ADVANCED_ITEMS: NavItem[] = [
  { label: 'Workrooms', description: 'Coordinate related work', to: '/workrooms', icon: Users, match: (p) => p.startsWith('/workrooms') },
  { label: 'Strategies', description: 'Reusable workflows', to: '/workflows', icon: Workflow, match: (p) => p.startsWith('/workflows') || p.startsWith('/strategies') },
];

export interface AppSidebarProps {
  appVersion: string;
  workspaces?: Feature[];
  workspaceStatuses?: Record<string, WorkspaceStatus>;
  workspacesLoading?: boolean;
  activeWsId?: string | null;
  onSelectWorkspace?: (id: string) => void;
}

function SidebarContents({
  appVersion,
  workspaces = [],
  workspaceStatuses = {},
  workspacesLoading = false,
  activeWsId = null,
  onSelectWorkspace,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const { openCli } = useFloatingChat();
  // Read by the chat while it is on screen; the sidebar shows what it last read and never reads on its own.
  const chatThreads = useChatThreads(workspaces, false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<WorkspaceSortOption>('created-desc');
  const [visibleWorkspaceCount, setVisibleWorkspaceCount] = useState(30);
  // Archived workspaces are records, listed separately so they stay out of the way.
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = useMemo(() => workspaces.filter((w) => w.archivedAt).length, [workspaces]);
  const [appearanceExpanded, setAppearanceExpanded] = useState(false);

  // Worktree & Rail State
  const { isCollapsed: savedCollapsed, toggleCollapsed: toggleSaved } = useWorktreeNavigationState();
  // In a narrow window (split screen, 200% zoom) the rail is the default so the
  // task keeps the room; expanding it there is temporary and leaves the saved choice alone.
  const narrow = useMediaQuery('(min-width: 768px) and (max-width: 999px)');
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const isCollapsed = narrow ? !narrowExpanded : savedCollapsed;
  const toggleCollapsed = useCallback(() => {
    if (narrow) setNarrowExpanded((expanded) => !expanded);
    else toggleSaved();
  }, [narrow, toggleSaved]);
  useEffect(() => { setNarrowExpanded(false); }, [pathname]);

  // Detect if on a workspace route
  const workspaceRouteMatch = pathname.match(/\/workspaces\/([^/]+)/);
  const currentWsId = workspaceRouteMatch ? decodeURIComponent(workspaceRouteMatch[1]!) : activeWsId;
  const isWorkspaceRoute = Boolean(currentWsId);

  const activeWorkspace = useMemo(() => {
    if (!currentWsId) return null;
    return workspaces.find((w) => w.branchName === currentWsId || w.id === currentWsId) || null;
  }, [workspaces, currentWsId]);

  const liveRepositories = useWorkspaceRepositories(activeWorkspace?.branchName ?? null);
  const [preparingRepo, setPreparingRepo] = useState<string | null>(null);
  // The active workspace's repositories are folded away until asked for. Nothing opens them by itself: when one needs
  // preparing for editing, the icon says so with a dot.
  const [repositoriesOpen, setRepositoriesOpen] = useState(false);
  const activeBranch = activeWorkspace?.branchName;
  useEffect(() => { setRepositoriesOpen(false); }, [activeBranch]);
  const repoGroups = useMemo(() => {
    if (!activeWorkspace) return [];
    return normalizeWorktreeGroups(activeWorkspace, workspaceStatuses[activeWorkspace.branchName], liveRepositories.data);
  }, [activeWorkspace, workspaceStatuses, liveRepositories.data]);
  const needsPreparing = !activeWorkspace?.archivedAt && hasUnpreparedRepo(repoGroups);

  // Keyboard shortcut for toggling rail (Z or [)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'z' || e.key === 'Z' || e.key === '[') {
        toggleCollapsed();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleCollapsed]);

  const filteredWorkspaces = useMemo(() => {
    let list = workspaces.filter((w) => Boolean(w.archivedAt) === showArchived);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((w) => `${w.name ?? ''} ${w.branchName} ${w.description}`.toLowerCase().includes(q));
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case 'created-desc': {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return bTime - aTime;
        }
        case 'created-asc': {
          const aTime = new Date(a.createdAt || 0).getTime();
          const bTime = new Date(b.createdAt || 0).getTime();
          return aTime - bTime;
        }
        case 'changes-desc': {
          const aChg = workspaceStatuses[a.branchName]?.changedFiles || 0;
          const bChg = workspaceStatuses[b.branchName]?.changedFiles || 0;
          return bChg - aChg;
        }
        case 'repos-desc': {
          return (b.repos?.length || 0) - (a.repos?.length || 0);
        }
        case 'name-asc': {
          return (a.name || a.branchName).localeCompare(b.name || b.branchName);
        }
        default:
          return 0;
      }
    });
  }, [workspaces, search, sortBy, workspaceStatuses, showArchived]);

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer',
      active ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

  const sortLabelMap: Record<WorkspaceSortOption, string> = {
    'created-desc': 'Newest',
    'created-asc': 'Oldest',
    'changes-desc': 'Changes',
    'name-asc': 'A–Z',
    'repos-desc': 'Repos',
  };

  // ─── COLLAPSED RAIL MODE (56px / w-14) ─────────────────────────────────────
  if (isCollapsed) {
    return (
      <aside className="context-sidebar flex w-14 shrink-0 flex-col border-r border-border bg-card select-none h-screen overflow-hidden transition-[width] duration-200 items-center py-3 justify-between z-30">
        {/* Top Icons */}
        <div className="flex flex-col items-center gap-3">
          <Link to="/overview" aria-label={`${BRAND_NAME} overview`} title={`${BRAND_NAME} v${appVersion}`}>
            <ContextSpaceIcon size={24} className="rounded-md shadow-xs hover:scale-105 transition-transform" />
          </Link>

          <NavLink
            to="/overview"
            aria-label="Overview Activity"
            title="Overview Activity"
            className={({ isActive }) =>
              cn(
                'p-2 rounded-lg transition-colors cursor-pointer',
                isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              )
            }
          >
            <Activity size={16} />
          </NavLink>

          <NavLink
            to="/new"
            aria-label="Start new work"
            title="Start new work"
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Plus size={16} />
          </NavLink>

          {isWorkspaceRoute && (
            <div className="my-1 w-6 border-t border-border/60" />
          )}

          {isWorkspaceRoute && activeWorkspace && (
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={`Active Workspace: ${activeWorkspace.branchName} (Click to expand)`}
              title={`Active Workspace: ${activeWorkspace.branchName} (Click to expand)`}
              className="relative p-2 rounded-lg bg-primary/15 text-primary border border-primary/30 cursor-pointer hover:bg-primary/25 transition-colors"
            >
              <FolderGit2 size={16} />
              {(workspaceStatuses[activeWorkspace.branchName]?.changedFiles ?? 0) > 0 && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          )}
        </div>

        {/* Bottom Expand Control */}
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand Cockpit Sidebar (Shortcut: z)"
            title="Expand Cockpit Sidebar (Shortcut: z)"
            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 border border-border/50 transition-colors cursor-pointer"
          >
            <PanelLeftOpen size={16} />
          </button>
        </div>
      </aside>
    );
  }

  // ─── EXPANDED COCKPIT MODE (240px / w-60) ──────────────────────────────────
  return (
    <aside className="context-sidebar flex w-64 shrink-0 flex-col border-r border-border bg-card select-none h-screen overflow-hidden transition-[width] duration-200">
      {/* Top Header */}
      <div className="flex h-11 items-center justify-between px-3 border-b border-border/60">
        <Link to="/overview" className="flex items-center gap-2 group">
          <ContextSpaceIcon size={22} className="rounded-md shadow-xs transition-transform duration-200 group-hover:scale-105" />
          <span className="text-xs font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
            {BRAND_NAME}
          </span>
        </Link>
        <span className="text-[10px] font-mono text-muted-foreground">v{appVersion}</span>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
        {(
          /* ─── WORKSPACE LIST ─────────────────────────────────────────────
             Always shown, on a workspace page too, so moving between workspaces never
             means going back first. The active one is marked, and its repositories and
             branches are one disclosure away instead of replacing the list. */
          <div className="flex flex-col gap-2 min-w-0">
            {/* QuickSwitch */}
            <QuickSwitch workspaces={workspaces} />

            {/* Top Nav Actions */}
            <div className="flex flex-col gap-0.5">
              <NavLink to="/overview" aria-label="Overview" className={({ isActive }) => linkClass(isActive)}>
                <Activity size={14} />
                <span className="min-w-0"><span className="block">Overview</span><span className="block text-[10px] font-normal text-muted-foreground">Pick up where you left off</span></span>
              </NavLink>
              <NavLink to="/new" aria-label="New workspace" className={({ isActive }) => linkClass(isActive)}>
                <Plus size={14} />
                <span className="min-w-0"><span className="block">New workspace</span><span className="block text-[10px] font-normal text-muted-foreground">Start a task with your repos</span></span>
              </NavLink>
            </div>

            {/* Workspaces Section */}
            <div className="pt-2 border-t border-border/60">
              <div className="flex items-center justify-between pb-1 px-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {showArchived ? 'Archived workspaces' : 'Workspaces'}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {showArchived ? archivedCount : workspaces.length - archivedCount}
                </span>
              </div>

              {/* Filter Search & Sort */}
              <div className="flex items-center gap-1 mb-2">
                <div className="relative flex-1">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setVisibleWorkspaceCount(30); }}
                    placeholder="Filter..."
                    className="w-full rounded-md border border-border/60 bg-muted/30 pl-6 pr-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:bg-background focus:outline-hidden focus:ring-1 focus:ring-primary"
                  />
                </div>

                <Menu>
                  <MenuTrigger
                    aria-label="Sort workspaces"
                    className="inline-flex size-6 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
                  >
                    <ArrowUpDown size={11} />
                  </MenuTrigger>
                  <MenuPopup side="bottom" align="end" className="w-36 text-xs">
                    {(Object.keys(sortLabelMap) as WorkspaceSortOption[]).map((key) => (
                      <MenuItem key={key} onClick={() => { setSortBy(key); setVisibleWorkspaceCount(30); }} className="flex items-center justify-between">
                        <span>{sortLabelMap[key]}</span>
                        {sortBy === key && <Check size={12} className="text-primary" />}
                      </MenuItem>
                    ))}
                  </MenuPopup>
                </Menu>
              </div>

              {/* Workspaces Rows */}
              <div className="flex flex-col gap-1">
                {workspacesLoading && workspaces.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground italic">
                    Loading workspaces...
                  </div>
                ) : filteredWorkspaces.length === 0 ? (
                  <div className="px-2 py-3 text-center text-xs text-muted-foreground italic">
                    {search.trim() ? 'No workspaces match' : showArchived ? 'No archived workspaces' : 'No active workspaces'}
                  </div>
                ) : (
                  filteredWorkspaces.slice(0, visibleWorkspaceCount).map((w) => {
                    const isSelected = activeWsId === w.branchName || activeWsId === w.id;
                    const st = workspaceStatuses[w.branchName];
                    const hasChanges = Boolean(st && st.changedFiles > 0);
                    // A workspace with an open chat says what the chat is working on, and when it needs you.
                    const thread = chatThreads.summaries.get(w.branchName);
                    const needsYou = thread?.tone === 'needs' ? thread.label : '';
                    const showRepositories = isSelected && repositoriesOpen && Boolean(activeWorkspace);

                    return (
                      <div key={w.id}>
                      <div
                        className={cn(
                          'group flex items-start gap-1 rounded-md px-2.5 py-1.5 text-xs transition-colors border',
                          isSelected
                            ? 'bg-accent text-foreground font-medium border-border/70 shadow-2xs'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground border-transparent'
                        )}
                      >
                        <Link
                          to={`/workspaces/${encodeURIComponent(w.branchName)}`}
                          onClick={() => onSelectWorkspace?.(w.branchName)}
                          aria-current={isSelected ? 'page' : undefined}
                          className="flex min-w-0 flex-1 flex-col gap-0.5"
                        >
                          <span className="truncate font-medium text-foreground" title={w.name || w.branchName}>
                            {w.name || w.branchName}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                            {thread && (thread.goal || needsYou) ? (
                              <>
                                {needsYou && <span className="state-chip shrink-0" data-tone="needs">{needsYou}</span>}
                                {thread.goal && <span className="truncate" title={thread.goal}>{thread.goal}</span>}
                              </>
                            ) : (
                              <>
                                {w.name && <span className="truncate font-mono" title={w.branchName}>{w.branchName}</span>}
                                {!w.name && w.description && <span className="truncate" title={w.description}>{w.description}</span>}
                                <span>{w.repos.length} {w.repos.length === 1 ? 'repo' : 'repos'}</span>
                              </>
                            )}
                            {w.archivedAt && <span className="font-semibold">archived</span>}
                            {hasChanges && <span className="text-warning-foreground font-semibold">• ±{st!.changedFiles}</span>}
                          </span>
                        </Link>
                        <div className="flex items-center gap-1 shrink-0">
                          {st?.activeAssistants && st.activeAssistants.length > 0 && (
                            <div className="flex items-center gap-1">
                              {st.activeAssistants.map((ast) => (
                                <span key={ast} title={harnessName(ast)} className="inline-flex size-3.5 opacity-75">
                                  <HarnessIcon harness={ast} className="size-3" />
                                </span>
                              ))}
                            </div>
                          )}
                          {isSelected && activeWorkspace && (
                            <button
                              type="button"
                              onClick={() => setRepositoriesOpen((open) => !open)}
                              aria-expanded={repositoriesOpen}
                              className="relative p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                              title={needsPreparing ? 'Repositories and branches: one is still your own checkout and needs preparing before it can be edited' : 'Repositories and branches'}
                              aria-label={`${repositoriesOpen ? 'Hide' : 'Show'} repositories and branches for ${w.branchName}`}
                            >
                              <GitBranch size={12} aria-hidden="true" />
                              {needsPreparing && <span aria-hidden="true" className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-amber-500" />}
                            </button>
                          )}
                          {!w.archivedAt && (
                            <button
                              type="button"
                              onClick={() => openCli(w.branchName)}
                              className="p-1 rounded hover:bg-background text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
                              title={`Resume CLI chat for ${w.branchName}`}
                              aria-label={`Resume CLI chat for ${w.branchName}`}
                            >
                              <History size={12} aria-hidden="true" />
                            </button>
                          )}
                          <span
                            className={cn(
                              'size-1.5 rounded-full shrink-0',
                              hasChanges ? 'bg-amber-500' : 'bg-emerald-500'
                            )}
                          />
                        </div>
                      </div>
                      {showRepositories && activeWorkspace && (
                        <div className="mt-1 mb-1 ml-2 border-l border-border/60 pl-2">
                          <RepositoriesList
                            groups={repoGroups}
                            onPrepare={activeWorkspace.archivedAt ? undefined : (repoName) => setPreparingRepo(repoName)}
                          />
                        </div>
                      )}
                      </div>
                    );
                  })
                )}
              </div>
              {filteredWorkspaces.length > visibleWorkspaceCount && (
                <button type="button" className="mt-2 w-full rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setVisibleWorkspaceCount((count) => count + 30)}>
                  Show more workspaces ({filteredWorkspaces.length - visibleWorkspaceCount} remaining)
                </button>
              )}
              {(archivedCount > 0 || showArchived) && (
                <button
                  type="button"
                  aria-pressed={showArchived}
                  className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => { setShowArchived((shown) => !shown); setVisibleWorkspaceCount(30); }}
                >
                  {showArchived ? 'Back to active workspaces' : `Show archived (${archivedCount})`}
                </button>
              )}
            </div>
          </div>
        )}

        {activeWorkspace && <PrepareRepoDialog wsId={activeWorkspace.branchName} repoName={preparingRepo} onClose={() => setPreparingRepo(null)} />}

        <div className="border-t border-border/60 pt-2">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reusable setup</p>
          {SETUP_ITEMS.map((item) => {
            const Icon = item.icon;
            return <NavLink key={item.to} to={item.to} aria-label={item.label} className={linkClass(item.match(pathname))}>
              <Icon size={14} />
              <span className="min-w-0"><span className="block">{item.label}</span><span className="block text-[10px] font-normal text-muted-foreground">{item.description}</span></span>
            </NavLink>;
          })}
          <p className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Advanced tools</p>
          {ADVANCED_ITEMS.map((item) => {
            const Icon = item.icon;
            return <NavLink key={item.to} to={item.to} aria-label={item.label} className={linkClass(item.match(pathname))}>
              <Icon size={14} />
              <span className="min-w-0"><span className="block">{item.label}</span><span className="block text-[10px] font-normal text-muted-foreground">{item.description}</span></span>
            </NavLink>;
          })}
        </div>

        <div className="mt-auto border-t border-border/60 pt-2">
          <NavLink to="/settings" aria-label="Settings" className={linkClass(pathname.startsWith('/settings'))}>
            <SettingsIcon size={14} /><span>Settings</span>
          </NavLink>
          <a href="https://github.com/antan87/NexusFlow#readme" target="_blank" rel="noreferrer"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <BookOpen size={14} /><span>Guide</span>
          </a>
          <button type="button" onClick={() => setAppearanceExpanded((open) => !open)} aria-expanded={appearanceExpanded}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <span>Appearance</span><ChevronDown size={13} className={cn('transition-transform', appearanceExpanded && 'rotate-180')} />
          </button>
          {appearanceExpanded && <div className="space-y-2 p-2">
            <div className="grid grid-cols-5 gap-1">
              {COLOR_THEMES.map((palette) => <button key={palette.id} type="button" onClick={() => setColorTheme(palette.id)}
                aria-label={`Switch to ${palette.label} palette`} aria-pressed={colorTheme === palette.id}
                title={`${palette.label} palette — ${palette.description}`}
                className={cn('flex flex-col items-center gap-1 rounded p-1 text-[10px]', colorTheme === palette.id ? 'bg-accent ring-1 ring-border' : 'hover:bg-accent/60')}>
                <span className={cn('size-2 rounded-full', palette.dotClass)} />{palette.label}
              </button>)}
            </div>
            <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground">
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>}
        </div>
      </div>

      {/* Bottom Footer: Rail Collapse Control */}
      <div className="h-9 px-3 border-t border-border/60 flex items-center justify-between text-xs text-muted-foreground bg-muted/20">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer text-[11px]"
          title="Collapse rail into icon strip (Shortcut: z)"
        >
          <PanelLeftClose size={13} />
          <span>Collapse (z)</span>
        </button>

        <span className="font-mono text-[10px] text-muted-foreground">256px</span>
      </div>
    </aside>
  );
}

export function AppSidebar(props: AppSidebarProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!isMobile) return <SidebarContents {...props} />;

  return (
    <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-border bg-card px-3 md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium" aria-label="Open navigation">
          <MenuIcon size={20} /> {BRAND_NAME}
        </SheetTrigger>
        <SheetPopup
          side="left"
          className="w-72"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setOpen(false);
          }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarContents
            {...props}
            onSelectWorkspace={(id) => {
              props.onSelectWorkspace?.(id);
              setOpen(false);
            }}
          />
        </SheetPopup>
      </Sheet>
    </div>
  );
}
