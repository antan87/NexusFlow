import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The chat docked as the centre of the workspace. The promise is that it behaves like a place,
 * not a window: the address says which chat is showing, and leaving it for the plan or the
 * changes does not disconnect it.
 */
const workspace = (name: string, extra: Record<string, unknown> = {}) => ({
  id: name, branchName: name, description: `${name} workspace`, repos: [], assistants: [], workspacePath: `/tmp/${name}`, createdAt: '2026-09-24T00:00:00Z', ...extra,
});
const names = ['alpha', 'beta', 'gamma'];

test.use({ workspacesData: [[...names.map((name) => workspace(name)), workspace('old', { archivedAt: '2026-09-01T00:00:00Z' })], { option: true }], viewport: { width: 1365, height: 900 } });

/** How many times each workspace's terminal has attached, so a remount shows up as a second attach. */
let attaches: Record<string, number> = {};

test.beforeEach(async ({ page }) => {
  attaches = {};
  await page.route('**/api/terminals/bootstrap', (route) => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/*/status', (route) => {
    const id = route.request().url().split('/api/terminals/')[1]!.split('/')[0]!;
    const terminal = { id: `term-${id}`, workspace: id, target: 'shell', label: 'bash', cwd: `/tmp/${id}`, state: 'running' };
    return route.fulfill({ json: { available: true, sessions: [terminal], targets: [{ id: 'shell', name: 'Shell', available: true, reason: null }] } });
  });
  await page.route('**/api/workspace/*/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/workspace/*/plan', (route) => route.fulfill({ json: { content: '# Plan' } }));
  await page.routeWebSocket('**/ws/terminal', (socket) => {
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.type !== 'attach') return;
      attaches[parsed.workspace] = (attaches[parsed.workspace] ?? 0) + 1;
      const terminal = { id: parsed.id, workspace: parsed.workspace, target: 'shell', label: 'bash', cwd: `/tmp/${parsed.workspace}`, state: 'running' };
      socket.send(JSON.stringify({ type: 'ready', terminal, truncated: false }));
      socket.send(JSON.stringify({ type: 'replayed' }));
    });
  });
});

const chatOf = (page: Page) => page.getByRole('region', { name: 'CLI Chat', exact: true });
const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const tab = (page: Page, name: string) => chatOf(page).getByRole('tab', { name: new RegExp(`^Show ${name} in the left pane`) });
/**
 * Closes a chat's tab the accessible way: the Delete key on the focused tab. A terminal takes focus once it has
 * attached, and a key pressed then belongs to the terminal, so wait for the one in front to settle first.
 */
/** The state of the terminal on screen. While it runs the word is for screen readers only, so the pane is what is visible. */
const shownState = (page: Page) => chatOf(page).getByTestId('terminal-pane').filter({ visible: true }).getByTestId('terminal-state');
const settled = (page: Page) => expect(shownState(page)).toHaveText('Running', { timeout: 20_000 });
const closeTab = async (page: Page, name: string) => {
  await settled(page);
  await tab(page, name).focus();
  await page.keyboard.press('Delete');
};
/**
 * Closes a chat's tab with its cross. Its status icons arrive a moment after the terminal does and move the cross,
 * so wait for the tab to settle before aiming at it.
 */
const clickCross = async (page: Page, name: string) => {
  await settled(page);
  await tab(page, name).locator('[data-close-tab]').click();
};

test.describe('the chat is the centre of a workspace', () => {
  test('a workspace opens on its chat, with nothing open beside it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha');
    await expect(chatOf(page)).toBeVisible();
    await expect(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    // The rail offers what can open beside the chat; the chat is the page, so it has no item and none is current.
    await expect(workspaceNav(page).getByRole('link')).toHaveCount(6);
    await expect(workspaceNav(page).locator('[aria-current="page"]')).toHaveCount(0);
    // The address is left as it was given: no section is the chat.
    await expect(page).toHaveURL(/#\/workspaces\/alpha$/);
  });

  test('a link to a workspace chat opens that chat, even when another was open before', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await page.goto('/#/workspaces/gamma/chat');
    await expect(tab(page, 'gamma')).toHaveAttribute('aria-selected', 'true');
    // Both chats are open as tabs, and the one in the address is in front.
    await expect(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(2);
  });

  test('the chat is hidden, not closed, on every other destination', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page)).toBeVisible();
    for (const section of ['overview', 'plan', 'changes', 'sessions']) {
      await page.goto(`/#/workspaces/alpha/${section}`);
      await expect(chatOf(page)).toBeHidden();
    }
    await page.getByRole('button', { name: 'Close this panel and give the chat the whole screen' }).click();
    await expect(chatOf(page)).toBeVisible();
  });

  test('keeps the same terminal connected while you read the plan and come back', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    expect(attaches.alpha).toBe(1);

    await workspaceNav(page).getByRole('link', { name: 'Plan' }).click();
    await expect(chatOf(page)).toBeHidden();
    await workspaceNav(page).getByRole('link', { name: /^Changes/ }).click();
    await expect(page).toHaveURL(/\/changes$/);
    await page.getByRole('button', { name: 'Close this panel and give the chat the whole screen' }).click();

    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    // Still one connection: the terminal was never torn down and reattached.
    expect(attaches.alpha).toBe(1);
  });

  test('keeps other workspaces connected while one is in front, and while you leave the workspace page', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    // Both chats are mounted, one in front, so look only at the terminal that is showing.
    const showing = shownState(page);
    await expect(showing).toHaveText('Running');
    await tab(page, 'alpha').waitFor();
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(showing).toHaveText('Running');

    await page.goto('/#/overview');
    await expect(chatOf(page)).toBeHidden();
    await page.goto('/#/workspaces/alpha/chat');
    await expect(showing).toHaveText('Running');
    expect(attaches).toEqual({ alpha: 1, beta: 1 });
  });
});

test.describe('the address says which chat is showing', () => {
  test('choosing a tab goes to that chat, and back returns to the one before', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);

    await tab(page, 'alpha').click();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await expect(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');

    await page.goBack();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
  });

  test('closing the tab in front brings up the next chat and its address', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);

    await closeTab(page, 'beta');
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await expect(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'beta')).toHaveCount(0);
  });

  test('the cross closes a tab with the mouse, and the Delete key does the same from the keyboard', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /gamma/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/gamma\/chat$/);

    await clickCross(page, 'gamma');
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await expect(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(2);

    await closeTab(page, 'beta');
    await expect(tab(page, 'beta')).toHaveCount(0);
    await expect(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(1);
  });

  test('closing a tab from the keyboard does not drop focus to the page', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await closeTab(page, 'beta');
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    // Focus moves to the chat that took its place (its tab, or its terminal), never back to <body>.
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[aria-label="CLI Chat"]')))).toBe(true);
  });

  test('exposes the tabs as a tab list with nothing else inside it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    const list = chatOf(page).getByRole('tablist', { name: 'Open chats' });
    await expect(list.getByRole('tab')).toHaveCount(2);
    // The cross is not a control of its own: a screen reader meets the tab and the Delete shortcut.
    await expect(list.getByRole('button')).toHaveCount(0);
    await expect(tab(page, 'alpha')).toHaveAttribute('aria-keyshortcuts', 'Delete');
  });

  test('closing a tab that is not in front leaves the screen as it is', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);

    await closeTab(page, 'alpha');
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(1);
  });

  test('a reload stays on the same chat and does not navigate by itself', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await page.reload();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
    await expect(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(2);
  });

  test('asking to see a chat from elsewhere in the app goes to it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await page.goto('/#/workspaces/beta/sessions');
    await page.getByRole('button', { name: 'Open CLI Chat', exact: true }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
  });

  test('an archived workspace has no chat: its address shows its record', async ({ page }) => {
    await page.goto('/#/workspaces/old/chat');
    await expect(chatOf(page)).toBeHidden();
    await expect(workspaceNav(page).getByRole('link', { name: /^Chat/ })).toHaveCount(0);
    await page.goto('/#/workspaces/old');
    await expect(chatOf(page)).toBeHidden();
    await expect(workspaceNav(page).getByRole('link', { name: 'Record' })).toHaveAttribute('aria-current', 'page');
  });

  test('an old link to a section that no longer exists lands on the overview, not the chat', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/diff');
    await expect(chatOf(page)).toBeHidden();
    await expect(page.getByRole('region', { name: 'Overview', exact: true })).toBeVisible();
    await expect(workspaceNav(page).locator('[aria-current="page"]')).toHaveCount(0);
  });
});

test.describe('on a slow machine', () => {
  // The address bar changes at once, but the app applies its own copy of the location a moment later when the
  // page is busy. The user can act in between, so what they did last must win.
  // Everything is slow here, including the page rendering what the test waits for, so waits are generous.
  test.setTimeout(120_000);
  // Waiting for the page to catch up is the point of these tests, so their assertions wait longer.
  const slow = expect.configure({ timeout: 20_000 });
  test.beforeEach(async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  });

  test('closing a tab straight after opening it does not bring it back', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await slow(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await slow(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await closeTab(page, 'beta');

    // Settle: wherever the app ends up, it is the chat that is still open, and it agrees with the address.
    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/, { timeout: 15_000 });
    await slow(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await slow(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(1);
    await page.waitForTimeout(1500);
    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await slow(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(1);
  });

  test('opening two chats quickly and closing the one in front lands on the other, not on one that was only passed through', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await slow(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /gamma/ }).click();
    await slow(page).toHaveURL(/#\/workspaces\/gamma\/chat$/);
    await clickCross(page, 'gamma');

    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/, { timeout: 15_000 });
    await page.waitForTimeout(2000);
    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await slow(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
    // Beta was passed through on the way; it is still open, and it is not the one in front.
    await slow(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(2);
    await slow(tab(page, 'beta')).toHaveAttribute('aria-selected', 'false');
  });

  test('choosing a tab and then closing it does not bring it back', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await slow(page).toHaveURL(/#\/workspaces\/beta\/chat$/, { timeout: 15_000 });
    await slow(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
    await tab(page, 'alpha').click();
    await closeTab(page, 'beta');

    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await slow(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await slow(chatOf(page).getByRole('tablist', { name: 'Open chats' }).getByRole('tab')).toHaveCount(1);
    await slow(tab(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('the dock sits exactly over its slot', () => {
  const box = async (locator: ReturnType<typeof chatOf>) => {
    const b = await locator.boundingBox();
    if (!b) throw new Error('no box');
    return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  };

  test('fills the space under the header and beside the rail, and follows the window and the sidebar', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page)).toBeVisible();
    const slot = page.getByTestId('chat-dock-slot');

    const header = await page.locator('header').first().boundingBox();
    const rail = await workspaceNav(page).boundingBox();
    const first = await box(chatOf(page));
    // Right under the header and left of the rail, over neither.
    expect(first.y).toBeGreaterThanOrEqual(Math.round(header!.y + header!.height) - 1);
    expect(first.x + first.width).toBeLessThanOrEqual(Math.round(rail!.x) + 1);
    expect(first).toEqual(await box(slot));

    await page.setViewportSize({ width: 1100, height: 760 });
    await expect.poll(async () => JSON.stringify(await box(chatOf(page)))).toBe(JSON.stringify(await box(slot)));
    const narrower = await box(chatOf(page));
    expect(narrower.width).toBeLessThan(first.width);
    expect(narrower.height).toBeLessThan(first.height);

    // The sidebar collapsing gives the chat its room. (The `z` shortcut would type into the terminal, which has focus.)
    await page.getByRole('button', { name: /^Collapse/ }).click();
    await expect.poll(async () => (await box(chatOf(page))).width).toBeGreaterThan(narrower.width);
    expect(await box(chatOf(page))).toEqual(await box(slot));
  });

  test('reaches the bottom of the window with no page scroll of its own', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page)).toBeVisible();
    const b = await box(chatOf(page));
    expect(b.y + b.height).toBeGreaterThanOrEqual(900 - 2);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  });

  test('keeps its header short: the facts live in the strip, not above it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page)).toBeVisible();
    await expect(page.getByRole('group', { name: 'Task status' })).toHaveCount(0);
    await page.goto('/#/workspaces/alpha/plan');
    await expect(page.getByRole('group', { name: 'Task status' })).toBeVisible();
  });
});

test.describe('a menu opened over the chat stays above it', () => {
  test('the Add workspace menu is not hidden behind the dock', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    const item = page.getByRole('menuitem', { name: /beta/ });
    await expect(item).toBeVisible();
    // Visible and clickable: nothing sits on top of it.
    await item.click({ trial: true });
  });
});
