import { test, expect } from './fixtures';

const feature = {
  id: 'gutter', branchName: 'gutter', description: 'Fallback gutter', mode: 'worktree',
  repos: ['/workspaces/gutter/app'], originalRepos: ['/source/app'],
  assistants: [], workspacePath: '/workspaces/gutter', createdAt: '2026-09-20T00:00:00Z',
};

/**
 * A hunk starting at original line 10 / modified line 10, with a deletion, two
 * context lines and an insertion. The fallback adapter must report a real file
 * line on every row, and a removed line must be locatable by its original
 * number.
 */
const diff = [
  'diff --git a/src/calc.ts b/src/calc.ts',
  'index 1111111..2222222 100644',
  '--- a/src/calc.ts',
  '+++ b/src/calc.ts',
  '@@ -10,4 +10,4 @@ export function total(values) {',
  '   const sum = 0;',
  '-  return sum + 1;',
  '+  return sum + 2;',
  ' }',
].join('\n');

test.use({ workspacesData: [feature], workspacesStatusData: {
  gutter: { id: 'gutter', branchName: 'gutter', changedFiles: 1, dirtyRepos: 1, syncStatus: 'up-to-date', runningServices: 0 },
} });

/** Every rendered row, including deletions and file headers. */
const gutterRows = (page: import('@playwright/test').Page) =>
  page.getByTestId('fallback-diff').locator(':scope > div');

test('the lightweight fallback diff reports real original and modified line numbers', async ({ page }) => {
  const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/workspace/gutter/lifecycle', route => route.fulfill(json({ lifecycle: { steps: [] }, report: null })));
  await page.route('**/api/workspace/gutter/changes', route => route.fulfill(json({ changes: [{ repoName: 'app', repoPath: feature.repos[0], files: [{ file: 'src/calc.ts', type: 'modified', additions: 1, deletions: 1 }] }] })));
  await page.route('**/api/workspace/gutter/changes/symbols', route => route.fulfill(json({ symbols: [] })));
  await page.route('**/api/workspace/gutter/changes/diff?*', route => route.fulfill(json({ diff, fileContent: 'x\n', originalContent: 'y\n', symbols: [] })));
  await page.goto('/#/workspaces/gutter/changes');
  await page.getByRole('button', { name: 'Expand All', exact: true }).click();
  await page.getByRole('button', { name: /calc\.ts/ }).first().click();

  // Switch to the zero-worker engine, which is opt-in from the toolbar.
  const engine = page.getByTitle('Toggle between Monaco Diff Editor and Lightweight Fallback');
  await expect(engine).toBeVisible();
  await engine.click();
  await expect(engine).toHaveText('Fallback');

  const rows = gutterRows(page);
  await expect(rows).toHaveCount(9);
  const lines = await rows.evaluateAll(nodes => nodes.map(node => ({
    orig: node.getAttribute('data-orig-line') ?? '',
    mod: node.getAttribute('data-mod-line') ?? '',
    marker: (node.querySelectorAll('span')[2]?.textContent ?? '').trim(),
    text: (node.querySelectorAll('span')[3]?.textContent ?? '').trim(),
  })));

  // Hunk header says -10,4 +10,4, so:
  expect(lines).toEqual([
    { orig: '', mod: '', marker: '', text: 'diff --git a/src/calc.ts b/src/calc.ts' },
    { orig: '', mod: '', marker: '', text: 'index 1111111..2222222 100644' },
    { orig: '', mod: '', marker: '', text: '--- a/src/calc.ts' },
    { orig: '', mod: '', marker: '', text: '+++ b/src/calc.ts' },
    { orig: '10', mod: '10', marker: '', text: '@@ -10,4 +10,4 @@ export function total(values) {' },
    { orig: '10', mod: '10', marker: '', text: 'const sum = 0;' },
    { orig: '11', mod: '', marker: '-', text: 'return sum + 1;' },
    { orig: '', mod: '11', marker: '+', text: 'return sum + 2;' },
    { orig: '12', mod: '12', marker: '', text: '}' },
  ]);
});

test('the fallback gutter never falls back to a patch-array index', async ({ page }) => {
  const json = (body: unknown) => ({ contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/workspace/gutter/lifecycle', route => route.fulfill(json({ lifecycle: { steps: [] }, report: null })));
  await page.route('**/api/workspace/gutter/changes', route => route.fulfill(json({ changes: [{ repoName: 'app', repoPath: feature.repos[0], files: [{ file: 'src/calc.ts', type: 'modified', additions: 1, deletions: 1 }] }] })));
  await page.route('**/api/workspace/gutter/changes/symbols', route => route.fulfill(json({ symbols: [] })));
  await page.route('**/api/workspace/gutter/changes/diff?*', route => route.fulfill(json({ diff, fileContent: 'x\n', originalContent: 'y\n', symbols: [] })));
  await page.goto('/#/workspaces/gutter/changes');
  await page.getByRole('button', { name: 'Expand All', exact: true }).click();
  await page.getByRole('button', { name: /calc\.ts/ }).first().click();
  await page.getByTitle('Toggle between Monaco Diff Editor and Lightweight Fallback').click();

  const numbers = await gutterRows(page).evaluateAll(nodes => nodes.flatMap(node => ['data-orig-line', 'data-mod-line']
    .map(attribute => node.getAttribute(attribute) ?? '')
    .filter(value => value !== '').map(Number)));

  // Every number must be a plausible file line for a 4-line hunk at line 10.
  // A patch-array index would start at 1 and interleave with the real ones.
  expect(numbers.length).toBe(8);
  for (const value of numbers) {
    expect(value).toBeGreaterThanOrEqual(10);
    expect(value).toBeLessThanOrEqual(12);
  }
});
