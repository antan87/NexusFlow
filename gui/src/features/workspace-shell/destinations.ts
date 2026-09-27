/**
 * The workspace navigation model: four destinations, each with one purpose.
 * Existing section ids stay the URL segment (`/workspaces/:id/:section`), so
 * every deep link from before the shell redesign still resolves.
 */
export type WorkspaceSection = 'overview' | 'plan' | 'documents' | 'knowledge' | 'skills' | 'changes' | 'sessions' | 'services';

export interface WorkspaceDestination {
  id: 'overview' | 'context' | 'changes' | 'run';
  label: string;
  /** What the destination is for, shown as its description. */
  purpose: string;
  sections: WorkspaceSection[];
}

export const WORKSPACE_DESTINATIONS: WorkspaceDestination[] = [
  { id: 'overview', label: 'Overview', purpose: 'Where the task stands and what to do next', sections: ['overview'] },
  { id: 'context', label: 'Plan & Context', purpose: 'Brief, milestones, documents and what the assistant knows', sections: ['plan', 'documents', 'knowledge', 'skills'] },
  { id: 'changes', label: 'Changes', purpose: 'Review, commit and finish the work', sections: ['changes'] },
  { id: 'run', label: 'Run', purpose: 'Assistant sessions and local services', sections: ['sessions', 'services'] },
];

export const SECTION_LABELS: Record<WorkspaceSection, string> = {
  overview: 'Overview',
  plan: 'Plan',
  documents: 'Documents',
  knowledge: 'Knowledge',
  skills: 'Skills',
  changes: 'Changes',
  sessions: 'Sessions',
  services: 'Services',
};

const ALL_SECTIONS = new Set<string>(WORKSPACE_DESTINATIONS.flatMap((destination) => destination.sections));

/** Unknown or missing segments fall back to the overview instead of a blank page. */
export function parseSection(segment: string | undefined | null): WorkspaceSection {
  return segment && ALL_SECTIONS.has(segment) ? segment as WorkspaceSection : 'overview';
}

export function destinationOf(section: WorkspaceSection): WorkspaceDestination {
  return WORKSPACE_DESTINATIONS.find((destination) => destination.sections.includes(section)) ?? WORKSPACE_DESTINATIONS[0];
}

/**
 * Where a destination link goes: the section last used there, so returning to
 * Plan & Context reopens Documents if that is where the user was.
 */
export function entrySection(destination: WorkspaceDestination, lastVisited: Partial<Record<WorkspaceDestination['id'], WorkspaceSection>>): WorkspaceSection {
  const remembered = lastVisited[destination.id];
  return remembered && destination.sections.includes(remembered) ? remembered : destination.sections[0];
}
