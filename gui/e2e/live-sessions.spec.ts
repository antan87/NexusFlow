import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Where each CLI is running, without opening any workspace: the sidebar puts those workspaces first and marks
 * each with what runs there and what it is doing, and a question from any of them shows where you already look.
 */
const workspace = (id: string, name: string, createdAt: string) => ({
  id, branchName: id, name, description: `${id} workspace`, repos: [], assistants: [], workspacePath: `/tmp/${id}`, createdAt,
});

test.use({
  workspacesData: [[
    // Newest first is the sidebar's default order: epsilon, delta, gamma, beta, alpha.
    workspace('alpha', 'Faster search', '2026-09-20T00:00:00Z'),
    workspace('beta', 'Importer', '2026-09-21T00:00:00Z'),
    workspace('gamma', 'Release notes', '2026-09-22T00:00:00Z'),
    workspace('delta', 'Login bug', '2026-09-23T00:00:00Z'),
    workspace('epsilon', 'Docs', '2026-09-24T00:00:00Z'),
  ], { option: true }],
  viewport: { width: 1440, height: 900 },
});

const CHAT_KEY = 'contextspace_floating_chat_state_v1';

type Running = { workspace: string; target: string; attached: boolean; outputAgoMs?: number; stopsInMs?: number };
/** alpha works in front, beta sits at its prompt, gamma's chat was closed and it is about to stop. */
const RUNNING: Running[] = [
  { workspace: 'alpha', target: 'claude', attached: true, outputAgoMs: 1000 },
  { workspace: 'beta', target: 'codex', attached: true, outputAgoMs: 60_000 },
  { workspace: 'gamma', target: 'shell', attached: false, stopsInMs: 4 * 60_000 - 5000 },
];

async function mockRunning(page: Page, { running = RUNNING, questions = [] as { workspaceId: string; message: string }[], fail = false } = {}) {
  await page.route('**/api/terminals/running', (route) => {
    if (fail) return route.fulfill({ status: 500, json: { error: 'down' } });
    const now = Date.now();
    return route.fulfill({ json: { sessions: running.map((entry, index) => ({
      id: `t${index}`, workspace: entry.workspace, target: entry.target, label: entry.target, cwd: `/tmp/${entry.workspace}`, state: 'running',
      startedAt: new Date(now - 600_000).toISOString(), attached: entry.attached,
      lastOutputAt: entry.outputAgoMs === undefined ? undefined : new Date(now - entry.outputAgoMs).toISOString(),
      stopsAt: entry.stopsInMs === undefined ? undefined : new Date(now + entry.stopsInMs).toISOString(),
    })) } });
  });
  await page.route('**/api/attention?*', (route) => {
    const wanted = new URL(route.request().url()).searchParams.get('workspaces')?.split(',') ?? [];
    return route.fulfill({ json: { requests: questions.filter((question) => wanted.includes(question.workspaceId)).map((question, index) => ({
      id: `q${index}`, timestamp: '2026-10-04T10:00:00.000Z', harness: 'codex', ...question,
    })) } });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    try {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ openTabs: ['alpha', 'beta'], activeTab: 'alpha', modes: {} }));
    } catch { /* Storage can be unavailable. */ }
  }, CHAT_KEY);
  await page.route('**/api/terminals/*/status', (route) => route.fulfill({ json: { available: true, sessions: [], targets: [{ id: 'shell', name: 'Shell', available: true, reason: null }] } }));
  await page.route('**/api/workspace/*/sessions', (route) => route.fulfill({ json: { sessions: [] } }));
});

const sidebar = (page: Page) => page.locator('aside.context-sidebar');
/** An open chat is a session in the sidebar, above the list of workspaces, in the order it was opened. */
const session = (page: Page, branch: string) => sidebar(page).locator(`[data-sidebar-session="${branch}"]`);
/** The list of workspaces on its own: open chats are listed above it, so a test of its order opens none. */
const noOpenChats = (page: Page) => page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ openTabs: [], activeTab: null, modes: {} })), CHAT_KEY);
const rowLink = (page: Page, name: string) => sidebar(page).getByRole('link', { name: new RegExp(`^${name}`) });
/** The row around a workspace link, where its marker sits. */
const rowOf = (page: Page, name: string) => rowLink(page, name).locator('xpath=..');
const order = async (page: Page) => (await sidebar(page).locator('a[href^="#/workspaces/"]').evaluateAll((links) => links.map((link) => link.getAttribute('href')))).map((href) => href!.split('/').pop());

test.describe('the sidebar says where each CLI runs', () => {
  test('puts those workspaces first, under Running now, and says what each is doing', async ({ page }) => {
    await noOpenChats(page);
    await mockRunning(page);
    await page.goto('/#/guide');
    await expect(sidebar(page).getByText('Running now', { exact: true })).toBeVisible();
    // Running first, each group in the chosen order (newest first).
    await expect.poll(() => order(page)).toEqual(['gamma', 'beta', 'alpha', 'epsilon', 'delta']);
    await expect(rowOf(page, 'Faster search').locator('[data-live]')).toHaveAttribute('data-live', 'working');
    await expect(rowOf(page, 'Importer').locator('[data-live]')).toHaveAttribute('data-live', 'idle');
    await expect(rowOf(page, 'Release notes').locator('[data-live]')).toHaveAttribute('data-live', 'closing');
    await expect(rowOf(page, 'Login bug').locator('[data-live]')).toHaveCount(0);
    // The same in words, for a screen reader and a tooltip.
    await expect(rowLink(page, 'Faster search')).toHaveAccessibleName(/Claude Code is running and working$/);
    await expect(rowLink(page, 'Importer')).toHaveAccessibleName(/Codex is running and idle$/);
    await expect(rowLink(page, 'Release notes')).toHaveAccessibleName(/Shell is running with no chat open, and stops in 4 minutes$/);
    await expect(rowOf(page, 'Release notes').locator('[data-live]')).toHaveAttribute('title', 'Shell is running with no chat open, and stops in 4 minutes');
  });

  test('keeps the list as it was when nothing runs', async ({ page }) => {
    await noOpenChats(page);
    await mockRunning(page, { running: [] });
    await page.goto('/#/guide');
    await expect.poll(() => order(page)).toEqual(['epsilon', 'delta', 'gamma', 'beta', 'alpha']);
    await expect(sidebar(page).getByText('Running now', { exact: true })).toHaveCount(0);
    await expect(sidebar(page).locator('[data-live]')).toHaveCount(0);
  });

  test('keeps working, with no markers, when the running CLIs cannot be read', async ({ page }) => {
    await noOpenChats(page);
    await mockRunning(page, { fail: true });
    await page.goto('/#/guide');
    await expect.poll(() => order(page)).toEqual(['epsilon', 'delta', 'gamma', 'beta', 'alpha']);
    await expect(sidebar(page).locator('[data-live]')).toHaveCount(0);
    await expect(sidebar(page).getByText('Running now', { exact: true })).toHaveCount(0);
  });

  test('marks an open chat on its own row, and does not list it again below', async ({ page }) => {
    await mockRunning(page);
    await page.goto('/#/workspaces/alpha/chat');
    await expect(session(page, 'alpha').locator('.live-dot')).toHaveAttribute('data-state', 'working');
    await expect(session(page, 'beta').locator('.live-dot')).toHaveAttribute('data-state', 'idle');
    // The open chats keep the order they were opened in; the list below holds the rest, running ones first.
    await expect.poll(() => sidebar(page).locator('[data-sidebar-session]').evaluateAll((links) => links.map((link) => link.getAttribute('data-sidebar-session')))).toEqual(['alpha', 'beta']);
    await expect(sidebar(page).locator('a[href="#/workspaces/alpha"], a[href="#/workspaces/beta"]')).toHaveCount(0);
    await expect(sidebar(page).locator('a[href="#/workspaces/gamma"]')).toHaveCount(1);
    await expect(sidebar(page).getByText('Running now', { exact: true })).toBeVisible();
  });
});

test.describe('when an AI waits for an answer', () => {
  test('its sidebar row says so with the question, until it is answered', async ({ page }) => {
    const questions = [{ workspaceId: 'beta', message: 'Which file format?\nCSV or JSON' }];
    await mockRunning(page, { questions });
    await page.goto('/#/guide');
    const importer = rowLink(page, 'Importer');
    await expect(importer).toContainText('Waiting for you');
    await expect(importer).toContainText('Which file format?');
    await expect(importer).not.toContainText('CSV or JSON');
    await expect(rowOf(page, 'Importer').locator('[data-live]')).toHaveAttribute('data-live', 'waiting');
    // Answered: the server lists it no more.
    questions.length = 0;
    await expect(importer).not.toContainText('Waiting for you', { timeout: 12_000 });
    await expect(rowOf(page, 'Importer').locator('[data-live]')).toHaveAttribute('data-live', 'idle');
  });

  test('a question from a CLI whose chat is closed still reaches the sidebar, and one click opens that chat', async ({ page }) => {
    await mockRunning(page, { questions: [{ workspaceId: 'gamma', message: 'Publish the notes now?' }] });
    await page.goto('/#/guide');
    await expect(rowLink(page, 'Release notes')).toContainText('Publish the notes now?');
    await expect(rowLink(page, 'Release notes')).toContainText('Waiting for you');
    await rowLink(page, 'Release notes').click();
    await expect(session(page, 'gamma')).toHaveAttribute('aria-current', 'page');
  });

  test('a question from a workspace with no open chat and nothing running is not shown', async ({ page }) => {
    let asked = '';
    await mockRunning(page, { questions: [{ workspaceId: 'delta', message: 'Old question?' }] });
    page.on('request', (request) => { if (request.url().includes('/api/attention')) asked = decodeURIComponent(request.url()); });
    await page.goto('/#/guide');
    await expect.poll(() => asked).toContain('gamma');
    expect(asked).not.toContain('delta');
    await expect(rowLink(page, 'Login bug')).not.toContainText('Old question?');
  });
});
