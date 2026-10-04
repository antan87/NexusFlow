import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Every open chat says what it is working on without being opened: its tab wears the plan's ring and a goal line,
 * and the list of chats puts what needs the developer first and finished work under Ready to finish.
 */
const workspace = (id: string, extra: Record<string, unknown> = {}) => ({
  id, branchName: id, description: `${id} workspace`, repos: [], assistants: [], workspacePath: `/tmp/${id}`, createdAt: '2026-09-24T00:00:00Z', ...extra,
});

test.use({
  workspacesData: [[
    workspace('alpha', { name: 'Faster search' }),
    workspace('beta', { name: 'Importer' }),
    workspace('gamma', { description: 'Release notes for 2.32\nWith the changelog' }),
    // Not open in the chat.
    workspace('delta', { name: 'Login bug', description: 'Sessions expire after a refresh' }),
  ], { option: true }],
  viewport: { width: 1440, height: 900 },
});

const CHAT_KEY = 'contextspace_floating_chat_state_v1';

const milestone = (id: string, title: string, state: string) => ({ id, title, state, verified: false, reopenCount: 0, dependsOn: [] });
const FACTS: Record<string, { milestones: ReturnType<typeof milestone>[]; current?: string }> = {
  alpha: { milestones: [milestone('m1', 'Measure the slow queries', 'done'), milestone('m2', 'Index the titles', 'in_progress')], current: 'm2' },
  beta: { milestones: [milestone('m1', 'Write the importer', 'in_progress'), milestone('m2', 'Map the fields', 'upcoming')], current: 'm1' },
  gamma: { milestones: [milestone('m1', 'Collect the changes', 'done'), milestone('m2', 'Write the notes', 'done')] },
};
const OBJECTIVES: Record<string, string> = { alpha: 'Make search answer in under 100 ms' };

function factsOf(workspaceId: string) {
  const { milestones, current } = FACTS[workspaceId] ?? { milestones: [] };
  const count = (state: string) => milestones.filter((entry) => entry.state === state).length;
  return {
    workspaceId, generatedAt: '2026-10-03T12:00:00.000Z', milestones, currentMilestoneId: current,
    counts: { total: milestones.length, done: count('done'), inProgress: count('in_progress'), reopened: count('reopened'), blocked: count('blocked'), upcoming: count('upcoming') },
    openQuestions: [], changes: { repos: [], files: 0, additions: 0, deletions: 0 },
    verification: { status: 'never', freshness: 'unknown' }, unavailable: [],
  };
}

const idOf = (url: string) => new URL(url).pathname.split('/')[3] ?? '';

async function mockChats(page: Page, { waiting = ['beta'], failing = [] as string[] } = {}) {
  const factsReads: string[] = [];
  await page.route('**/api/workspace/*/progress-facts', (route) => {
    const id = idOf(route.request().url());
    factsReads.push(id);
    if (failing.includes(id)) return route.fulfill({ status: 500, json: { error: 'The plan could not be read' } });
    return route.fulfill({ json: { facts: factsOf(id) } });
  });
  await page.route('**/api/workspace/*/work', (route) => route.fulfill({ json: {
    guidance: { version: 1, revision: 1, workType: 'feature', size: 'standard', documents: [],
      assignment: { stage: 'implement', objective: OBJECTIVES[idOf(route.request().url())] ?? '', expectedOutput: '', stopCondition: '' } },
    lifecycle: null, assignment: '', sharedDocuments: [],
  } }));
  await page.route('**/api/attention?*', (route) => {
    const wanted = new URL(route.request().url()).searchParams.get('workspaces')?.split(',') ?? [];
    return route.fulfill({ json: { requests: waiting.filter((id) => wanted.includes(id)).map((workspaceId) => ({
      workspaceId, id: `q-${workspaceId}`, timestamp: '2026-10-03T11:00:00.000Z', harness: 'claude', message: 'Which file format?',
    })) } });
  });
  return factsReads;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ chatKey }) => {
    try {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.setItem('contextspace_chat_layout_v1', JSON.stringify({ hidden: false, percent: 62 }));
      localStorage.setItem(chatKey, JSON.stringify({ openTabs: ['alpha', 'beta', 'gamma'], activeTab: 'alpha', modes: {} }));
      sessionStorage.setItem('seeded', '1');
    } catch { /* Storage can be unavailable. */ }
  }, { chatKey: CHAT_KEY });
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
const tab = (page: Page, name: string) => chatOf(page).getByRole('tab', { name: new RegExp(`^Show ${name} in the left pane`) });
const listOf = (page: Page) => page.getByRole('dialog');
const rowOf = (page: Page, branch: string) => listOf(page).locator(`li[data-branch="${branch}"]`);

async function openList(page: Page) {
  await chatOf(page).getByRole('button', { name: 'All chats', exact: true }).click();
  await expect(listOf(page)).toBeVisible();
}

test.describe('each tab says what its chat is working on', () => {
  test('wears the ring of its plan and a goal line, read from the assignment, the plan or the description', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'Faster search')).toContainText('Make search answer in under 100 ms');
    await expect(tab(page, 'Faster search')).toHaveAccessibleDescription('Make search answer in under 100 ms. In progress');
    // While the AI waits, the tab shows what it asked; the goal is still in the description.
    await expect(tab(page, 'Importer')).toContainText('Which file format?');
    await expect(tab(page, 'Importer')).toHaveAccessibleDescription('Write the importer. Waiting for you: Which file format?');
    // Only the first line of a description, so a tab stays one short line.
    await expect(tab(page, 'gamma')).toContainText('Release notes for 2.32');
    await expect(tab(page, 'gamma')).not.toContainText('changelog');
    await expect(tab(page, 'gamma')).toHaveAccessibleDescription('Release notes for 2.32. All done');
    // One arc per milestone, the same ring as the strip's.
    await expect(tab(page, 'Faster search').locator('[data-slot="context-ring"] g[data-kind]')).toHaveCount(2);
    // The names screen readers and the existing tests rely on are unchanged.
    await expect(tab(page, 'Faster search')).toHaveAttribute('title', 'Faster search (alpha)');
  });

  test('a chat whose progress cannot be read still says what it is for, and guesses no state', async ({ page }) => {
    await mockChats(page, { waiting: [], failing: ['beta'] });
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'Faster search')).toHaveAccessibleDescription('Make search answer in under 100 ms. In progress');
    await expect(tab(page, 'Importer')).toContainText('beta workspace');
    await expect(tab(page, 'Importer')).toHaveAccessibleDescription('beta workspace');
    await openList(page);
    await expect(rowOf(page, 'beta')).toContainText('beta workspace');
    await expect(rowOf(page, 'beta').locator('.state-chip')).toHaveCount(0);
    await expect(rowOf(page, 'alpha').locator('.state-chip')).toHaveText('In progress');
  });

  test('reads the open chats only while the chat is on screen', async ({ page }) => {
    const reads = await mockChats(page);
    await page.goto('/#/guide');
    await expect(page.locator('aside.context-sidebar')).toBeVisible();
    await page.waitForTimeout(1200);
    expect(reads).toEqual([]);
    await page.goto('/#/workspaces/alpha/chat');
    await expect.poll(() => [...new Set(reads)].sort()).toEqual(['alpha', 'beta', 'gamma']);
  });
});

test.describe('a chat with no goal anywhere', () => {
  test.use({ workspacesData: [[workspace('alpha', { name: 'Faster search' }), workspace('zeta', { description: '' })], { option: true }] });

  test('says its state on the tab instead, so every tab has the same two lines', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ openTabs: ['alpha', 'zeta'], activeTab: 'alpha', modes: {} })), CHAT_KEY);
    await mockChats(page, { waiting: [] });
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'zeta')).toContainText('No plan yet');
    await expect(tab(page, 'zeta')).toHaveAccessibleDescription('No plan yet');
    const heights = await chatOf(page).getByRole('tab').evaluateAll((tabs) => tabs.map((element) => Math.round(element.getBoundingClientRect().height)));
    expect(new Set(heights).size).toBe(1);
  });
});

test.describe('the sidebar', () => {
  test('says what each open chat is working on and which needs you, and leaves the other workspaces as they were', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    const sidebar = page.locator('aside.context-sidebar');
    const importer = sidebar.getByRole('link', { name: /^Importer/ });
    await expect(importer).toContainText('Waiting for you');
    // What it asked, rather than the goal, while it waits.
    await expect(importer).toContainText('Which file format?');
    await expect(sidebar.getByRole('link', { name: /^Faster search/ })).toContainText('Make search answer in under 100 ms');
    await expect(sidebar.getByRole('link', { name: /^Faster search/ })).not.toContainText('In progress');
    const login = sidebar.getByRole('link', { name: /^Login bug/ });
    await expect(login).toContainText('delta');
    await expect(login).toContainText('0 repos');
    // It shows what the chat last read, and keeps showing it on a page without the chat.
    await page.goto('/#/guide');
    await expect(importer).toContainText('Which file format?');
  });
});

test.describe('the list of chats', () => {
  test('puts what needs you first and finished work under Ready to finish', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'gamma')).toHaveAccessibleDescription(/All done$/);
    await openList(page);
    const open = listOf(page).getByRole('list', { name: 'Open chats' });
    await expect(open.locator('li')).toHaveCount(2);
    await expect(open.locator('li').nth(0)).toHaveAttribute('data-branch', 'beta');
    await expect(open.locator('li').nth(0).locator('.state-chip')).toHaveText('Waiting for you');
    await expect(open.locator('li').nth(1)).toHaveAttribute('data-branch', 'alpha');
    await expect(open.locator('li').nth(1).getByRole('button', { name: /^Faster search/ })).toHaveAttribute('aria-current', 'true');
    const finished = listOf(page).getByRole('list', { name: 'Ready to finish' });
    await expect(finished.locator('li')).toHaveCount(1);
    await expect(finished.locator('li')).toContainText('Release notes for 2.32');
    // The tabs keep the order they were opened in.
    await expect(chatOf(page).getByRole('tab')).toHaveText([/Faster search/, /Importer/, /gamma/]);
  });

  test('choosing a chat shows it, keeps the part you are reading and closes the list', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/plan');
    await openList(page);
    await rowOf(page, 'beta').getByRole('button', { name: /^Importer/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/plan$/);
    await expect(listOf(page)).toBeHidden();
    await expect(tab(page, 'Importer')).toHaveAttribute('aria-selected', 'true');
  });

  test('Review and finish opens the changes of that workspace', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'gamma')).toHaveAccessibleDescription(/All done$/);
    await openList(page);
    await rowOf(page, 'gamma').getByRole('button', { name: 'Review and finish gamma' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/gamma\/changes$/);
    await expect(listOf(page)).toBeHidden();
  });

  test('closing a chat in the background closes its tab, keeps the list open and moves the keyboard to the next row', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await expect(tab(page, 'Importer')).toHaveAccessibleDescription(/Waiting for you: Which file format\?$/);
    await openList(page);
    await rowOf(page, 'beta').getByRole('button', { name: 'Close the chat of Importer' }).click();
    await expect(tab(page, 'Importer')).toHaveCount(0);
    await expect(rowOf(page, 'beta')).toHaveCount(0);
    await expect(rowOf(page, 'alpha').getByRole('button', { name: /^Faster search/ })).toBeFocused();
    await expect(page).toHaveURL(/#\/workspaces\/alpha\/chat$/);
  });

  test('closing the chat on screen brings the next one to the front and closes the list', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await openList(page);
    await rowOf(page, 'alpha').getByRole('button', { name: 'Close the chat of Faster search' }).click();
    await expect(listOf(page)).toBeHidden();
    await expect(page).toHaveURL(/#\/workspaces\/beta\/chat$/);
    await expect(tab(page, 'Importer')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Faster search')).toHaveCount(0);
  });

  test('closing the last chat closes the list and leaves the chat picker', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, JSON.stringify({ openTabs: ['gamma'], activeTab: 'gamma', modes: {} })), CHAT_KEY);
    await mockChats(page);
    await page.goto('/#/workspaces/gamma/chat');
    await openList(page);
    await rowOf(page, 'gamma').getByRole('button', { name: 'Close the chat of gamma' }).click();
    await expect(listOf(page)).toBeHidden();
    await expect(chatOf(page).getByRole('tab')).toHaveCount(0);
    await expect(chatOf(page).getByRole('button', { name: 'All chats', exact: true })).toHaveCount(0);
    await expect(chatOf(page).getByRole('searchbox', { name: 'Search workspaces for CLI chat' })).toBeVisible();
  });

  test('closes with Escape and gives focus back to its button', async ({ page }) => {
    await mockChats(page);
    await page.goto('/#/workspaces/alpha/chat');
    await openList(page);
    await page.keyboard.press('Escape');
    await expect(listOf(page)).toBeHidden();
    await expect(chatOf(page).getByRole('button', { name: 'All chats', exact: true })).toBeFocused();
  });
});
