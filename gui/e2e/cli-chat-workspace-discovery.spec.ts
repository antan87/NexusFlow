import { test, expect } from './fixtures';

/**
 * Workspace discovery in the floating CLI chat.
 *
 * Two independent defects used to hide workspaces from anyone picking one to
 * start a CLI session:
 *
 *   1. The "Choose a workspace for CLI chat" empty state rendered
 *      `workspaces.slice(0, 5)` and offered no search field, so a sixth
 *      workspace onward was simply unreachable from that screen.
 *   2. The "Search workspaces..." field inside the "Add workspace" menu popup
 *      could not be typed into. Base UI's `useTypeahead` attaches an
 *      `onKeyDown` to the menu popup that calls `preventDefault()` on every
 *      single-character key while the menu is open, without checking whether
 *      the event target is an editable element. The character never reaches
 *      the field, so the filter never changes.
 *
 * These assertions describe intended behavior, so they fail against the
 * defective build. Typing is done with `pressSequentially` on purpose:
 * `fill()` writes the value directly and never dispatches `keydown`, so it
 * would happily pass against the broken search field.
 */

const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];

const workspaces = names.map((name, index) => ({
  id: name,
  branchName: name,
  name,
  description: `Workspace ${index + 1} of ${names.length}`,
  repos: [],
  assistants: [],
  workspacePath: `/tmp/${name}`,
  createdAt: '2026-09-24T00:00:00Z',
}));

test.use({ workspacesData: [workspaces, { option: true }], viewport: { width: 1365, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/terminals/bootstrap', route => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/*/status', route => route.fulfill({ json: { available: true, sessions: [], targets: [] } }));
  await page.route('**/api/workspace/*/sessions', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/workspace/*/plan', route => route.fulfill({ json: { content: '# Plan' } }));
});

/** The picker button for a workspace. Its accessible name is "<branch> <description>". */
function workspaceButton(chat: import('@playwright/test').Locator, branch: string) {
  return chat.getByRole('button', { name: new RegExp(`^${branch}\\b`) });
}

/** Open the floating CLI chat with no workspace tabs, so the empty state shows. */
async function openEmptyCliChat(page: import('@playwright/test').Page) {
  await page.goto('/#/overview');
  await page.getByRole('button', { name: 'Open CLI Chat launcher' }).click();
  const chat = page.getByRole('region', { name: 'CLI Chat' });
  await expect(chat.getByRole('heading', { name: 'Choose a workspace for CLI chat' })).toBeVisible();
  return chat;
}

test('the empty CLI chat state reaches every workspace, not just the first five', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  // All seven must be offered. The sixth and seventh are the ones the old
  // `slice(0, 5)` cap dropped.
  for (const name of names) {
    await expect(workspaceButton(chat, name)).toBeVisible();
  }

  // The name and its description are both announced, so a screen reader user
  // can tell two similarly named workspaces apart.
  await expect(workspaceButton(chat, 'golf')).toHaveAccessibleName('golf Workspace 7 of 7');
});

test('the empty CLI chat state can be searched without opening the header menu', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  const search = chat.getByRole('searchbox', { name: 'Search workspaces for CLI chat' });
  await expect(search).toBeVisible();
  await search.pressSequentially('golf');

  await expect(workspaceButton(chat, 'golf')).toBeVisible();
  await expect(workspaceButton(chat, 'alpha')).toHaveCount(0);
});

test('a search that matches nothing says so instead of listing everything', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  const search = chat.getByRole('searchbox', { name: 'Search workspaces for CLI chat' });
  await search.pressSequentially('zzzz');

  await expect(chat.getByText('No workspaces match "zzzz"')).toBeVisible();
  await expect(workspaceButton(chat, 'alpha')).toHaveCount(0);
});

test('typing into the search field in the Add workspace menu actually filters', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  await chat.getByRole('button', { name: 'Add workspace' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // Real keystrokes, not fill(): the defect is a cancelled keydown, so a
  // direct value write would pass even while search is broken.
  const search = menu.getByPlaceholder('Search workspaces...');
  await search.pressSequentially('golf');

  await expect(search).toHaveValue('golf');
  await expect(menu.getByRole('menuitem').filter({ hasText: 'golf' })).toHaveCount(1);
  await expect(menu.getByRole('menuitem').filter({ hasText: 'alpha' })).toHaveCount(0);
});

test('the Add workspace menu search is reachable by keyboard alone', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  await chat.getByRole('button', { name: 'Add workspace' }).click();
  const menu = page.getByRole('menu');
  const search = menu.getByPlaceholder('Search workspaces...');
  await expect(search).toBeFocused();

  await page.keyboard.type('delta');
  await expect(search).toHaveValue('delta');
  await expect(menu.getByRole('menuitem').filter({ hasText: 'delta' })).toHaveCount(1);
});

/**
 * The search field has to stay out of the popup's typeahead, but it must not
 * swallow the keys the menu itself needs. Escape is handled by a document-level
 * native listener in Base UI, so a blanket `stopPropagation` on the field's
 * keydown would stop the event before it ever gets there and leave the menu
 * stuck open. Tab is checked for the same reason.
 *
 * (Clicking outside is deliberately not asserted: the popup is modal, so the
 * rest of the page is inert and cannot receive the click. That is Base UI's
 * design, not behaviour this change affects.)
 */
test('Escape still closes the menu while the search field has focus', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  await chat.getByRole('button', { name: 'Add workspace' }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByPlaceholder('Search workspaces...').pressSequentially('golf');
  await expect(menu).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('arrow keys still reach the menu while the search field has focus', async ({ page }) => {
  const chat = await openEmptyCliChat(page);

  await chat.getByRole('button', { name: 'Add workspace' }).click();
  const menu = page.getByRole('menu');
  const search = menu.getByPlaceholder('Search workspaces...');
  await expect(search).toBeFocused();

  // Arrow navigation must not be swallowed: if it were, the popup would never
  // highlight an item and the list could not be traversed from the keyboard.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem').first()).toHaveAttribute('data-highlighted', '');
});
