import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnifiedDiff } from './diffParser.ts';

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
