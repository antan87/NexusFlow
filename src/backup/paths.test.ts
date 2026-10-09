import { describe, expect, it } from 'vitest';

import { BackupError } from './contracts.js';
import { assertLogicalPath, assertUniqueLogicalPaths, foldLogicalPath, isWellFormedText } from './paths.js';

describe('backup logical paths', () => {
  it.each([
    'contextspace.json',
    'workspaces/demo/contextspace-work.json',
    'base/3f9a1c/knowledge.md',
    'evidence/data-map-2026-09-28/change-manifest.json',
    'dotted.name.with.dots/file.tar.gz',
    'ünïcode/naïve.md',
  ])('accepts %s', (path) => {
    expect(() => assertLogicalPath(path)).not.toThrow();
  });

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['C:/Users/me/file.md', 'drive letter'],
    ['c:relative.md', 'drive-relative'],
    ['..', 'parent'],
    ['../escape.md', 'parent'],
    ['a/../../escape.md', 'parent in the middle'],
    ['a/./b.md', 'current-folder segment'],
    ['a//b.md', 'empty segment'],
    ['a/b/', 'trailing slash'],
    ['a\\b.md', 'backslash'],
    ['a\u0000b.md', 'NUL'],
    ['a\nb.md', 'newline'],
    ['file\u202etxt.md', 'right-to-left override'],
    ['file\u200b.md', 'zero-width space'],
    ['stream.md:hidden', 'alternate data stream'],
    ['a<b>.md', 'Windows-reserved characters'],
    ['what?.md', 'wildcard'],
    ['CON', 'Windows device name'],
    ['docs/nul.txt', 'Windows device name with extension'],
    ['docs/COM3.md', 'Windows device name, mixed case'],
    ['notes.', 'trailing dot'],
    ['notes ', 'trailing space'],
    [' notes', 'leading space'],
    ['cafe\u0301.md', 'not NFC-normalized'],
    ['lone\uD800surrogate.md', 'lone surrogate'],
    [`${'a'.repeat(256)}.md`, 'segment over 255 bytes'],
    [`${'a/'.repeat(300)}x`, 'over the length limit'],
  ])('rejects %j (%s)', (path) => {
    expect(() => assertLogicalPath(path)).toThrowError(BackupError);
    try { assertLogicalPath(path); } catch (error) { expect((error as BackupError).code).toBe('invalid-contents'); }
  });

  it.each(['/etc/passwd', 'C:/Users/me/file.md', 'c:relative.md'])('names %j as absolute, not as some other defect', (path) => {
    expect(() => assertLogicalPath(path)).toThrowError(/\(absolute\)/);
  });

  it('counts a multibyte name against the segment byte limit, not its character count', () => {
    expect(() => assertLogicalPath(`${'é'.repeat(100)}.md`)).not.toThrow();
    expect(() => assertLogicalPath(`${'é'.repeat(130)}.md`)).toThrowError(BackupError);
  });

  it('truncates the path it echoes so a hostile name cannot flood a message', () => {
    try { assertLogicalPath(`../${'x'.repeat(5000)}`); } catch (error) { expect((error as Error).message.length).toBeLessThan(300); }
  });

  it('detects lone surrogates without relying on a newer string API', () => {
    expect(isWellFormedText('plain 😀 text')).toBe(true);
    expect(isWellFormedText('bad \uD83D')).toBe(false);
    expect(isWellFormedText('bad \uDE00')).toBe(false);
  });
});

describe('backup path uniqueness', () => {
  it('accepts distinct paths', () => {
    expect(() => assertUniqueLogicalPaths(['a.md', 'b.md', 'dir/a.md'])).not.toThrow();
  });

  it('rejects an exact duplicate', () => {
    expect(() => assertUniqueLogicalPaths(['a.md', 'b.md', 'a.md'])).toThrowError(/duplicate path/);
  });

  it('rejects names that differ only by case, because a case-insensitive disk would merge them', () => {
    expect(() => assertUniqueLogicalPaths(['Notes.md', 'notes.md'])).toThrowError(/case-insensitive/);
    expect(() => assertUniqueLogicalPaths(['Dir/a.md', 'dir/A.md'])).toThrowError(/case-insensitive/);
  });

  it('rejects a path that is both a file and a folder', () => {
    expect(() => assertUniqueLogicalPaths(['evidence', 'evidence/summary.md'])).toThrowError(/both a file and a folder/);
    expect(() => assertUniqueLogicalPaths(['Evidence', 'evidence/summary.md'])).toThrowError(/both a file and a folder/);
  });

  it('folds with normalization and case', () => {
    expect(foldLogicalPath('Ünï.MD')).toBe(foldLogicalPath('ünï.md'));
  });
});
