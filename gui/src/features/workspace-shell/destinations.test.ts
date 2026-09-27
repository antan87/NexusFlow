import { describe, expect, it } from 'vitest';
import { WORKSPACE_DESTINATIONS, destinationOf, entrySection, parseSection } from './destinations.js';

describe('workspace destinations', () => {
  it('place every section in exactly one destination', () => {
    const sections = WORKSPACE_DESTINATIONS.flatMap((destination) => destination.sections);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections.sort()).toEqual(['changes', 'documents', 'knowledge', 'overview', 'plan', 'services', 'sessions', 'skills']);
  });

  it('keep old tab URLs working', () => {
    for (const legacy of ['overview', 'plan', 'documents', 'changes', 'services', 'sessions', 'knowledge', 'skills']) {
      expect(parseSection(legacy)).toBe(legacy);
    }
    expect(destinationOf('knowledge').id).toBe('context');
    expect(destinationOf('services').id).toBe('run');
    expect(parseSection('diff')).toBe('overview');
    expect(parseSection(undefined)).toBe('overview');
  });

  it('reopen the section last used in a destination', () => {
    const context = destinationOf('plan');
    expect(entrySection(context, {})).toBe('plan');
    expect(entrySection(context, { context: 'documents' })).toBe('documents');
    // A remembered section from another destination is ignored.
    expect(entrySection(context, { context: 'sessions' })).toBe('plan');
  });
});
