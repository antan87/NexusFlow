import { LayoutDashboard, FolderGit2, Workflow, Settings as SettingsIcon, BookOpen, Plus, type LucideIcon } from 'lucide-react';
import { cn } from '../components/ui/index.js';

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  match: (p: string) => boolean;
}

const ITEMS: NavItem[] = [
  { label: 'Overview', to: '/', icon: LayoutDashboard, match: (p) => p === '/' },
  { label: 'Workspaces', to: '/workspaces', icon: FolderGit2, match: (p) => p.startsWith('/workspaces') },
  { label: 'Strategies', to: '/strategies', icon: Workflow, match: (p) => p.startsWith('/strategies') },
  { label: 'Settings', to: '/settings', icon: SettingsIcon, match: (p) => p.startsWith('/settings') },
];

export function AppSidebar({
  pathname,
  appVersion,
  onNavigate,
  onNewWorkspace,
}: {
  pathname: string;
  appVersion: string;
  onNavigate: (to: string) => void;
  onNewWorkspace: () => void;
}) {
  const linkClass = (active: boolean) =>
    cn(
      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer',
      active ? 'bg-accent-soft text-accent' : 'text-content-muted hover:bg-raised hover:text-content',
    );

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-hairline bg-surface/40 p-4">
      <div className="mb-5 flex items-center gap-2.5 px-2 py-1">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-accent font-display text-sm font-bold text-white">NF</div>
        <span className="font-display text-sm font-semibold text-content">NexusFlow</span>
      </div>

      <button
        onClick={onNewWorkspace}
        className="mb-5 inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover cursor-pointer"
      >
        <Plus size={16} /> New workspace
      </button>

      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          return (
            <button key={it.to} onClick={() => onNavigate(it.to)} className={linkClass(it.match(pathname))}>
              <Icon size={16} /> {it.label}
            </button>
          );
        })}
      </nav>

      <button onClick={() => onNavigate('/guide')} className={linkClass(pathname.startsWith('/guide'))}>
        <BookOpen size={16} /> Getting started
      </button>

      <div className="mt-3 border-t border-hairline pt-3 text-center text-[10px] font-medium uppercase tracking-wider text-content-faint">
        NexusFlow{appVersion ? ` v${appVersion}` : ''}
      </div>
    </aside>
  );
}
