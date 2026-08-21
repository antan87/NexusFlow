import { useState, useMemo, useRef, useEffect } from 'react';
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
  type LucideIcon,
} from 'lucide-react';
import { BsOpenai } from 'react-icons/bs';
import { SiClaude, SiGithubcopilot } from 'react-icons/si';
import { AntigravityIcon } from '../components/icons/AntigravityIcon.js';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { useTheme } from './ThemeProvider.js';
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

const formatWorkspaceDate = (createdAtStr?: string) => {
  if (!createdAtStr) return '';
  const d = new Date(createdAtStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = now.toDateString() === d.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = yesterday.toDateString() === d.toDateString();

  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (isYesterday) {
    return 'Yesterday';
  }
  if (now.getFullYear() === d.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
};

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
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<WorkspaceSortOption>('created-desc');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sortMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [sortMenuOpen]);

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

  const isSecondaryRoute = pathname.startsWith('/projects')
    || pathname.startsWith('/skills')
    || pathname.startsWith('/agents')
    || pathname.startsWith('/workflows')
    || pathname.startsWith('/strategies')
    || pathname.startsWith('/settings')
    || pathname.startsWith('/guide');

  const [toolsExpanded, setToolsExpanded] = useState<boolean>(isSecondaryRoute);

  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer',
      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

  const sortLabelMap: Record<WorkspaceSortOption, string> = {
    'created-desc': 'Newest',
    'created-asc': 'Oldest',
    'changes-desc': 'Changes',
    'name-asc': 'A–Z',
    'repos-desc': 'Repos',
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40 p-3 select-none h-screen overflow-hidden">
      {/* Brand Header */}
      <div className="mb-2.5 flex items-center justify-between px-1">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground shadow-xs">
            NF
          </div>
          <span className="text-sm font-bold tracking-tight text-foreground">NexusFlow</span>
        </Link>
        <span className="text-[10px] font-mono text-muted-foreground/80">v{appVersion}</span>
      </div>

      {/* Start Work Action Button */}
      <Link
        to="/new"
        className="mb-3 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow"
      >
        <Plus size={15} /> Start work
      </Link>

      {/* Workspaces Section (Default) */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span>Workspaces</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
              {filteredWorkspaces.length}
            </span>
          </div>

          {/* Sleek Bulletproof Order By Menu */}
          <div className="relative" ref={sortMenuRef}>
            <button
              type="button"
              onClick={() => setSortMenuOpen((prev) => !prev)}
              className="flex items-center gap-1 text-[10px] normal-case font-medium text-muted-foreground hover:text-foreground cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted/70 transition-colors border border-transparent hover:border-border/60"
              title="Change workspace sort order"
              aria-expanded={sortMenuOpen}
            >
              <ArrowUpDown size={11} className="opacity-80" />
              <span>{sortLabelMap[sortBy]}</span>
              <ChevronDown size={10} className={cn('opacity-60 transition-transform duration-150', sortMenuOpen && 'rotate-180')} />
            </button>

            {sortMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-44 z-50 rounded-lg border border-border bg-popover p-1 shadow-lg text-foreground animate-fade-in">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Order Workspaces By
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSortBy('created-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'created-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>📅 Newest created</span>
                  {sortBy === 'created-desc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('created-asc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'created-asc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>⏳ Oldest created</span>
                  {sortBy === 'created-asc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('changes-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'changes-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>🟡 Most changes</span>
                  {sortBy === 'changes-desc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('name-asc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'name-asc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>🔤 Name (A–Z)</span>
                  {sortBy === 'name-asc' && <Check size={12} className="text-primary" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSortBy('repos-desc');
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs text-left cursor-pointer transition-colors hover:bg-accent hover:text-accent-foreground',
                    sortBy === 'repos-desc' && 'font-semibold text-primary bg-primary/10'
                  )}
                >
                  <span>📁 Most repos</span>
                  {sortBy === 'repos-desc' && <Check size={12} className="text-primary" />}
                </button>
              </div>
            )}
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
            className="w-full rounded-md border border-border/80 bg-background/80 py-1 pl-6 pr-6 text-xs text-foreground placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-[10px] cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {/* Workspaces List (Outlook Compact Items) */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
          {workspacesLoading ? (
            <div className="space-y-1.5 py-1">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : filteredWorkspaces.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {search ? 'No matching workspaces' : 'No active workspaces'}
            </div>
          ) : (
            filteredWorkspaces.map((w) => {
              const st = workspaceStatuses[w.branchName];
              const active = activeWsId === w.branchName;
              const hasChanges = Boolean(st && st.changedFiles > 0);
              const hasServices = Boolean(st && st.runningServices > 0);
              const dateLabel = formatWorkspaceDate(w.createdAt);

              return (
                <Link
                  key={w.id}
                  to={`/workspaces/${encodeURIComponent(w.branchName)}`}
                  onClick={() => onSelectWorkspace?.(w.branchName)}
                  className={cn(
                    'group relative flex flex-col gap-1 rounded-lg border p-2 text-left transition-all cursor-pointer select-none',
                    active
                      ? 'border-primary/50 bg-primary/10 shadow-xs ring-1 ring-primary/20'
                      : 'border-border/60 bg-card/60 hover:border-border hover:bg-accent/40',
                  )}
                >
                  {/* Left Status Strip */}
                  <span
                    className={cn(
                      'absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r transition-colors',
                      active
                        ? 'bg-primary'
                        : hasChanges
                          ? 'bg-amber-500'
                          : 'bg-emerald-500',
                    )}
                  />

                  {/* Header: Name + Date */}
                  <div className="flex items-center justify-between gap-1.5 pl-1.5">
                    <span className="truncate font-mono text-xs font-bold text-foreground" title={w.branchName}>
                      {w.branchName}
                    </span>
                    {dateLabel && (
                      <span className="shrink-0 text-[10px] font-medium text-muted-foreground/80" title={`Created: ${w.createdAt}`}>
                        {dateLabel}
                      </span>
                    )}
                  </div>

                  {/* Metrics Row */}
                  <div className="flex flex-wrap items-center gap-1 pl-1.5 text-[10px]">
                    {hasChanges ? (
                      <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 font-semibold text-amber-500">
                        <span className="size-1 rounded-full bg-amber-500" />
                        {st!.changedFiles} chg
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-0.5 font-medium text-emerald-500">
                        <span className="size-1 rounded-full bg-emerald-500" />
                        Clean
                      </span>
                    )}

                    {/* AI Icons */}
                    {w.assistants?.map((ast) => (
                      <span key={ast} className="inline-flex items-center" title={`Configured AI: ${ast}`}>
                        {ast === 'antigravity' ? (
                          <AntigravityIcon className="size-3.5" />
                        ) : ast === 'claude' ? (
                          <span className="grid size-3.5 place-items-center rounded bg-[#D97757] text-white shadow-2xs">
                            <SiClaude className="size-2" />
                          </span>
                        ) : ast === 'codex' ? (
                          <span className="grid size-3.5 place-items-center rounded bg-foreground text-background shadow-2xs">
                            <BsOpenai className="size-2" />
                          </span>
                        ) : ast === 'copilot' ? (
                          <span className="grid size-3.5 place-items-center rounded bg-gradient-to-tr from-purple-600 via-indigo-500 to-blue-600 text-white shadow-2xs">
                            <SiGithubcopilot className="size-2" />
                          </span>
                        ) : null}
                      </span>
                    ))}

                    {/* Services */}
                    {hasServices && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-0.5 font-mono text-emerald-500">
                        <span className="size-1 rounded-full bg-emerald-500 animate-pulse" />
                        {st!.runningServices} svc
                      </span>
                    )}

                    {/* Repos count */}
                    <span className="ml-auto text-[9px] text-muted-foreground/80 font-mono">
                      {w.repos.length} {w.repos.length === 1 ? 'repo' : 'repos'}
                    </span>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Expandable Tools & Secondary Options (Collapsed by default to maximize Workspaces space) */}
      <div className="mt-2 border-t border-border pt-1.5 flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => setToolsExpanded((prev) => !prev)}
          className="flex items-center justify-between w-full rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
          aria-expanded={toolsExpanded}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs">⚙️</span>
            <span>More & Tools</span>
          </div>
          <ChevronDown
            size={13}
            className={cn('transition-transform duration-200 opacity-70', toolsExpanded && 'rotate-180')}
          />
        </button>

        {toolsExpanded && (
          <div className="flex flex-col gap-0.5 pt-1 animate-fade-in">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <NavLink key={item.to} to={item.to} className={linkClass(active)}>
                  <Icon size={14} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <NavLink to="/guide" className={linkClass(pathname.startsWith('/guide'))}>
              <BookOpen size={14} />
              <span>Getting Started</span>
            </NavLink>

            {/* Theme toggle */}
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
