/**
 * The workspace navigation model: five destinations, each with one purpose.
 * Existing section ids stay the URL segment (`/workspaces/:id/:section`), so
 * every deep link from before the shell redesign still resolves. A workspace
 * with no section in its URL opens on the chat, which is where most work happens.
 */
export type WorkspaceSection = 'chat' | 'overview' | 'plan' | 'documents' | 'knowledge' | 'skills' | 'changes' | 'sessions' | 'services';

export interface WorkspaceDestination {
  id: 'chat' | 'overview' | 'context' | 'changes' | 'run';
  label: string;
  /** What the destination is for, shown as its description. */
  purpose: string;
  sections: WorkspaceSection[];
}

export const WORKSPACE_DESTINATIONS: WorkspaceDestination[] = [
  { id: 'chat', label: 'Chat', purpose: 'Work with the assistant, with progress above and documents and code beside it', sections: ['chat'] },
  { id: 'overview', label: 'Overview', purpose: 'Where the task stands and what to do next', sections: ['overview'] },
  { id: 'context', label: 'Plan & Context', purpose: 'Brief, milestones, documents and what the assistant knows', sections: ['plan', 'documents', 'knowledge', 'skills'] },
  { id: 'changes', label: 'Changes', purpose: 'Review, commit and finish the work', sections: ['changes'] },
  { id: 'run', label: 'Run', purpose: 'Assistant sessions and local services', sections: ['sessions', 'services'] },
];

export const SECTION_LABELS: Record<WorkspaceSection, string> = {
  chat: 'Chat',
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

/**
 * No segment opens the chat. An unknown one (an old or mistyped link) falls back
 * to the overview instead of a blank page.
 */
export function parseSection(segment: string | undefined | null): WorkspaceSection {
  if (!segment) return 'chat';
  return ALL_SECTIONS.has(segment) ? segment as WorkspaceSection : 'overview';
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

/**
 * An archived workspace shows its record, not the places where work happens:
 * no changes, services, sessions or skills to act on.
 */
export const ARCHIVED_SECTIONS: readonly WorkspaceSection[] = ['overview', 'plan', 'documents', 'knowledge'];

/** The destinations to show, trimmed to the record for an archived workspace. */
export function destinationsFor(archived: boolean): WorkspaceDestination[] {
  if (!archived) return WORKSPACE_DESTINATIONS;
  return WORKSPACE_DESTINATIONS
    .map((destination) => ({ ...destination, sections: destination.sections.filter((section) => ARCHIVED_SECTIONS.includes(section)) }))
    .filter((destination) => destination.sections.length > 0);
}

/**
 * What can open beside the chat, in the rail's order. Overview and Sessions keep their addresses, so old links still
 * work, but have no place on the rail: the progress strip above the chat says where the work stands, and saved
 * conversations open from the chat itself.
 */
export const RAIL_SECTIONS: readonly WorkspaceSection[] = ['plan', 'changes', 'documents', 'knowledge', 'skills', 'services'];

/** The rail of an archived workspace is its record and what it knew. */
export function railSectionsFor(archived: boolean): readonly WorkspaceSection[] {
  return archived ? ARCHIVED_SECTIONS : RAIL_SECTIONS;
}

/** The section to render: an archived workspace falls back to its overview. */
export function visibleSection(section: WorkspaceSection, archived: boolean): WorkspaceSection {
  return archived && !ARCHIVED_SECTIONS.includes(section) ? 'overview' : section;
}
