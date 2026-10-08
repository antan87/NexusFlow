import { test, expect } from './fixtures';

/**
 * The Code section's file tree, driven the way people use it: by keyboard, by scrolling a large
 * tree, while the listing refreshes underneath, and while filtering.
 */
const workspace = { id: 'feature-x', branchName: 'feature-x', description: 'Inspect work', repos: ['C:/repo'], assistants: ['codex'], workspacePath: 'C:/ws/feature-x', createdAt: '2026-09-20T00:00:00Z' };
test.use({ workspacesData: [workspace], viewport: { width: 1450, height: 900 } });

type File = { file: string; type: string };
const listing = (files: File[]) => ({ changes: [{ repoName: 'repo', repoPath: 'C:/repo', files }] });

async function serve(page: import('@playwright/test').Page, changes: () => File[], all: () => File[] = changes) {
  await page.route('**/api/workspace/feature-x/changes?include=all*', (route) => route.fulfill({ json: listing(all()) }));
  await page.route('**/api/workspace/feature-x/changes', (route) => route.fulfill({ json: listing(changes()) }));
  await page.route('**/api/workspace/feature-x/changes/diff?*', (route) => {
    const file = new URL(route.request().url()).searchParams.get('file');
    return route.fulfill({ json: { diff: '', fileContent: `// ${file}\n` } });
  });
}

const code = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'Workspace code' });
const openFile = (page: import('@playwright/test').Page) => code(page).locator('p[title]').first();

test('the keyboard moves through the tree, Enter opens a file, and letters jump to a name', async ({ page }) => {
  await serve(page, () => [{ file: 'src/alpha.ts', type: 'modified' }, { file: 'src/beta.ts', type: 'modified' }, { file: 'README.md', type: 'modified' }]);
  await page.goto('/#/workspaces/feature-x/changes');
  const tree = code(page).getByRole('tree', { name: 'repo changed files' });
  const folder = tree.getByRole('treeitem', { name: 'src' });
  await expect(folder).toHaveAttribute('aria-expanded', 'true');

  // One tab stop for the whole tree, on its first row.
  await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);
  await folder.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(tree.getByRole('treeitem', { name: /alpha\.ts/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(tree.getByRole('treeitem', { name: /beta\.ts/ })).toBeFocused();

  // Regression: Enter on a focused file used to be swallowed.
  await page.keyboard.press('Enter');
  await expect(openFile(page)).toHaveText('src/beta.ts');
  await expect(tree.getByRole('treeitem', { name: /beta\.ts/ })).toHaveAttribute('aria-selected', 'true');

  // Type-ahead, as in a native tree.
  await page.keyboard.press('r');
  await expect(tree.getByRole('treeitem', { name: /README\.md/ })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(openFile(page)).toHaveText('README.md');

  // ArrowLeft from a file goes to its folder; Home and End reach the ends.
  await tree.getByRole('treeitem', { name: /alpha\.ts/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(folder).toBeFocused();
  await page.keyboard.press('End');
  await expect(tree.getByRole('treeitem', { name: /README\.md/ })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(folder).toBeFocused();
});

test('opening a folder elsewhere in a long tree does not scroll back to the open file', async ({ page }) => {
  const files: File[] = [];
  for (const folder of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    for (let index = 0; index < 12; index += 1) files.push({ file: `${folder}/file-${index}.ts`, type: 'unchanged' });
  }
  await serve(page, () => [], () => files);
  await page.goto('/#/workspaces/feature-x/changes');
  await code(page).getByRole('button', { name: 'Files', exact: true }).click();
  const tree = code(page).getByRole('tree', { name: 'repo files' });
  for (const folder of ['a', 'b', 'c', 'd']) await tree.getByRole('treeitem', { name: folder, exact: true }).click();
  await tree.getByRole('treeitem', { name: /a\/file-0\.ts|file-0\.ts/ }).first().click();
  await expect(openFile(page)).toHaveText('a/file-0.ts');

  const scroller = code(page).getByRole('complementary', { name: 'Files' }).locator('.overflow-y-auto');
  await scroller.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const scrolled = await scroller.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(200);
  await tree.getByRole('treeitem', { name: 'h', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'h', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(400);
  // Regression: every folder toggle scrolled the tree back to the open file at the top.
  expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(scrolled - 2);
});

test('a folder the user closed stays closed when the listing refreshes, and new folders arrive open', async ({ page }) => {
  let files: File[] = [{ file: 'src/app.ts', type: 'modified' }, { file: 'docs/guide.md', type: 'modified' }];
  await serve(page, () => files);
  await page.goto('/#/workspaces/feature-x/changes');
  const tree = code(page).getByRole('tree', { name: 'repo changed files' });
  await tree.getByRole('treeitem', { name: /app\.ts/ }).click();
  await expect(openFile(page)).toHaveText('src/app.ts');
  // Close the folder of the open file.
  await tree.getByRole('treeitem', { name: 'src', exact: true }).click();
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'false');

  files = [...files, { file: 'src/new.ts', type: 'added' }, { file: 'lib/util.ts', type: 'added' }];
  await code(page).getByRole('button', { name: 'More code actions' }).click();
  await page.getByRole('menuitem', { name: 'Refresh now' }).click();
  await expect(code(page).getByTestId('search-match-count')).toHaveText('4 changed files');
  // Regression: a refresh reopened the folder around the open file.
  await expect(tree.getByRole('treeitem', { name: 'src', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(tree.getByRole('treeitem', { name: 'lib', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(openFile(page)).toHaveText('src/app.ts');
});

test('the open file stays open while a filter hides it, and stepping follows the filtered files', async ({ page }) => {
  await serve(page, () => [
    { file: 'src/alpha.ts', type: 'modified' },
    { file: 'src/beta.ts', type: 'modified' },
    { file: 'test/beta.test.ts', type: 'modified' },
  ]);
  await page.goto('/#/workspaces/feature-x/changes');
  const section = code(page);
  await section.getByRole('treeitem', { name: /alpha\.ts/ }).click();
  await expect(openFile(page)).toHaveText('src/alpha.ts');
  await section.getByRole('searchbox', { name: 'Filter files' }).fill('beta');
  await expect(section.getByTestId('search-match-count')).toHaveText('2 of 3 files match');
  // Regression: the selection was a position in the list, so filtering silently opened another file.
  await expect(openFile(page)).toHaveText('src/alpha.ts');
  await expect(section.getByText('– / 2')).toBeVisible();
  await page.keyboard.press('Escape');
  await section.getByRole('searchbox', { name: 'Filter files' }).fill('beta');
  await section.getByRole('searchbox', { name: 'Filter files' }).blur();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(openFile(page)).toHaveText('src/beta.ts');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(openFile(page)).toHaveText('test/beta.test.ts');
});
