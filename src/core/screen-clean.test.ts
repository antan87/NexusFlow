import { describe, expect, it } from 'vitest';

import { cleanLineNumber, cleanRelativePath, cleanRepoName, cleanScreenBlock, cleanScreenText } from './screen-clean.js';

describe('cleanScreenText', () => {
  it('removes control characters, collapses whitespace and trims', () => {
    expect(cleanScreenText('  Hello\u001b[31m\n\n  world\u0007  ', 100)).toBe('Hello[31m world');
  });
  it('cuts to length and then trims, so a cut cannot leave a trailing space', () => {
    expect(cleanScreenText('abc def', 4)).toBe('abc');
  });
  it('is undefined for empty, blank, control-only and non-string input', () => {
    for (const value of ['', '   ', '\u0007\u001b', null, undefined, 42, {}, ['a']]) expect(cleanScreenText(value, 10)).toBeUndefined();
  });
});

describe('cleanScreenBlock', () => {
  it('keeps line breaks, normalises Windows ones, removes other control characters and cuts to length', () => {
    expect(cleanScreenBlock('one\r\ntwo\rthree\u0007', 100)).toBe('one\ntwo\nthree');
    expect(cleanScreenBlock('abcdef', 3)).toBe('abc');
  });
  it('is undefined when nothing is left', () => {
    expect(cleanScreenBlock('  \n ', 10)).toBeUndefined();
    expect(cleanScreenBlock(7, 10)).toBeUndefined();
  });
});

describe('cleanRelativePath', () => {
  it('keeps a plain relative path and normalises separators and dots', () => {
    expect(cleanRelativePath('src/core/a.ts')).toBe('src/core/a.ts');
    expect(cleanRelativePath('.\\src\\.\\a.ts')).toBe('src/a.ts');
    expect(cleanRelativePath('  docs//plan.md ')).toBe('docs/plan.md');
  });
  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a Windows drive path', 'C:\\Users\\me\\a.txt'],
    ['a Windows drive path with forward slashes', 'c:/Users/a.txt'],
    ['a UNC-style path', '\\\\server\\share\\a'],
    ['a parent segment', 'src/../../etc/passwd'],
    ['a leading parent segment', '../a'],
    ['Git internals', '.git/config'],
    ['Git internals in a repository', 'NexusFlow/.GIT/hooks/pre-commit'],
    ['a control character', 'a\u0000b'],
    ['nothing', ''],
    ['only dots and slashes', './/./'],
    ['a path that is too long', 'a/'.repeat(600)],
    ['a number', 42],
  ])('refuses %s', (_name, value) => {
    expect(cleanRelativePath(value as unknown)).toBeUndefined();
  });
  it('does not mistake a file that merely contains two dots for climbing out', () => {
    expect(cleanRelativePath('notes..v2/a..b.md')).toBe('notes..v2/a..b.md');
  });
});

describe('cleanRepoName and cleanLineNumber', () => {
  it('accepts a plain repository name and refuses one with a separator', () => {
    expect(cleanRepoName('NexusFlow')).toBe('NexusFlow');
    expect(cleanRepoName('a/b')).toBeUndefined();
    expect(cleanRepoName('a\\b')).toBeUndefined();
  });
  it('accepts positive integers in range only', () => {
    expect(cleanLineNumber(12)).toBe(12);
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, '12', null, undefined]) {
      expect(cleanLineNumber(value as unknown)).toBeUndefined();
    }
  });
});
