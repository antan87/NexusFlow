import { describe, it, expect } from 'vitest';
import { getClaudeProjectFolderName } from './session-finder.js';

describe('getClaudeProjectFolderName', () => {
  it('matches Claude Code encoding for a Windows path (colon, backslash, dot, underscore)', () => {
    expect(getClaudeProjectFolderName('C:\\Users\\anton.patron\\Git\\workspaces\\improve_las'))
      .toBe('C--Users-anton-patron-Git-workspaces-improve-las');
  });

  it('maps each separator to its own dash without collapsing runs', () => {
    // `C:\` is three non-alphanumerics (colon + backslash) around the drive → `C--`.
    expect(getClaudeProjectFolderName('C:\\Git')).toBe('C--Git');
  });

  it('encodes a POSIX path', () => {
    expect(getClaudeProjectFolderName('/home/a.b/Git/my_repo'))
      .toBe('-home-a-b-Git-my-repo');
  });

  it('preserves case', () => {
    expect(getClaudeProjectFolderName('C:\\Git\\NexusFlow')).toBe('C--Git-NexusFlow');
  });
});
