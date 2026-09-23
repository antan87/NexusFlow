import { describe, expect, it } from 'vitest';
import { resolveFileReference } from './resolveFileReference.js';

describe('workspace file reference resolution', () => {
  it('matches Unix paths by exact case and Windows paths without case', () => {
    const repos = [
      { repoName: 'unix', repoPath: '/work/repo', files: [{ file: 'src/Foo.ts' }, { file: 'src/foo.ts' }] },
      { repoName: 'windows', repoPath: 'C:/work/repo', files: [{ file: 'src/Bar.ts' }] },
    ];
    expect(resolveFileReference('/work/repo/src/Foo.ts', repos).file?.file).toBe('src/Foo.ts');
    expect(resolveFileReference('/work/repo/src/FOO.ts', repos).error).toContain('not in this workspace');
    expect(resolveFileReference('c:/WORK/repo/src/bar.ts', repos).file?.file).toBe('src/Bar.ts');
  });

  it('rejects an ambiguous relative path', () => {
    const repos = [
      { repoName: 'one', repoPath: '/one', files: [{ file: 'src/shared.ts' }] },
      { repoName: 'two', repoPath: '/two', files: [{ file: 'src/shared.ts' }] },
    ];
    expect(resolveFileReference('src/shared.ts', repos).error).toContain('more than one');
  });
});
