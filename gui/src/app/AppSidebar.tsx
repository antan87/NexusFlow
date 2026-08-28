import { useState, useMemo } from 'react';
import {
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
  type LucideIcon,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot, SiCursor } from 'react-icons/si';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../components/ui/menu.js';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { useTheme } from './ThemeProvider.js';
import { useFloatingChat } from '../features/chat/floatingChatStore.js';
import type { Feature, WorkspaceStatus } from '../types.js';

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

export function AppSidebar({
  appVersion,
  workspaces = [],
  workspaceStatuses = {},
  workspacesLoading = false,
  activeWsId = null,
  onSelectWorkspace,
}: AppSidebarProps) {
  const { pathname } = useLocation();
  const { theme, setTheme } = useTheme();
  const { open: openFloatingChat } = useFloatingChat();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<WorkspaceSortOption>('created-desc');

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

  const [toolsExpanded, setToolsExpanded] = useState<boolean>(true);

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

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/60 select-none h-screen overflow-hidden">
      {/* Header */}
      <div className="flex h-12 items-center justify-between px-3 border-b border-border/60">
        <Link to="/overview" className="flex items-center gap-2">
          <div className="grid h-6 w-6 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground shadow-xs">
            CS
          </div>
          <span className="text-xs font-bold tracking-tight text-foreground">ContextSpace</span>
        </Link>
        <span className="text-[10px] font-mono text-muted-foreground/70">v{appVersion}</span>
      </div>

      {/* Top Action & Overview Nav */}
      <div className="p-2.5 pb-1 space-y-1.5">
        <NavLink
          to="/overview"
          className={({ isActive }) =>
            cn(
              'flex h-7.5 items-center gap-2 rounded-md px-2.5 text-xs font-medium transition-colors cursor-pointer',
              isActive || location.pathname === '/'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )
          }
        >
          <Activity size={13} className="shrink-0 text-primary" />
          <span>Overview</span>
        </NavLink>

        <Link
          to="/new"
          className="flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
        >
          <Plus size={14} />
          <span>Start work</span>
        </Link>
      </div>

      {/* Workspaces Section */}
      <div className="flex flex-1 flex-col overflow-hidden px-2">
        {/* Section Header with Declarative Base UI Menu */}
        <div className="flex items-center justify-between px-1 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>Workspaces</span>
            <span className="rounded bg-muted/80 px-1 py-0.2 font-mono text-[10px] text-foreground">
              {filteredWorkspaces.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openFloatingChat()}
              className="flex items-center gap-1 text-[11px] normal-case font-medium text-muted-foreground hover:text-foreground cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors"
              title="Open floating chat window with workspace tabs"
              aria-label="Open floating chat window"
            >
              <Bot size={12} className="text-primary" />
              <span>Chat</span>
            </button>

            {/* Declarative Base UI Order By Menu */}
            <Menu>
              <MenuTrigger className="flex items-center gap-1 text-[11px] normal-case font-medium text-muted-foreground hover:text-foreground cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors">
                <ArrowUpDown size={11} className="opacity-70" />
                <span>{sortLabelMap[sortBy]}</span>
                <ChevronDown size={10} className="opacity-60" />
              </MenuTrigger>
              <MenuPopup align="end" className="w-48">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Order Workspaces By
                </div>
                <MenuItem onClick={() => setSortBy('created-desc')} className="flex items-center justify-between text-xs">
                  <span>Newest created</span>
                  {sortBy === 'created-desc' && <Check size={12} className="text-primary" />}
                </MenuItem>
                <MenuItem onClick={() => setSortBy('created-asc')} className="flex items-center justify-between text-xs">
                  <span>Oldest created</span>
                  {sortBy === 'created-asc' && <Check size={12} className="text-primary" />}
                </MenuItem>
                <MenuItem onClick={() => setSortBy('changes-desc')} className="flex items-center justify-between text-xs">
                  <span>Most changes</span>
                  {sortBy === 'changes-desc' && <Check size={12} className="text-primary" />}
                </MenuItem>
                <MenuItem onClick={() => setSortBy('name-asc')} className="flex items-center justify-between text-xs">
                  <span>Name (A–Z)</span>
                  {sortBy === 'name-asc' && <Check size={12} className="text-primary" />}
                </MenuItem>
                <MenuItem onClick={() => setSortBy('repos-desc')} className="flex items-center justify-between text-xs">
                  <span>Most repos</span>
                  {sortBy === 'repos-desc' && <Check size={12} className="text-primary" />}
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>

        {/* Quick Search */}
        <div className="relative mb-2">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter workspaces..."
            className="h-7 w-full rounded-md border border-border/80 bg-background/80 py-1 pl-6 pr-6 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear filter"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[10px] cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Workspaces List (Sleek Handcrafted Rows) */}
        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
          {workspacesLoading ? (
            <div className="space-y-1.5 py-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-md bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground/80">
              {search ? 'No matches' : 'No workspaces'}
            </div>
          ) : (
            filteredWorkspaces.map((w) => {
              const isSelected = activeWsId === w.branchName;
              const st = workspaceStatuses[w.branchName];
              const hasChanges = Boolean(st && st.changedFiles > 0);
              const hasServices = Boolean(st && st.runningServices > 0);

              return (
                <Link
                  key={w.id}
                  to={`/workspaces/${encodeURIComponent(w.branchName)}`}
                  onClick={() => onSelectWorkspace?.(w.branchName)}
                  className={cn(
                    'group flex flex-col gap-0.5 rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer border border-transparent',
                    isSelected
                      ? 'bg-accent text-foreground font-medium border-border/70 shadow-2xs'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  )}
                >
                  {/* Title & Status indicator */}
                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                    <span className="truncate font-mono tracking-tight font-medium text-foreground">
                      {w.branchName}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Active AI Harness Indicators */}
                      {st?.activeAssistants && st.activeAssistants.length > 0 && (
                        <div className="flex items-center gap-1">
                          {st.activeAssistants.map((ast) => (
                            <span
                              key={ast}
                              className="inline-flex items-center justify-center size-3.5 opacity-75 group-hover:opacity-100 transition-opacity"
                              title={`Active session: ${
                                ast === 'antigravity'
                                  ? 'Antigravity'
                                  : ast === 'claude'
                                  ? 'Claude'
                                  : ast === 'codex'
                                  ? 'Codex'
                                  : ast === 'cursor'
                                  ? 'Cursor'
                                  : 'Copilot'
                              }`}
                            >
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
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-background/80 hover:text-primary transition-all text-muted-foreground cursor-pointer"
                        title={`Open ${w.branchName} in floating chat`}
                        aria-label={`Open ${w.branchName} in floating chat`}
                      >
                        <Bot size={12} />
                      </button>
                      <span
                        className={cn(
                          'size-1.5 rounded-full shrink-0',
                          hasChanges ? 'bg-amber-500' : 'bg-emerald-500'
                        )}
                        title={hasChanges ? `${st!.changedFiles} uncommitted changes` : 'Clean working directory'}
                      />
                    </div>
                  </div>

                  {/* Metadata Subtitle */}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80 font-mono">
                    <span>{w.repos.length} {w.repos.length === 1 ? 'repo' : 'repos'}</span>
                    {hasChanges && (
                      <>
                        <span>•</span>
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">{st!.changedFiles} chg</span>
                      </>
                    )}
                    {hasServices && (
                      <>
                        <span>•</span>
                        <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-0.5 font-semibold">
                          <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                          {st!.runningServices} svc
                        </span>
                      </>
                    )}
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Expandable Tools & Secondary Options */}
      <div className="border-t border-border/60 p-2 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setToolsExpanded((prev) => !prev)}
          className="flex items-center justify-between w-full rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          aria-expanded={toolsExpanded}
        >
          <div className="flex items-center gap-2">
            <SettingsIcon size={13} className="text-muted-foreground/70" />
            <span>Tools & Library</span>
          </div>
          <ChevronDown
            size={12}
            className={cn('transition-transform duration-200 opacity-60', toolsExpanded && 'rotate-180')}
          />
        </button>

        {toolsExpanded && (
          <div className="flex flex-col gap-0.5 pt-1 animate-fade-in">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={linkClass(active)}>
                  <Icon size={13} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <NavLink to="/guide" className={linkClass(pathname.startsWith('/guide'))}>
              <BookOpen size={13} />
              <span>Getting Started</span>
            </NavLink>

            {/* Theme toggle */}
            <button
              type="button"
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
