import { describe, expect, it } from 'vitest';
import { fileUrlToPath, parseFileReference, splitLocation, trimTrailingPunctuation } from './fileReference.js';

describe('parseFileReference', () => {
  it.each([
    ['src/app.ts', { path: 'src/app.ts' }],
    ['src/app.ts:12', { path: 'src/app.ts', line: 12 }],
    ['src/app.ts:12:3', { path: 'src/app.ts', line: 12, column: 3 }],
    ['src/app.ts(12,3)', { path: 'src/app.ts', line: 12, column: 3 }],
    ['docs/guide.md#L20', { path: 'docs/guide.md', line: 20 }],
    ['docs/guide.md#L20-L30', { path: 'docs/guide.md', line: 20 }],
    ['<src/app.ts:15>', { path: 'src/app.ts', line: 15 }],
    ['[guide](docs/guide.md:20)', { path: 'docs/guide.md', line: 20 }],
    ['[guide](<docs/my guide.md>)', { path: 'docs/my guide.md' }],
    ['see src/app.ts.', { path: 'see src/app.ts' }],
    ['src/app.ts:12,', { path: 'src/app.ts', line: 12 }],
    ['(src/app.ts)', { path: '(src/app.ts' }],
    ['file:///home/me/repo/src/app.ts', { path: '/home/me/repo/src/app.ts' }],
    ['file:///home/me/my%20repo/a.ts#L7', { path: '/home/me/my repo/a.ts', line: 7 }],
    ['file:///C:/repo/a.ts', { path: 'C:/repo/a.ts' }],
    ['C:/repo/a.ts:4', { path: 'C:/repo/a.ts', line: 4 }],
    ['src/app.ts#section', { path: 'src/app.ts' }],
  ])('reads %s', (raw, expected) => {
    expect(parseFileReference(raw)).toEqual(expected);
  });

  it('returns null when only decoration is left', () => {
    expect(parseFileReference('<>')).toBeNull();
    expect(parseFileReference('  ')).toBeNull();
  });

  it('ignores a zero or negative line', () => {
    expect(parseFileReference('src/app.ts:0')).toEqual({ path: 'src/app.ts:0' });
  });
});

describe('the building blocks', () => {
  it('keeps a (line,col) location and a drive letter while trimming sentence punctuation', () => {
    expect(trimTrailingPunctuation('src/app.ts(1,2)')).toBe('src/app.ts(1,2)');
    expect(trimTrailingPunctuation('C:')).toBe('C:');
    expect(trimTrailingPunctuation('src/app.ts:")')).toBe('src/app.ts');
  });

  it('splits locations and decodes file URLs', () => {
    expect(splitLocation('a.ts')).toEqual({ path: 'a.ts' });
    expect(fileUrlToPath('src/a.ts')).toBe('src/a.ts');
  });
});
