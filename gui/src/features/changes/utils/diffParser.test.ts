import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseUnifiedDiff, mapRealLineToSnippetLine } from './diffParser.ts';

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
});
