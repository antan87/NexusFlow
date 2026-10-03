import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils.js';
import { SECTION_LABELS, destinationOf, destinationsFor, entrySection, type WorkspaceDestination, type WorkspaceSection } from './destinations.js';

interface WorkspaceNavProps {
  workspaceId: string;
  section: WorkspaceSection;
  lastVisited: Partial<Record<WorkspaceDestination['id'], WorkspaceSection>>;
  badges?: Partial<Record<WorkspaceDestination['id'] | WorkspaceSection, number>>;
  /** Archived workspaces show only their record. */
  archived?: boolean;
}

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-foreground tabular-nums">{count}</span>;
}

function Destinations({ workspaceId, section, lastVisited, badges = {}, archived = false, inline = false }: WorkspaceNavProps & { inline?: boolean }) {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const destinations = destinationsFor(archived);
  const current = destinations.find((destination) => destination.id === destinationOf(section).id) ?? destinations[0]!;
  return (
    <nav aria-label="Workspace" className={inline ? 'min-w-0' : undefined}>
      <ul className={cn('flex overflow-x-auto', inline ? 'gap-0.5' : '-mb-px gap-1')}>
        {destinations.map((destination) => {
          const active = destination.id === current.id;
          return (
            <li key={destination.id} className="shrink-0">
              <Link
                to={`${base}/${entrySection(destination, lastVisited)}`}
                aria-current={active ? 'page' : undefined}
                title={destination.purpose}
                className={cn(
                  'inline-flex items-center transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                  inline
                    ? cn('h-7 rounded-md px-2.5 text-xs', active ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground')
                    : cn('min-h-10 border-b-2 px-3 text-sm', active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'),
                )}
              >
                {destination.label}
                <Badge count={badges[destination.id]} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The sections of the current destination, when it has more than one: Plan, Documents and so on. */
export function WorkspaceSections({ workspaceId, section, badges = {}, archived = false, className }: Omit<WorkspaceNavProps, 'lastVisited'> & { className?: string }) {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const destinations = destinationsFor(archived);
  const current = destinations.find((destination) => destination.id === destinationOf(section).id) ?? destinations[0]!;
  if (current.sections.length <= 1) return null;
  return (
    <nav aria-label={`${current.label} sections`} className={className ?? 'py-2'}>
      <ul className="flex flex-wrap gap-1">
        {current.sections.map((candidate) => {
          const active = candidate === section;
          return (
            <li key={candidate}>
              <Link
                to={`${base}/${candidate}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-7 items-center rounded-md px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                  active ? 'bg-secondary font-semibold text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                {SECTION_LABELS[candidate]}
                <Badge count={badges[candidate]} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Workspace destinations are links, not tabs: each is a URL, so the browser's
 * back button, deep links and opening in a new window all keep working. On its
 * own it is a row under the header with the sections of the current destination
 * below it. Inline, it is only the destinations, as compact pills for the header's
 * row, and the sections go wherever the page puts them.
 */
export function WorkspaceNav(props: WorkspaceNavProps & { inline?: boolean }) {
  if (props.inline) return <Destinations {...props} />;
  return (
    <div className="border-b border-border bg-card/60 px-4 sm:px-6">
      <Destinations {...props} />
      <WorkspaceSections workspaceId={props.workspaceId} section={props.section} badges={props.badges} archived={props.archived} />
    </div>
  );
}
