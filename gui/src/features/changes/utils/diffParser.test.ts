import { describe, expect, it, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseUnifiedDiff,
  mapRealLineToSnippetLine,
  getHunkSnippetLine,
  getHunkFirstChangedSnippetLine,
  getHunkFirstChangedLineModified,
  getHunkFirstChangedLineOriginal,
} from './diffParser.ts';

const SAMPLE_PATCH = `--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,4 +1,5 @@
 const baseline = 10;
-const deduction = 2;
+const deduction = 5;
+const bonus = 1;
 export default baseline;
`;

test('parseUnifiedDiff extracts original and modified content correctly', () => {
  const result = parseUnifiedDiff(SAMPLE_PATCH);
  assert.equal(result.isNewFile, false);
  assert.equal(result.isDeletedFile, false);
  assert.equal(result.hunks.length, 1);
  assert.equal(result.hunks[0]?.startLineOriginal, 1);
  assert.equal(result.hunks[0]?.startLineModified, 1);
  assert.match(result.originalContent, /const deduction = 2;/);
  assert.doesNotMatch(result.originalContent, /const deduction = 5;/);
  assert.match(result.modifiedContent, /const deduction = 5;/);
  assert.match(result.modifiedContent, /const bonus = 1;/);
});

test('parseUnifiedDiff handles empty patch', () => {
  const result = parseUnifiedDiff('');
  assert.equal(result.hunks.length, 0);
  assert.equal(result.originalContent, '');
  assert.equal(result.modifiedContent, '');
});

test('parseUnifiedDiff handles new file creation', () => {
  const newFilePatch = `--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const hello = 'world';
+export default hello;
`;
  const result = parseUnifiedDiff(newFilePatch);
  assert.equal(result.isNewFile, true);
  assert.equal(result.originalContent, '');
  assert.match(result.modifiedContent, /export const hello/);
  assert.equal(result.hunks.length, 1);
});

test('mapRealLineToSnippetLine maps modified lines to 1-based snippet buffer indices', () => {
  const multiHunkPatch = `--- a/src/file.ts
+++ b/src/file.ts
@@ -10,3 +10,4 @@
 line 10
-line 11 old
+line 11 new
+line 11 added
 line 12
@@ -50,3 +51,3 @@
 line 50
-line 51 old
+line 51 new
 line 52
`;
  const result = parseUnifiedDiff(multiHunkPatch);
  assert.equal(result.hunks.length, 2);

  // In first hunk (starts at mod line 10):
  // snippet line 1: "line 10" (mod 10)
  // snippet line 2: "line 11 new" (mod 11)
  // snippet line 3: "line 11 added" (mod 12)
  // snippet line 4: "line 12" (mod 13)
  assert.equal(mapRealLineToSnippetLine(10, result.hunks), 1);
  assert.equal(mapRealLineToSnippetLine(11, result.hunks), 2);
  assert.equal(mapRealLineToSnippetLine(12, result.hunks), 3);
  assert.equal(mapRealLineToSnippetLine(13, result.hunks), 4);

  // In second hunk (starts at mod line 51):
  // snippet line 5: "line 50" (mod 51)
  // snippet line 6: "line 51 new" (mod 52)
  // snippet line 7: "line 52" (mod 53)
  assert.equal(mapRealLineToSnippetLine(51, result.hunks), 5);
  assert.equal(mapRealLineToSnippetLine(52, result.hunks), 6);
  assert.equal(mapRealLineToSnippetLine(53, result.hunks), 7);

  // Lines outside any hunk return null
  assert.equal(mapRealLineToSnippetLine(1, result.hunks), null);
  assert.equal(mapRealLineToSnippetLine(30, result.hunks), null);
  assert.equal(mapRealLineToSnippetLine(100, result.hunks), null);

  // getHunkSnippetLine returns 1-based start line of each hunk in snippet buffer
  assert.equal(getHunkSnippetLine(0, result.hunks), 1);
  assert.equal(getHunkSnippetLine(1, result.hunks), 5);
});

test('parseUnifiedDiff computes firstChangedLineModified and firstChangedSnippetLine skipping unchanged context lines', () => {
  // Simulates a hunk like @@ -339,3 +419,81 @@ where lines 419-421 are unchanged context and line 422 is an addition
  const patchWithContext = `--- a/src/index.ts
+++ b/src/index.ts
@@ -339,4 +419,5 @@
 context 419
 context 420
 context 421
+test('new test', () => {});
 context 423
`;
  const result = parseUnifiedDiff(patchWithContext);
  assert.equal(result.hunks.length, 1);
  const hunk = result.hunks[0]!;

  // Hunk header metadata
  assert.equal(hunk.startLineOriginal, 339);
  assert.equal(hunk.startLineModified, 419);

  // First changed lines (skip lines 419-421 context lines to reach line 422 addition)
  assert.equal(hunk.firstChangedLineModified, 422);
  assert.equal(hunk.firstChangedLineOriginal, 342);
  assert.equal(hunk.firstChangedSnippetLine, 4);

  // Helper functions
  assert.equal(getHunkFirstChangedSnippetLine(0, result.hunks), 4);
  assert.equal(getHunkFirstChangedLineModified(hunk), 422);
});

test('parseUnifiedDiff correctly targets first change in pure deletions and immediate additions', () => {
  const multiPatch = `--- a/src/test.ts
+++ b/src/test.ts
@@ -1,3 +1,4 @@
+import { describe } from 'vitest';
 line 1
 line 2
@@ -20,5 +21,2 @@
 ctx 21
-deleted line 22
-deleted line 23
 ctx 22
`;
  const result = parseUnifiedDiff(multiPatch);
  assert.equal(result.hunks.length, 2);

  // Hunk 0: addition on line 1 immediately
  const h0 = result.hunks[0]!;
  assert.equal(h0.startLineModified, 1);
  assert.equal(h0.firstChangedLineModified, 1);
  assert.equal(h0.firstChangedSnippetLine, 1);
  assert.equal(getHunkFirstChangedSnippetLine(0, result.hunks), 1);

  // Hunk 1: pure deletion after 1 context line (ctx 21 -> mod 21, then deletion occurs at mod 22)
  const h1 = result.hunks[1]!;
  assert.equal(h1.startLineModified, 21);
  assert.equal(h1.firstChangedLineModified, 22);
  assert.equal(h1.firstChangedLineOriginal, 21);
  // In snippet buffer: hunk 0 took lines 1..3 (import, line 1, line 2), so hunk 1 starts at 4 (ctx 21).
  // First change deletion is at snippet line 5.
  assert.equal(h1.firstChangedSnippetLine, 5);
  assert.equal(getHunkFirstChangedSnippetLine(0, result.hunks), 1);
  assert.equal(getHunkFirstChangedSnippetLine(1, result.hunks), 5);
  assert.equal(getHunkFirstChangedLineOriginal(h1), 21);
});


describe('lines that look like file headers inside a hunk', () => {
  // A removed SQL comment (`-- old`) is written `--- old`; an added `++i;` is written `+++i;`.
  const patch = [
    'diff --git a/q.sql b/q.sql',
    '--- a/q.sql',
    '+++ b/q.sql',
    '@@ -1,3 +1,3 @@',
    '--- old comment',
    '+++i;',
    ' select 1;',
    ' ',
    '@@ -10,2 +10,1 @@ create view v',
    ' keep;',
    '-drop;',
    '\\ No newline at end of file',
    '',
  ].join('\n');

  it('counts them as the removed and added lines they are', async () => {
    const { parseUnifiedDiff, modifiedLineCount } = await import('./diffParser.js');
    const parsed = parseUnifiedDiff(patch);
    expect(parsed.isNewFile).toBe(false);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.originalContent.split('\n')).toEqual(['-- old comment', 'select 1;', '', 'keep;', 'drop;']);
    expect(parsed.modifiedContent.split('\n')).toEqual(['++i;', 'select 1;', '', 'keep;']);
    expect(parsed.hunks[0]!.firstChangedLineModified).toBe(1);
    expect(parsed.hunks.map(modifiedLineCount)).toEqual([3, 1]);
    // The trailing newline of the patch is not part of the last hunk.
    expect(parsed.hunks[1]!.lines).toEqual([' keep;', '-drop;', '\\ No newline at end of file']);
  });

  it('agrees on snippet positions everywhere: start, first change, real line and hunk lookup', async () => {
    const { parseUnifiedDiff, getHunkSnippetLine, mapRealLineToSnippetLine, hunkIndexAtSnippetLine } = await import('./diffParser.js');
    const { hunks } = parseUnifiedDiff(patch);
    expect(hunks.map((hunk, index) => getHunkSnippetLine(index, hunks))).toEqual([1, 4]);
    expect(hunks.map((hunk) => hunk.snippetStartLine)).toEqual([1, 4]);
    // Pure deletion: its first change is where the removed line was, after `keep;`.
    expect(hunks[1]!.firstChangedLineModified).toBe(11);
    expect(hunks[1]!.firstChangedLineOriginal).toBe(11);
    expect(mapRealLineToSnippetLine(1, hunks)).toBe(1);
    expect(mapRealLineToSnippetLine(10, hunks)).toBe(4);
    expect(mapRealLineToSnippetLine(5, hunks)).toBeNull();
    expect([1, 3, 4].map((line) => hunkIndexAtSnippetLine(line, hunks))).toEqual([0, 0, 1]);
  });

  it('numbers every line of the plain patch view from the hunk headers', async () => {
    const { classifyPatch } = await import('./diffParser.js');
    const kinds = classifyPatch(patch).map(({ kind, origLine, modLine }) => [kind, origLine ?? null, modLine ?? null]);
    expect(kinds).toEqual([
      ['header', null, null], ['header', null, null], ['header', null, null],
      ['hunk', 1, 1], ['removed', 1, null], ['added', null, 1], ['context', 2, 2], ['context', 3, 3],
      ['hunk', 10, 10], ['context', 10, 10], ['removed', 11, null], ['meta', null, null],
      ['header', null, null],
    ]);
  });
});
