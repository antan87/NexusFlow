import { useState, useMemo, useEffect } from 'react';
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
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  type LucideIcon,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot, SiCursor } from 'react-icons/si';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import { ContextSpaceIcon } from '../components/icons/ContextSpaceIcon.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/ui/menu.js';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { BRAND_NAME } from '../brand.js';
import { Sheet, SheetPopup, SheetTitle, SheetTrigger } from '../components/ui/sheet.js';
import { useIsMobile } from '../components/ui/use-mobile.js';
import { QuickSwitch } from './QuickSwitch.js';
import { useTheme } from './ThemeProvider.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';
import type { Feature, WorkspaceStatus } from '../types.js';
import { WorktreePicker } from '../features/worktrees/WorktreePicker.js';
import { normalizeWorktreeGroups } from '../features/worktrees/normalizeWorktrees.js';
import { useWorktreeNavigationState } from '../features/worktrees/worktreeStore.js';
import { useCockpitStore } from '../features/cockpit/cockpitStore.js';

export type WorkspaceSortOption =
  | 'created-desc'
  | 'created-asc'
  | 'changes-desc'
  | 'name-asc'
  | 'repos-desc';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Projects', to: '/projects', icon: FolderGit2, match: (p) => p.startsWith('/projects') },
  { label: 'Workrooms', to: '/workrooms', icon: Users, match: (p) => p.startsWith('/workrooms') },
  { label: 'Resource Library', to: '/skills', icon: Boxes, match: (p) => p.startsWith('/skills') || p.startsWith('/agents') },
  { label: 'Strategies', to: '/workflows', icon: Workflow, match: (p) => p.startsWith('/workflows') || p.startsWith('/strategies') },
  { label: 'Settings', to: '/settings', icon: SettingsIcon, match: (p) => p.startsWith('/settings') },
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
  const navigate = useNavigate();
  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();
  const { open: openFloatingChat } = useFloatingChat();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<WorkspaceSortOption>('created-desc');
  const [toolsExpanded, setToolsExpanded] = useState<boolean>(false);

  // Worktree & Rail State
  const { isCollapsed, toggleCollapsed, customTitles, updateTitle } = useWorktreeNavigationState();
  const cockpit = useCockpitStore();

  // Detect if on a workspace route
  const workspaceRouteMatch = pathname.match(/\/workspaces\/([^/]+)/);
  const currentWsId = workspaceRouteMatch ? decodeURIComponent(workspaceRouteMatch[1]!) : activeWsId;
  const isWorkspaceRoute = Boolean(currentWsId);

  const activeWorkspace = useMemo(() => {
    if (!currentWsId) return null;
    return workspaces.find((w) => w.branchName === currentWsId || w.id === currentWsId) || null;
  }, [workspaces, currentWsId]);

  const repoGroups = useMemo(() => {
    if (!activeWorkspace) return [];
    return normalizeWorktreeGroups(activeWorkspace, workspaceStatuses[activeWorkspace.branchName]);
  }, [activeWorkspace, workspaceStatuses]);

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
    let list = workspaces;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((w) => `${w.branchName} ${w.description}`.toLowerCase().includes(q));
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
          return a.branchName.localeCompare(b.branchName);
        }
        default:
          return 0;
      }
    });
  }, [workspaces, search, sortBy, workspaceStatuses]);

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
          <Link to="/overview" title={`${BRAND_NAME} v${appVersion}`}>
            <ContextSpaceIcon size={24} className="rounded-md shadow-xs hover:scale-105 transition-transform" />
          </Link>

          <NavLink
            to="/overview"
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
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
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
    <aside className="context-sidebar flex w-60 shrink-0 flex-col border-r border-border bg-card select-none h-screen overflow-hidden transition-[width] duration-200">
      {/* Top Header */}
      <div className="flex h-11 items-center justify-between px-3 border-b border-border/60">
        <Link to="/overview" className="flex items-center gap-2 group">
          <ContextSpaceIcon size={22} className="rounded-md shadow-xs transition-transform duration-200 group-hover:scale-105" />
          <span className="text-xs font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">
            {BRAND_NAME}
          </span>
        </Link>
        <span className="text-[10px] font-mono text-muted-foreground/60">v{appVersion}</span>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2">
        {isWorkspaceRoute && activeWorkspace ? (
          /* ─── WORKSPACE-IN-CONTEXT DRILL-DOWN (R1) ─────────────────────── */
          <div className="flex flex-col gap-3 min-w-0">
            {/* Back to all workspaces link */}
            <button
              type="button"
              onClick={() => navigate('/overview')}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 px-2 py-1 rounded transition-colors cursor-pointer"
            >
              <ArrowLeft size={12} />
              <span>All Workspaces</span>
            </button>

            {/* Active Workspace Identity Card */}
            <div className="p-2.5 rounded-lg border border-border/60 bg-muted/20 flex flex-col gap-1">
              <div className="text-xs font-semibold text-foreground truncate" title={activeWorkspace.description || activeWorkspace.branchName}>
                {cockpit.workspaceTitle || activeWorkspace.description || activeWorkspace.branchName}
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground truncate">
                <span className="truncate">{activeWorkspace.branchName}</span>
                <span>•</span>
                <span>{activeWorkspace.repos.length} repos</span>
              </div>
            </div>

            {/* Worktree Hierarchy Picker */}
            <WorktreePicker
              repoGroups={repoGroups}
              activeWorktreeId={cockpit.activeWorktreeId}
              onSelectWorktree={(wt) => cockpit.selectWorktree(wt.id)}
              customTitles={customTitles}
              onUpdateWorktreeTitle={(wtId, title, intent) => {
                updateTitle(wtId, title, intent);
              }}
              onNewWorktree={(repoName) => {
                navigate(`/new?repo=${encodeURIComponent(repoName)}`);
              }}
            />
          </div>
        ) : (
          /* ─── GLOBAL WORKSPACE SWITCHER LIST ───────────────────────────── */
          <div className="flex flex-col gap-2 min-w-0">
            {/* QuickSwitch */}
            <QuickSwitch workspaces={workspaces} />

            {/* Top Nav Actions */}
            <div className="flex flex-col gap-0.5">
              <NavLink to="/overview" className={({ isActive }) => linkClass(isActive)}>
                <Activity size={14} />
                <span>Overview</span>
              </NavLink>
              <NavLink to="/new" className={({ isActive }) => linkClass(isActive)}>
                <Plus size={14} />
                <span>Start work</span>
              </NavLink>
            </div>

            {/* Workspaces Section */}
            <div className="pt-2 border-t border-border/60">
              <div className="flex items-center justify-between pb-1 px-1">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Workspaces
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/80">
                  {workspaces.length}
                </span>
              </div>

              {/* Filter Search & Sort */}
              <div className="flex items-center gap-1 mb-2">
                <div className="relative flex-1">
                  <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
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
                      <MenuItem key={key} onClick={() => setSortBy(key)} className="flex items-center justify-between">
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
                    No workspaces match
                  </div>
                ) : (
                  filteredWorkspaces.map((w) => {
                    const isSelected = activeWsId === w.branchName || activeWsId === w.id;
                    const st = workspaceStatuses[w.branchName];
                    const hasChanges = Boolean(st && st.changedFiles > 0);

                    return (
                      <Link
                        key={w.id}
                        to={`/workspaces/${encodeURIComponent(w.branchName)}`}
                        onClick={() => onSelectWorkspace?.(w.branchName)}
                        className={cn(
                          'group flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer border',
                          isSelected
                            ? 'bg-accent text-foreground font-medium border-border/70 shadow-2xs'
                            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground border-transparent'
                        )}
                      >
                        <div className="flex items-center justify-between gap-1.5 min-w-0">
                          <span className="truncate font-mono tracking-tight font-medium text-foreground">
                            {w.branchName}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {st?.activeAssistants && st.activeAssistants.length > 0 && (
                              <div className="flex items-center gap-1">
                                {st.activeAssistants.map((ast) => (
                                  <span key={ast} className="inline-flex size-3.5 opacity-75">
                                    {ast === 'antigravity' ? (
                                      <AntigravityIcon className="size-3" />
                                    ) : ast === 'claude' ? (
                                      <SiClaude className="size-2.5 text-[#D97757]" />
                                    ) : ast === 'codex' ? (
                                      <BsOpenai className="size-2.5 text-foreground" />
                                    ) : ast === 'cursor' ? (
                                      <SiCursor className="size-2.5 text-foreground" />
                                    ) : (
                                      <SiGithubcopilot className="size-2.5 text-blue-400" />
                                    )}
                                  </span>
                                ))}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                openFloatingChat(w.branchName);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background text-muted-foreground"
                              title="Open floating chat"
                            >
                              <Bot size={11} />
                            </button>
                            <span
                              className={cn(
                                'size-1.5 rounded-full shrink-0',
                                hasChanges ? 'bg-amber-500' : 'bg-emerald-500'
                              )}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/80 font-mono">
                          <span>{w.repos.length} {w.repos.length === 1 ? 'repo' : 'repos'}</span>
                          {hasChanges && (
                            <>
                              <span>•</span>
                              <span className="text-amber-500 font-semibold">±{st!.changedFiles}</span>
                            </>
                          )}
                        </div>
                      </Link>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tools & Library Accordion */}
        <div className="mt-auto pt-2 border-t border-border/60">
          <button
            type="button"
            onClick={() => setToolsExpanded(!toolsExpanded)}
            className="flex w-full items-center justify-between px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors cursor-pointer"
          >
            <span>Tools & Library</span>
            <ChevronDown size={12} className={cn('transition-transform duration-200', !toolsExpanded && '-rotate-90')} />
          </button>

          {toolsExpanded && (
            <div className="flex flex-col gap-0.5 mt-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = item.match(pathname);
                return (
                  <NavLink key={item.to} to={item.to} className={linkClass(active)}>
                    <Icon size={13} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}

              <a
                href="https://github.com/antan87/NexusFlow#readme"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <BookOpen size={13} />
                <span>Guide</span>
              </a>

              {/* Color Theme Switcher */}
              <button
                type="button"
                onClick={() => setColorTheme(colorTheme === 'aurora' ? 'sunset' : 'aurora')}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                <span className="size-2 rounded-full bg-primary" />
                <span>Theme: {colorTheme === 'aurora' ? 'Aurora' : 'Sunset'}</span>
              </button>

              {/* Dark/Light mode */}
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
              >
                {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
                <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
            </div>
          )}
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

        <span className="font-mono text-[10px] text-muted-foreground/50">240px</span>
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
