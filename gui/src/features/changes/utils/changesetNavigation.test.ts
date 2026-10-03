import { describe, expect, it } from 'vitest';
import { findChangedFileIndex, isAbsoluteReference, repoDirName, type NavigableFile } from './changesetNavigation.js';

const files: NavigableFile[] = [
  { repoName: 'app', repoPath: '/work/app', file: 'src/index.ts' },
  { repoName: 'app', repoPath: '/work/app', file: 'a.ts' },
  { repoName: 'app', repoPath: '/work/app', file: 'README.md' },
  { repoName: 'lib', repoPath: '/work/lib', file: 'src/index.ts' },
  { repoName: 'win', repoPath: 'C:\\Work\\win', file: 'src\\Win.ts' },
];

describe('findChangedFileIndex', () => {
  it('finds an exact repository-relative path in the named repository', () => {
    expect(findChangedFileIndex(files, 'app', 'src/index.ts')).toBe(0);
    expect(findChangedFileIndex(files, 'lib', 'src/index.ts')).toBe(3);
  });

  it('normalizes separators and leading ./ and /', () => {
    expect(findChangedFileIndex(files, 'app', 'src\\index.ts')).toBe(0);
    expect(findChangedFileIndex(files, 'app', './src/index.ts')).toBe(0);
    expect(findChangedFileIndex(files, 'app', '/src/index.ts')).toBe(0);
    expect(findChangedFileIndex(files, 'win', 'src/Win.ts')).toBe(4);
  });

  it('does not match a name that merely ends the same way', () => {
    expect(findChangedFileIndex(files, 'app', 'xa.ts')).toBe(-1);
    expect(findChangedFileIndex(files, 'app', 'index.ts')).toBe(-1);
    expect(findChangedFileIndex(files, 'app', 'docs/README.md')).toBe(-1);
    expect(findChangedFileIndex(files, 'app', 'src')).toBe(-1);
  });

  it('does not search another repository when one is named', () => {
    expect(findChangedFileIndex(files, 'lib', 'a.ts')).toBe(-1);
  });

  it('treats a missing or "workspace" repository as any, but refuses an ambiguous match', () => {
    expect(findChangedFileIndex(files, undefined, 'a.ts')).toBe(1);
    expect(findChangedFileIndex(files, 'workspace', 'README.md')).toBe(2);
    expect(findChangedFileIndex(files, 'workspace', 'src/index.ts')).toBe(-1);
  });

  it('matches an absolute path through the repository path, not by suffix', () => {
    expect(findChangedFileIndex(files, 'app', '/work/app/src/index.ts')).toBe(0);
    expect(findChangedFileIndex(files, undefined, '/work/lib/src/index.ts')).toBe(3);
    expect(findChangedFileIndex(files, 'app', '/elsewhere/work/app/src/index.ts')).toBe(-1);
    expect(findChangedFileIndex(files, 'app', '/work/app/other/a.ts')).toBe(-1);
  });

  it('compares Windows absolute paths without case', () => {
    expect(findChangedFileIndex(files, 'win', 'c:/work/WIN/src/win.ts')).toBe(4);
  });

  it('returns -1 for an empty changeset or an unknown file', () => {
    expect(findChangedFileIndex([], 'app', 'a.ts')).toBe(-1);
    expect(findChangedFileIndex(files, 'app', 'nope.ts')).toBe(-1);
  });
});

describe('isAbsoluteReference', () => {
  it('recognizes POSIX, drive and UNC paths only', () => {
    for (const absolute of ['/a/b', 'C:\\a', 'c:/a', '\\\\server\\share']) expect(isAbsoluteReference(absolute)).toBe(true);
    for (const relative of ['a/b', './a', 'src\\a.ts', '']) expect(isAbsoluteReference(relative)).toBe(false);
  });
});

describe('repoDirName', () => {
  it('returns the last path segment for either separator and ignores a trailing one', () => {
    expect(repoDirName('/work/app')).toBe('app');
    expect(repoDirName('C:\\Work\\win\\')).toBe('win');
    expect(repoDirName('webapp')).toBe('webapp');
  });
});
