import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const workspace = (name: string) => ({
  id: name, branchName: name, description: `${name} workspace`, repos: [], assistants: [], workspacePath: `/tmp/${name}`, createdAt: '2026-09-24T00:00:00Z',
});
const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

test.use({ workspacesData: [names.map(workspace), { option: true }], viewport: { width: 1365, height: 900 } });

const CHAT_KEY = 'contextspace_floating_chat_state_v1';

type Request = { workspaceId: string; id: string; timestamp: string; harness: string; message: string };
let requests: Request[] = [];
let polls = 0;
let counter = 0;

const ask = (workspaceId: string, message: string, id = `req-${++counter}`): Request => ({
  workspaceId, id, timestamp: new Date().toISOString(), harness: 'claude', message,
});

/** Resolves once the app has polled again, so a change made now has been offered to it. */
async function nextPoll() {
  const before = polls;
  await expect.poll(() => polls, { timeout: 12_000 }).toBeGreaterThan(before);
}

/** Starts every load of the page with the floating chat in this state. */
async function chatState(page: Page, state: { isOpen: boolean; isMinimized?: boolean; tabs?: string[] }) {
  const tabs = state.tabs ?? ['alpha', 'beta'];
  await page.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), [CHAT_KEY, JSON.stringify({
    isOpen: state.isOpen, isMinimized: state.isMinimized ?? false, openTabs: tabs, activeTab: tabs[0],
    modes: Object.fromEntries(tabs.map(tab => [tab, 'cli'])),
  })]);
}

test.beforeEach(async ({ page }) => {
  requests = [];
  polls = 0;
  await page.route('**/api/terminals/bootstrap', route => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/*/status', route => route.fulfill({ json: { available: true, sessions: [], targets: [] } }));
  await page.route('**/api/workspace/*/sessions', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/workspace/*/plan', route => route.fulfill({ json: { content: '# Plan' } }));
  await page.route('**/api/attention?*', route => {
    polls++;
    const wanted = new URL(route.request().url()).searchParams.get('workspaces')?.split(',') ?? [];
    return route.fulfill({ json: { requests: requests.filter(request => wanted.includes(request.workspaceId)) } });
  });
  // By default two chats are open with alpha in front. Seeded once, so a reload keeps whatever the app saved.
  await page.addInitScript((key) => {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({
        isOpen: true, isMinimized: false, openTabs: ['alpha', 'beta'], activeTab: 'alpha', modes: { alpha: 'cli', beta: 'cli' },
      }));
    }
  }, CHAT_KEY);
});

const chatOf = (page: Page) => page.getByRole('region', { name: 'CLI Chat' });
const alertsOf = (page: Page) => page.getByRole('status', { name: 'Chats waiting for you' });
const chipOf = (page: Page) => chatOf(page).getByRole('button', { name: /chats? waiting for you\. Show/ });

test.describe('chat window open', () => {
  test('flags the waiting chat, and the header chip jumps to it', async ({ page }) => {
    await page.goto('/#/overview');
    const chat = chatOf(page);
    await expect(chat.getByRole('tab', { name: 'Show beta in the left pane' })).toBeVisible();
    await expect(chipOf(page)).toHaveCount(0);

    requests.push(ask('beta', 'Which database should the migration target?'));

    await expect(chipOf(page)).toHaveAccessibleName('1 chat waiting for you. Show beta.', { timeout: 12_000 });
    await expect(chipOf(page)).toContainText('1 waiting');
    await expect(chipOf(page)).toHaveAttribute('title', /beta: Which database should the migration target\?/);
    // The tab that needs the user is marked; the other is not.
    await expect(chat.getByRole('tab', { name: 'Show beta in the left pane, waiting for your input' })).toBeVisible();
    await expect(chat.getByRole('tab', { name: 'Show alpha in the left pane' })).toBeVisible();
    await expect(page).toHaveTitle(/^\(1\) /);
    // Floating cards would sit on the chat's own header, so none are shown while it is open.
    await expect(alertsOf(page)).toHaveCount(0);

    await chipOf(page).click();

    await expect(chat.getByRole('tab', { name: /^Show beta in the left pane/ })).toHaveAttribute('aria-selected', 'true');
    await expect(chipOf(page)).toHaveCount(0);
    await expect(chat.getByRole('tab', { name: 'Show beta in the left pane' })).toBeVisible();
    await expect(page).not.toHaveTitle(/^\(\d+\) /);
  });

  test('does not alert for the chat the user is already looking at', async ({ page }) => {
    await page.goto('/#/overview');
    await page.bringToFront();
    const chat = chatOf(page);
    await expect(chat.getByRole('tab', { name: 'Show alpha in the left pane' })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.hasFocus())).toBe(true);

    requests.push(ask('alpha', 'Proceed with the rewrite?'));
    await nextPoll();
    await nextPoll();

    await expect(chipOf(page)).toHaveCount(0);
    await expect(chat.getByRole('tab', { name: 'Show alpha in the left pane' })).toBeVisible();
    await expect(page).not.toHaveTitle(/^\(\d+\) /);
  });

  test('keeps the alert for the chat in front while the window is not focused, and clears it on return', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__focused = false;
      document.hasFocus = () => (window as any).__focused === true;
    });
    await page.goto('/#/overview');
    await expect(chatOf(page).getByRole('tab', { name: 'Show alpha in the left pane' })).toHaveAttribute('aria-selected', 'true');

    requests.push(ask('alpha', 'Approve the schema change?'));

    await expect(chipOf(page)).toBeVisible({ timeout: 12_000 });
    await nextPoll();
    await expect(chipOf(page)).toBeVisible();

    await page.evaluate(() => {
      (window as any).__focused = true;
      window.dispatchEvent(new Event('focus'));
    });

    await expect(chipOf(page)).toHaveCount(0);
  });

  test('counts every waiting chat in the chip', async ({ page }) => {
    await chatState(page, { isOpen: true, tabs: ['alpha', 'beta', 'gamma', 'delta'] });
    await page.goto('/#/overview');
    requests.push(ask('beta', 'Question from beta'), ask('delta', 'Question from delta'));

    await expect(chipOf(page)).toHaveAccessibleName(/^2 chats waiting for you\. Show /, { timeout: 12_000 });
    await expect(chipOf(page)).toContainText('2 waiting');
  });
});

test.describe('chat window closed or minimized', () => {
  test('shows a card with the question, and Open chat opens that chat', async ({ page }) => {
    await chatState(page, { isOpen: false });
    await page.goto('/#/overview');
    await expect(chatOf(page)).toBeHidden();

    requests.push(ask('beta', 'Which database should the migration target?'));

    const alerts = alertsOf(page);
    await expect(alerts).toContainText('beta is waiting for you', { timeout: 12_000 });
    await expect(alerts).toContainText('Which database should the migration target?');
    await expect(alerts).toContainText('Claude Code');
    await expect(page).toHaveTitle(/^\(1\) /);

    await alerts.getByRole('button', { name: 'Open chat' }).click();

    const chat = chatOf(page);
    await expect(chat).toBeVisible();
    await expect(chat.getByRole('tab', { name: /^Show beta in the left pane/ })).toHaveAttribute('aria-selected', 'true');
    await expect(alerts).toHaveCount(0);
    await expect(page).not.toHaveTitle(/^\(\d+\) /);
  });

  test('a dismissed alert stays dismissed after a reload, and a new question raises it again', async ({ page }) => {
    await chatState(page, { isOpen: false });
    await page.goto('/#/overview');
    requests.push(ask('beta', 'First question?', 'q1'));
    await expect(alertsOf(page)).toContainText('beta is waiting for you', { timeout: 12_000 });

    await alertsOf(page).getByRole('button', { name: 'Dismiss the alert for beta' }).click();
    await expect(alertsOf(page)).toHaveCount(0);

    await page.reload();
    await nextPoll();
    await expect(page.getByRole('button', { name: 'Open CLI Chat launcher' })).toBeVisible();
    await expect(alertsOf(page)).toHaveCount(0);

    requests = [ask('beta', 'Second question?', 'q2')];
    await expect(alertsOf(page)).toContainText('Second question?', { timeout: 12_000 });
  });

  test('shows the agent text as plain text', async ({ page }) => {
    await chatState(page, { isOpen: false });
    await page.goto('/#/overview');
    requests.push(ask('beta', '<img src=x onerror="window.__pwned=1"> **not bold** <script>window.__pwned=2</script>'));

    const alerts = alertsOf(page);
    await expect(alerts).toContainText('**not bold**', { timeout: 12_000 });
    await expect(alerts).toContainText('<img src=x onerror="window.__pwned=1">');
    await expect(alerts.locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  });

  test('names the waiting chats on the minimized pill', async ({ page }) => {
    await chatState(page, { isOpen: true, isMinimized: true });
    await page.goto('/#/overview');
    requests.push(ask('beta', 'Ready for review?'));

    await expect(page.getByTitle('Restore floating CLI chat')).toContainText('1 waiting for you', { timeout: 12_000 });
    await expect(alertsOf(page)).toContainText('beta is waiting for you');
  });

  test('puts a count on the launcher', async ({ page }) => {
    await chatState(page, { isOpen: false });
    await page.goto('/#/overview');
    requests.push(ask('beta', 'Ready for review?'), ask('alpha', 'And this one?'));

    await expect(page.getByRole('button', { name: 'Open CLI Chat launcher, 2 waiting for you' })).toBeVisible({ timeout: 12_000 });
    await expect(alertsOf(page).getByRole('button', { name: 'Open chat' })).toHaveCount(2);
  });

  test('lists at most four cards and says how many more are waiting', async ({ page }) => {
    await chatState(page, { isOpen: false, tabs: names });
    await page.goto('/#/overview');
    requests.push(...names.map(name => ask(name, `Question from ${name}`)));

    const alerts = alertsOf(page);
    await expect(alerts.getByRole('button', { name: 'Open chat' })).toHaveCount(4, { timeout: 12_000 });
    await expect(alerts).toContainText('1 more chat is waiting');
    await expect(page).toHaveTitle(/^\(5\) /);
  });
});
