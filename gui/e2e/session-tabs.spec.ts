import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * More than one CLI in one workspace: every running terminal has a session tab, another tool starts from the +
 * beside them, two can be shown side by side, and closing a running one asks first and ends only that one.
 */
const workspace = { id: 'feature-x', branchName: 'feature-x', name: 'Faster search', description: 'Speed up search', repos: [], assistants: [], workspacePath: '/tmp/feature-x', createdAt: '2026-09-20T00:00:00Z' };
test.use({ workspacesData: [[workspace], { option: true }], viewport: { width: 1440, height: 900 } });

type Terminal = { id: string; workspace: string; target: string; label: string; cwd: string; state: 'running' | 'exited'; startedAt: string };
const terminal = (id: string, target: string, label: string): Terminal => ({ id, workspace: 'feature-x', target, label, cwd: '/tmp/feature-x', state: 'running', startedAt: '2026-10-04T10:00:00.000Z' });
const TARGETS = ['claude', 'codex', 'shell'].map((id) => ({ id, name: id, available: true, reason: null }));

interface Server { terminals: Terminal[]; created: string[]; stopped: string[]; attached: string[] }

async function mockServer(page: Page, initial: Terminal[], { failStatus = false, failStop = false } = {}): Promise<Server> {
  const server: Server = { terminals: [...initial], created: [], stopped: [], attached: [] };
  await page.addInitScript(() => {
    try { if (!localStorage.getItem('contextspace_floating_chat_state_v1')) localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ openTabs: ['feature-x'], activeTab: 'feature-x', modes: {} })); } catch { /* Storage can be unavailable. */ }
  });
  await page.route('**/api/terminals/feature-x/status', (route) => (failStatus
    ? route.fulfill({ status: 500, json: { error: 'The terminal service did not answer' } })
    : route.fulfill({ json: { available: true, sessions: server.terminals, targets: TARGETS } })));
  await page.route('**/api/terminals/feature-x/create', async (route) => {
    const body = route.request().postDataJSON() as { target: string };
    server.created.push(body.target);
    const created = terminal(`t-${body.target}-${server.created.length}`, body.target, body.target);
    server.terminals.push(created);
    await route.fulfill({ json: { terminal: created } });
  });
  await page.route('**/api/terminals/feature-x/*/stop', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/')[4]!;
    if (failStop) return route.fulfill({ status: 500, json: { error: 'The terminal did not stop' } });
    server.stopped.push(id);
    server.terminals = server.terminals.map((entry) => (entry.id === id ? { ...entry, state: 'exited' } : entry));
    await route.fulfill({ json: {} });
  });
  await page.route('**/api/workspace/feature-x/sessions*', (route) => route.fulfill({ json: { sessions: [] } }));
  await page.routeWebSocket('**/ws/terminal', (socket) => {
    socket.onMessage((message) => {
      const parsed = JSON.parse(String(message));
      if (parsed.type !== 'attach') return;
      server.attached.push(parsed.id);
      const found = server.terminals.find((entry) => entry.id === parsed.id);
      socket.send(JSON.stringify({ type: 'ready', terminal: found, truncated: false }));
      socket.send(JSON.stringify({ type: 'output', data: `this is ${parsed.id}\r\n` }));
      socket.send(JSON.stringify({ type: 'replayed' }));
    });
  });
  return server;
}

const chatOf = (page: Page) => page.getByRole('region', { name: 'CLI Chat', exact: true });
const sessionTabs = (page: Page) => chatOf(page).getByRole('tablist', { name: 'CLI sessions' }).getByRole('tab');
const panes = (page: Page) => page.getByTestId('terminal-pane').filter({ visible: true });

test('every running CLI of the workspace gets one tab, named after its tool', async ({ page }) => {
  const server = await mockServer(page, [terminal('t-claude', 'claude', 'Claude Code'), terminal('t-codex', 'codex', 'Codex')]);
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(sessionTabs(page)).toHaveCount(2);
  await expect(sessionTabs(page).nth(0)).toHaveAccessibleName(/^Claude Code, /);
  await expect(sessionTabs(page).nth(1)).toHaveAccessibleName(/^Codex, /);
  await expect(sessionTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(panes(page)).toHaveCount(1);
  await expect(panes(page).getByTestId('terminal-state')).toHaveText('Running');
  await sessionTabs(page).nth(1).click();
  await expect(sessionTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panes(page).getByTestId('terminal-state')).toHaveText('Running');
  // Both stay connected while one is hidden, each attached once; nothing was started.
  await expect.poll(() => [...server.attached].sort()).toEqual(['t-claude', 't-codex']);
  expect(server.created).toEqual([]);
});

test('the + starts another tool in a tab of its own, beside the one that runs', async ({ page }) => {
  const server = await mockServer(page, [terminal('t-claude', 'claude', 'Claude Code')]);
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(sessionTabs(page)).toHaveCount(1);
  await chatOf(page).getByRole('button', { name: 'Start another CLI' }).click();
  await page.getByRole('menuitem', { name: 'Start Codex' }).click();
  await expect.poll(() => server.created).toEqual(['codex']);
  await expect(sessionTabs(page)).toHaveCount(2);
  await expect(sessionTabs(page).nth(1)).toHaveAccessibleName(/^Codex, /);
  await expect(sessionTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panes(page).getByTestId('terminal-state')).toHaveText('Running');
  // The new terminal is not adopted a second time when the list is read again.
  await page.waitForTimeout(5500);
  await expect(sessionTabs(page)).toHaveCount(2);
});

test('two sessions show side by side, in tab order, and back to one', async ({ page }) => {
  await mockServer(page, [terminal('t-claude', 'claude', 'Claude Code'), terminal('t-codex', 'codex', 'Codex')]);
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(sessionTabs(page)).toHaveCount(2);
  await sessionTabs(page).nth(1).click();
  const toggle = chatOf(page).getByRole('button', { name: 'Show two sessions side by side' });
  await toggle.click();
  await expect(panes(page)).toHaveCount(2);
  const [left, right] = [await panes(page).nth(0).boundingBox(), await panes(page).nth(1).boundingBox()];
  expect(left!.x).toBeLessThan(right!.x);
  await expect(panes(page).nth(0).locator('.xterm-rows')).toContainText('this is t-claude');
  await expect(panes(page).nth(1).locator('.xterm-rows')).toContainText('this is t-codex');
  await chatOf(page).getByRole('button', { name: 'Show one session' }).click();
  await expect(panes(page)).toHaveCount(1);
});

test('closing a running session asks first and ends only that one; saying no keeps it', async ({ page }) => {
  const server = await mockServer(page, [terminal('t-claude', 'claude', 'Claude Code'), terminal('t-codex', 'codex', 'Codex')]);
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(sessionTabs(page)).toHaveCount(2);
  await expect(panes(page).getByTestId('terminal-state')).toHaveText('Running');
  await sessionTabs(page).nth(1).focus();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.keyboard.press('Delete');
  await expect(sessionTabs(page)).toHaveCount(2);
  expect(server.stopped).toEqual([]);
  page.once('dialog', (dialog) => { expect(dialog.message()).toContain('End Codex?'); void dialog.accept(); });
  await sessionTabs(page).nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(sessionTabs(page)).toHaveCount(1);
  expect(server.stopped).toEqual(['t-codex']);
  await expect(sessionTabs(page).nth(0)).toHaveAccessibleName(/^Claude Code, /);
});

test('a session that cannot be ended keeps its tab and says why, instead of coming back later', async ({ page }) => {
  const server = await mockServer(page, [terminal('t-claude', 'claude', 'Claude Code'), terminal('t-codex', 'codex', 'Codex')], { failStop: true });
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(sessionTabs(page)).toHaveCount(2);
  page.once('dialog', (dialog) => void dialog.accept());
  await sessionTabs(page).nth(1).focus();
  await page.keyboard.press('Delete');
  await expect(chatOf(page).getByRole('alert')).toContainText('Codex could not be ended, so it is still running: The terminal did not stop');
  await expect(sessionTabs(page)).toHaveCount(2);
  expect(server.stopped).toEqual([]);
});

test('a workspace whose terminals cannot be listed says so and does not wait forever', async ({ page }) => {
  await mockServer(page, [], { failStatus: true });
  await page.goto('/#/workspaces/feature-x/chat');
  await expect(panes(page).getByRole('alert')).toContainText('The terminal service did not answer');
  await expect(panes(page).getByText('Looking for running sessions…')).toHaveCount(0);
  await expect(panes(page).getByText('Checking which CLI tools are installed…')).toHaveCount(0);
  await expect(panes(page).getByRole('button', { name: 'Refresh the CLI tools' })).toBeVisible();
});
