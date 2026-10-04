import { describe, expect, it } from 'vitest';
import { WORKSPACE_DESTINATIONS, destinationOf, destinationsFor, entrySection, parseSection, railSectionsFor, visibleSection } from './destinations.js';

describe('workspace destinations', () => {
  it('place every section in exactly one destination', () => {
    const sections = WORKSPACE_DESTINATIONS.flatMap((destination) => destination.sections);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections.sort()).toEqual(['changes', 'chat', 'documents', 'knowledge', 'overview', 'plan', 'services', 'sessions', 'skills']);
  });

  it('keep old tab URLs working', () => {
    for (const legacy of ['overview', 'plan', 'documents', 'changes', 'services', 'sessions', 'knowledge', 'skills']) {
      expect(parseSection(legacy)).toBe(legacy);
    }
    expect(destinationOf('knowledge').id).toBe('context');
    expect(destinationOf('services').id).toBe('run');
    // An unknown segment lands on the overview. No segment at all opens the chat.
    expect(parseSection('diff')).toBe('overview');
    expect(parseSection(undefined)).toBe('chat');
    expect(parseSection(null)).toBe('chat');
    expect(parseSection('')).toBe('chat');
    expect(parseSection('chat')).toBe('chat');
  });

  it('lead with the chat, which has a destination of its own', () => {
    expect(WORKSPACE_DESTINATIONS[0]).toMatchObject({ id: 'chat', label: 'Chat', sections: ['chat'] });
    expect(destinationOf('chat').id).toBe('chat');
    expect(entrySection(WORKSPACE_DESTINATIONS[0]!, {})).toBe('chat');
  });

  it('reopen the section last used in a destination', () => {
    const context = destinationOf('plan');
    expect(entrySection(context, {})).toBe('plan');
    expect(entrySection(context, { context: 'documents' })).toBe('documents');
    // A remembered section from another destination is ignored.
    expect(entrySection(context, { context: 'sessions' })).toBe('plan');
  });

  it('show an archived workspace only its record', () => {
    const archived = destinationsFor(true);
    expect(archived.map((destination) => destination.id)).toEqual(['overview', 'context']);
    expect(archived.flatMap((destination) => destination.sections)).toEqual(['overview', 'plan', 'documents', 'knowledge']);
    expect(destinationsFor(false)).toBe(WORKSPACE_DESTINATIONS);
    // A deep link to a working section of an archived workspace lands on its overview.
    expect(visibleSection('changes', true)).toBe('overview');
    expect(visibleSection('sessions', true)).toBe('overview');
    // An archived workspace has no chat: a link with no section, or one to the chat, shows its record.
    expect(visibleSection(parseSection(undefined), true)).toBe('overview');
    expect(visibleSection('chat', true)).toBe('overview');
    expect(visibleSection('chat', false)).toBe('chat');
    expect(visibleSection('knowledge', true)).toBe('knowledge');
    expect(visibleSection('changes', false)).toBe('changes');
    // A remembered working section is not reopened in an archived workspace.
    expect(entrySection(archived[1]!, { context: 'skills' })).toBe('plan');
  });
});

describe('railSectionsFor', () => {
  it('offers what can open beside the chat, and no place for the chat, the overview, the session history or knowledge', () => {
    expect(railSectionsFor(false)).toEqual(['plan', 'changes', 'documents', 'skills', 'services']);
    for (const gone of ['chat', 'overview', 'sessions', 'knowledge'] as const) expect(railSectionsFor(false)).not.toContain(gone);
  });

  it('keeps old addresses working: every section still parses to itself', () => {
    for (const section of ['overview', 'sessions', 'services', 'plan'] as const) expect(parseSection(section)).toBe(section);
  });

  it('shows an archived workspace its record, its plan and its documents, and nothing to act on', () => {
    expect(railSectionsFor(true)).toEqual(['overview', 'plan', 'documents']);
    // Its knowledge is still open to read, in Docs or at its old address.
    expect(visibleSection('knowledge', true)).toBe('knowledge');
  });
});
