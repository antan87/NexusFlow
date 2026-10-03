import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The chat is the centre of the app. It takes most of the screen, the other parts of a workspace
 * (plan, changes, documents) open as a narrower panel beside it when asked for, workspaces are
 * switched from inside the chat, and the app opens on the chat you were last in.
 */
const workspace = (id: string, extra: Record<string, unknown> = {}) => ({
  id, branchName: id, description: `${id} workspace`, repos: [], assistants: [], workspacePath: `/tmp/${id}`, createdAt: '2026-09-24T00:00:00Z', ...extra,
});

test.use({
  workspacesData: [[workspace('alpha', { name: 'Faster search' }), workspace('beta'), workspace('old', { archivedAt: '2026-09-01T00:00:00Z' })], { option: true }],
  viewport: { width: 1440, height: 900 },
});

const LAYOUT_KEY = 'contextspace_chat_layout_v1';
const CHAT_KEY = 'contextspace_floating_chat_state_v1';

test.beforeEach(async ({ page }) => {
  // The chat shows beside other parts here, unlike the fixture's default.
  // Seeded once per tab, over the fixture's default, so a reload keeps whatever the page saved.
  await page.addInitScript((key) => {
    try {
      if (!sessionStorage.getItem('layout-seeded')) { localStorage.setItem(key, JSON.stringify({ hidden: false, percent: 62 })); sessionStorage.setItem('layout-seeded', '1'); }
    } catch { /* Storage can be unavailable. */ }
  }, LAYOUT_KEY);
  await page.route('**/api/terminals/bootstrap', (route) => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/*/status', (route) => {
    const id = route.request().url().split('/api/terminals/')[1]!.split('/')[0]!;
    return route.fulfill({ json: { available: true, sessions: [{ id: `term-${id}`, workspace: id, target: 'shell', label: 'bash', cwd: `/tmp/${id}`, state: 'running' }], targets: [{ id: 'shell', name: 'Shell', available: true, reason: null }] } });
  });
  await page.route('**/api/workspace/*/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/workspace/*/plan', (route) => route.fulfill({ json: { content: '# Plan' } }));
  await page.routeWebSocket('**/ws/terminal', (socket) => {
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.type !== 'attach') return;
      socket.send(JSON.stringify({ type: 'ready', terminal: { id: parsed.id, workspace: parsed.workspace, target: 'shell', label: 'bash', cwd: `/tmp/${parsed.workspace}`, state: 'running' }, truncated: false }));
      socket.send(JSON.stringify({ type: 'replayed' }));
    });
  });
});

const chatOf = (page: Page) => page.getByRole('region', { name: 'CLI Chat', exact: true });
const destinations = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });
const tab = (page: Page, name: string) => chatOf(page).getByRole('tab', { name: new RegExp(`^Show ${name} in the left pane`) });
const boxOf = async (locator: ReturnType<typeof chatOf>) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return box;
};
const BODY_LEFT = 256;

test.describe('the app opens on the chat', () => {
  test('on the chat you were last in', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ openTabs: ['alpha', 'beta'], activeTab: 'beta', modes: {} })), CHAT_KEY);
    await page.goto('/');
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(chatOf(page)).toBeVisible();
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
  });

  test('on the overview when no chat was open, and the overview is still one click away', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('aside.context-sidebar')).toBeVisible();
    await expect(page).not.toHaveURL(/workspaces/);
    await expect(chatOf(page)).toBeHidden();
    await page.goto('/#/workspaces/alpha/chat');
    await page.locator('aside.context-sidebar').getByRole('link', { name: /^Overview/ }).click();
    await expect(page).toHaveURL(/#\/overview$/);
  });

  test('on the overview when the chat you were in no longer exists', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ openTabs: ['deleted'], activeTab: 'deleted', modes: {} })), CHAT_KEY);
    await page.goto('/');
    await expect(page.locator('aside.context-sidebar')).toBeVisible();
    await expect(page).not.toHaveURL(/workspaces/);
    await expect(chatOf(page)).toBeHidden();
  });
});

test.describe('the chat is central, with other parts beside it', () => {
  test('takes most of the width, with the part in a narrower panel beside it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page)).toBeVisible();
    await expect(page.getByLabel('Current objective')).toBeVisible();
    const chat = await boxOf(chatOf(page));
    const panel = await boxOf(page.getByLabel('Current objective'));
    const body = 1440 - BODY_LEFT;
    expect(chat.width / body).toBeGreaterThan(0.55);
    expect(chat.width).toBeGreaterThan(panel.width);
    // The chat is on the left of the part it is beside.
    expect(chat.x + chat.width).toBeLessThanOrEqual(panel.x + 1);
    await expect(page.getByRole('separator', { name: 'Resize the chat' })).toBeVisible();
  });

  test('closing the part gives the chat the whole width back', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page)).toBeVisible();
    const beside = await boxOf(chatOf(page));
    await page.getByRole('button', { name: 'Close this panel and give the chat the whole screen' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
    await expect.poll(async () => (await boxOf(chatOf(page))).width).toBeGreaterThan(beside.width + 100);
    expect((await boxOf(chatOf(page))).width).toBeGreaterThan(1440 - BODY_LEFT - 4);
    await expect(page.getByRole('separator', { name: 'Resize the chat' })).toHaveCount(0);
  });

  test('opens another part from the header without the chat leaving', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    await destinations(page).getByRole('link', { name: 'Changes' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/changes$/);
    await expect(chatOf(page)).toBeVisible();
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    await destinations(page).getByRole('link', { name: 'Plan & Context' }).click();
    await expect(chatOf(page)).toBeVisible();
  });

  test('keeps the same terminal while the part beside it changes', async ({ page }) => {
    let attaches = 0;
    await page.routeWebSocket('**/ws/terminal', (socket) => {
      socket.onMessage((message) => {
        const parsed = JSON.parse(String(message));
        if (parsed.type !== 'attach') return;
        attaches += 1;
        socket.send(JSON.stringify({ type: 'ready', terminal: { id: parsed.id, workspace: parsed.workspace, target: 'shell', label: 'bash', cwd: '/tmp', state: 'running' }, truncated: false }));
        socket.send(JSON.stringify({ type: 'replayed' }));
      });
    });
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    await destinations(page).getByRole('link', { name: 'Changes' }).click();
    await destinations(page).getByRole('link', { name: 'Run' }).click();
    await destinations(page).getByRole('link', { name: 'Chat' }).click();
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    expect(attaches).toBe(1);
  });

  test('has no room for both on a narrow window, so the part gets the screen and Chat brings the chat back', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/#/workspaces/alpha/plan');
    await expect(page.getByLabel('Current objective')).toBeVisible();
    await expect(chatOf(page)).toBeHidden();
    await expect(page.getByRole('separator', { name: 'Resize the chat' })).toHaveCount(0);
    await destinations(page).getByRole('link', { name: 'Chat' }).click();
    await expect(chatOf(page)).toBeVisible();
  });

  test('an archived workspace has no chat beside its record', async ({ page }) => {
    await page.goto('/#/workspaces/old/plan');
    await expect(chatOf(page)).toBeHidden();
  });
});

test.describe('the chat can be hidden for a while, and given more or less room', () => {
  test('hides and shows the chat beside a part, and remembers it', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page)).toBeVisible();
    await page.getByRole('button', { name: 'Hide the chat and give this the whole width' }).click();
    await expect(chatOf(page)).toBeHidden();
    await page.reload();
    await expect(page.getByLabel('Current objective')).toBeVisible();
    await expect(chatOf(page)).toBeHidden();
    await page.getByRole('button', { name: 'Show the chat beside this' }).click();
    await expect(chatOf(page)).toBeVisible();
  });

  test('resizes with the arrow keys within limits, and remembers the width', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    const divider = page.getByRole('separator', { name: 'Resize the chat' });
    await expect(divider).toHaveAttribute('aria-valuenow', '62');
    // A terminal takes focus once it has attached, so let it, then move to the divider.
    await expect(chatOf(page).getByTestId('terminal-state')).toHaveText('Running');
    await divider.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(divider).toHaveAttribute('aria-valuenow', '59');
    const narrower = await boxOf(chatOf(page));
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', '65');
    expect((await boxOf(chatOf(page))).width).toBeGreaterThan(narrower.width);
    for (let i = 0; i < 10; i += 1) await page.keyboard.press('ArrowRight');
    await expect(divider).toHaveAttribute('aria-valuenow', '80');
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize the chat' })).toHaveAttribute('aria-valuenow', '80');
  });
});

test.describe('workspaces are switched from inside the chat', () => {
  test('tabs are named by the workspace, with the branch as a detail', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'Faster search')).toBeVisible();
    await expect(tab(page, 'Faster search')).toHaveAttribute('title', 'Faster search (alpha)');
    // A workspace without a name is known by its branch.
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /Faster search/ }).waitFor();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(tab(page, 'beta')).toBeVisible();
  });

  test('switching keeps the part you are reading, now for the other workspace', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page)).toBeVisible();
    await chatOf(page).getByRole('button', { name: 'Add workspace' }).click();
    await page.getByRole('menuitem', { name: /beta/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/plan$/);
    await expect(tab(page, 'beta')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Current objective')).toBeVisible();
    await tab(page, 'Faster search').click();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/plan$/);
    await expect(tab(page, 'Faster search')).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('the header carries the destinations, so there is one bar, not two', () => {
  test('puts the title, the destinations and the actions on one row while the chat shows', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/plan');
    await expect(chatOf(page)).toBeVisible();
    const header = page.locator('header').first();
    await expect(header.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(header.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
    const title = await boxOf(header.getByRole('heading', { level: 1 }));
    const nav = await boxOf(header.getByRole('navigation', { name: 'Workspace' }));
    expect(Math.abs((title.y + title.height / 2) - (nav.y + nav.height / 2))).toBeLessThan(12);
  });

  test('puts the sections of the open part at the top of its panel', async ({ page }) => {
    await page.goto('/#/workspaces/alpha/documents');
    const sections = page.getByRole('navigation', { name: 'Plan & Context sections' });
    await expect(sections).toBeVisible();
    await expect(page.locator('header').first().getByRole('navigation', { name: 'Plan & Context sections' })).toHaveCount(0);
    await sections.getByRole('link', { name: 'Plan' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/plan$/);
  });
});
