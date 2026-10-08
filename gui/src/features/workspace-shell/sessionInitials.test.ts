import { describe, expect, it } from 'vitest';
import { sessionInitials } from './sessionInitials.js';

describe('sessionInitials', () => {
  it('takes the first letters of the first two words of a title', () => {
    expect(sessionInitials('Annoying tabs')).toBe('AT');
    expect(sessionInitials('Redo GUI')).toBe('RG');
    expect(sessionInitials('Better create workspace experience')).toBe('BC');
  });

  it('reads a branch name the same way', () => {
    expect(sessionInitials('improve-documents-view')).toBe('ID');
    expect(sessionInitials('feature/login_fix')).toBe('FL');
    expect(sessionInitials('chore/perf-rules-ci')).toBe('CP');
  });

  it('takes the first two characters of a single word, or the one it has', () => {
    expect(sessionInitials('solo')).toBe('SO');
    expect(sessionInitials('x')).toBe('X');
  });

  it('skips leading and repeated separators', () => {
    expect(sessionInitials('  --alpha__beta  ')).toBe('AB');
  });

  it('keeps a character outside the basic plane whole', () => {
    expect(sessionInitials('😀 smile')).toBe('😀S');
  });

  it('has a placeholder for a name with no letters at all', () => {
    expect(sessionInitials('')).toBe('?');
    expect(sessionInitials(' - ')).toBe('?');
  });
});
