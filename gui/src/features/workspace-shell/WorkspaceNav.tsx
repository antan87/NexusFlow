import { Link } from 'react-router-dom';
import { cn } from '../../lib/utils.js';
import { SECTION_LABELS, WORKSPACE_DESTINATIONS, destinationOf, entrySection, type WorkspaceDestination, type WorkspaceSection } from './destinations.js';

interface WorkspaceNavProps {
  workspaceId: string;
  section: WorkspaceSection;
  lastVisited: Partial<Record<WorkspaceDestination['id'], WorkspaceSection>>;
  badges?: Partial<Record<WorkspaceDestination['id'] | WorkspaceSection, number>>;
}

function Badge({ count }: { count?: number }) {
  if (!count) return null;
  return <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-foreground tabular-nums">{count}</span>;
}

/**
 * Workspace destinations are links, not tabs: each is a URL, so the browser's
 * back button, deep links and opening in a new window all keep working.
 */
export function WorkspaceNav({ workspaceId, section, lastVisited, badges = {} }: WorkspaceNavProps) {
  const base = `/workspaces/${encodeURIComponent(workspaceId)}`;
  const current = destinationOf(section);

  return (
    <div className="border-b border-border bg-card/60 px-4 sm:px-6">
      <nav aria-label="Workspace">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {WORKSPACE_DESTINATIONS.map((destination) => {
            const active = destination.id === current.id;
            return (
              <li key={destination.id} className="shrink-0">
                <Link
                  to={`${base}/${entrySection(destination, lastVisited)}`}
                  aria-current={active ? 'page' : undefined}
                  title={destination.purpose}
                  className={cn(
                    'inline-flex min-h-10 items-center border-b-2 px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                    active ? 'border-primary font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
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
      {current.sections.length > 1 && (
        <nav aria-label={`${current.label} sections`} className="py-2">
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
      )}
    </div>
  );
}
