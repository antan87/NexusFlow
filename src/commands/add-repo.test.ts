import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { filterAvailableRepos } from './add-repo.js';

describe('filterAvailableRepos (A1.3)', () => {
  const scanned = [
    { path: path.resolve('/dev/repo-a'), name: 'repo-a' },
    { path: path.resolve('/dev/repo-b'), name: 'repo-b' },
  ];

  it('excludes repos already added, matching on the original source path', () => {
    // feature.repos holds worktree paths; originalRepos holds source paths.
    const feature = {
      originalRepos: [path.resolve('/dev/repo-a')],
      repos: [path.resolve('/mock/ws/repo-a')],
    };

    const available = filterAvailableRepos(scanned, feature);

    expect(available.map((r) => r.name)).toEqual(['repo-b']);
  });

  it('returns all scanned repos when originalRepos is missing', () => {
    const available = filterAvailableRepos(scanned, {});
    expect(available.map((r) => r.name)).toEqual(['repo-a', 'repo-b']);
  });

  it('does not incorrectly match against worktree paths (the original bug)', () => {
    // Only worktree paths recorded, no originalRepos → nothing filtered,
    // because scanned paths never equal worktree paths.
    const feature = { repos: [path.resolve('/mock/ws/repo-a')] };
    const available = filterAvailableRepos(scanned, feature as any);
    expect(available).toHaveLength(2);
  });
});
