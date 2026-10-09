import { describe, expect, it } from 'vitest';
import { cacheKeyFor, changeVersion, diffCacheDelta, type FetchedFile } from './changeVersion.js';

function fetchedAt(repoName: string, file: string, version: string): [string, FetchedFile] {
  return [cacheKeyFor(repoName, file), { repoName, file, version }];
}

describe('change versions', () => {
  it('differs when any compared field differs', () => {
    const base = { type: 'modified', additions: 1, deletions: 2, size: 30, mtimeMs: 400 };
    const versions = new Set([
      changeVersion(base),
      changeVersion({ ...base, type: 'deleted' }),
      changeVersion({ ...base, additions: 9 }),
      changeVersion({ ...base, deletions: 9 }),
      changeVersion({ ...base, size: 31 }),
      changeVersion({ ...base, mtimeMs: 401 }),
    ]);
    expect(versions.size).toBe(6);
  });

  it('is stable for the same file and tolerates missing fields', () => {
    expect(changeVersion({ type: 'added' })).toBe(changeVersion({ type: 'added' }));
    expect(() => changeVersion({})).not.toThrow();
  });
});

describe('diffCacheDelta', () => {
  const repos = [{
    repoName: 'app',
    files: [
      { file: 'src/a.ts', type: 'modified', additions: 1, deletions: 0, size: 10, mtimeMs: 1 },
      { file: 'src/b.ts', type: 'added', additions: 4, deletions: 0, size: 20, mtimeMs: 2 },
    ],
  }];

  it('reports nothing while every fetched file is unchanged', () => {
    const fetched = Object.fromEntries([
      fetchedAt('app', 'src/a.ts', changeVersion(repos[0]!.files[0]!)),
      fetchedAt('app', 'src/b.ts', changeVersion(repos[0]!.files[1]!)),
    ]);
    expect(diffCacheDelta(fetched, repos)).toEqual({ stale: [], removed: [] });
  });

  it('reports a file edited again after its diff was fetched', () => {
    const fetched = Object.fromEntries([fetchedAt('app', 'src/a.ts', 'modified:1:0:10:0')]);
    expect(diffCacheDelta(fetched, repos)).toEqual({
      stale: [{ key: 'app/src/a.ts', version: changeVersion(repos[0]!.files[0]!) }],
      removed: [],
    });
  });

  it('reports a file that left the change list, for example after a commit', () => {
    const fetched = Object.fromEntries([fetchedAt('app', 'src/gone.ts', 'modified:1:0:10:1')]);
    expect(diffCacheDelta(fetched, repos)).toEqual({ stale: [], removed: ['app/src/gone.ts'] });
  });

  it('treats a whole repository leaving the list as every file removed', () => {
    const fetched = Object.fromEntries([fetchedAt('app', 'src/a.ts', 'x')]);
    expect(diffCacheDelta(fetched, [])).toEqual({ stale: [], removed: ['app/src/a.ts'] });
  });

  it('keeps what it holds for a repository that failed to list instead of treating its files as removed', () => {
    const failing = [{ repoName: 'app', files: [], error: 'index.lock exists' }];
    const fetched = Object.fromEntries([fetchedAt('app', 'src/a.ts', 'x'), fetchedAt('other', 'b.ts', 'y')]);
    expect(diffCacheDelta(fetched, failing)).toEqual({ stale: [], removed: ['other/b.ts'] });
  });

  it('does not confuse the same path in two repositories', () => {
    const twin = [
      { repoName: 'one', files: [{ file: 'x.ts', type: 'modified', size: 1 }] },
      { repoName: 'two', files: [{ file: 'x.ts', type: 'modified', size: 2 }] },
    ];
    const fetched = Object.fromEntries([
      fetchedAt('one', 'x.ts', changeVersion(twin[0]!.files[0]!)),
      fetchedAt('two', 'x.ts', changeVersion(twin[0]!.files[0]!)),
    ]);
    expect(diffCacheDelta(fetched, twin)).toEqual({
      stale: [{ key: 'two/x.ts', version: changeVersion(twin[1]!.files[0]!) }],
      removed: [],
    });
  });
});
