import { LayoutDashboard, FolderGit2, Workflow, Boxes, Settings as SettingsIcon, BookOpen, Plus, Sun, Moon, type LucideIcon } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';
import { useTheme } from './ThemeProvider.js';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const ITEMS: NavItem[] = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, match: (p) => p === '/' },
  { label: 'Projects', to: '/projects', icon: FolderGit2, match: (p) => p.startsWith('/projects') },
  { label: 'Workspaces', to: '/workspaces', icon: FolderGit2, match: (p) => p.startsWith('/workspaces') },
  { label: 'Skills & Agents', to: '/skills', icon: Boxes, match: (p) => p.startsWith('/skills') },
  { label: 'Strategies', to: '/workflows', icon: Workflow, match: (p) => p.startsWith('/workflows') || p.startsWith('/strategies') },
  { label: 'Settings', to: '/settings', icon: SettingsIcon, match: (p) => p.startsWith('/settings') },
];


export function AppSidebar({ appVersion }: { appVersion: string }) {
  const { pathname } = useLocation();
  const { theme, setTheme } = useTheme();
  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40 p-4">
      <div className="mb-5 flex items-center gap-2.5 px-2 py-1">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">NF</div>
        <span className="text-sm font-semibold text-foreground">NexusFlow</span>
      </div>

      <Link
        to="/new"
        className="mb-5 inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus size={16} /> Start work
      </Link>

      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <NavLink key={it.to} to={it.to} className={linkClass(it.match(pathname))}>
              <Icon size={16} /> {it.label}
            </NavLink>
          );
        })}
      </nav>

      <NavLink to="/guide" className={linkClass(pathname.startsWith('/guide'))}>
        <BookOpen size={16} /> Getting started
      </NavLink>

      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className={linkClass(false)}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        {theme === 'dark' ? 'Light theme' : 'Dark theme'}
      </button>

      <div className="mt-3 border-t border-border pt-3 text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        NexusFlow{appVersion ? ` v${appVersion}` : ''}
      </div>
    </aside>
  );
}
