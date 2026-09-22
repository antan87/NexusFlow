import { test, expect } from './fixtures';

const feature = { id: 'feature-x', branchName: 'feature-x', description: 'Harness resume', repos: [], assistants: ['antigravity', 'codex'], workspacePath: 'C:/ws/feature-x', createdAt: '2026-09-20T00:00:00Z' };
const harnesses = ['codex', 'claude', 'antigravity', 'copilot'];
const sessions = harnesses.map((assistant, i) => ({
  id: `0199a213-81c0-7800-8aa1-bbab2a035a5${i}`, assistant, title: `${assistant} saved conversation`,
  threadKind: i < 2 ? 'main' : 'unknown', workspacePath: feature.workspacePath,
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z', messageCount: 5,
}));
const child = { ...sessions[0], id: '0199a213-81c0-7800-8aa1-bbab2a035a59', title: 'Delegated code review', threadKind: 'subagent', parentSessionId: sessions[0].id };

test.use({ workspacesData: [feature], viewport: { width: 1365, height: 960 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/ai-detect', route => route.fulfill({ json: [
    { name: 'codex', displayName: 'Codex', detected: true }, { name: 'antigravity', displayName: 'Antigravity', detected: true },
  ] }));
  await page.route('**/api/adapters/status', route => route.fulfill({ json: [] }));
  await page.route('**/api/workspace/feature-x/sessions*', route => route.fulfill({ json: { sessions: [...sessions, child] } }));
  await page.route('**/api/terminals/bootstrap', route => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/feature-x/status', route => route.fulfill({ json: {
    available: true, sessions: [], targets: [...harnesses, 'shell'].map(id => ({ id, name: id, available: true, reason: null })),
  } }));
  // Verify dispatch without launching an AI process or altering a saved conversation.
  await page.route('**/api/terminals/feature-x/create', route => route.fulfill({ status: 400, json: { error: 'Test launch intercepted' } }));
});

test('resumes every indexed harness in the chat window using its recorded identity', async ({ page }) => {
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: 'Open Floating Chat', exact: true }).click();
  const chat = page.getByRole('region', { name: 'Workspace Chat', exact: true });
  await expect(chat.getByRole('combobox', { name: 'CLI harness' })).toHaveText('Choose a harness');
  await expect(chat.getByRole('button', { name: 'Start session', exact: true })).toBeDisabled();
  const history = chat.getByRole('region', { name: 'Resume a conversation' });
  await expect(history.getByTestId('resume-session-row')).toHaveCount(4);
  await expect(history.getByText(child.title)).toHaveCount(0);
  await expect(history.getByText('Main thread', { exact: true })).toHaveCount(2);
  await expect(history.getByText('Conversation', { exact: true })).toHaveCount(2);
  const firstRow = history.getByTestId('resume-session-row').first();
  await expect(firstRow.getByText(/^Last activity/).locator('time')).toHaveAttribute('datetime', '2026-09-21T00:00:00.000Z');
  await expect(firstRow.getByText(/^Started/).locator('time')).toHaveAttribute('datetime', '2026-09-20T00:00:00.000Z');
  await page.screenshot({ path: '../scratch/harness-ux/03-chat-after.png' });
  for (const session of sessions) {
    const request = page.waitForRequest('**/api/terminals/feature-x/create');
    await history.getByTestId('resume-session-row').filter({ hasText: session.title }).getByRole('button', { name: 'Resume', exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({ target: session.assistant, sessionId: session.id });
    await expect(chat.getByRole('alert')).toContainText('Test launch intercepted');
  }
  await history.getByRole('checkbox', { name: /Include subagent/ }).check();
  const childRow = history.getByTestId('resume-session-row').filter({ hasText: child.title });
  await expect(childRow.getByText('Subagent', { exact: true })).toBeVisible();
  const parentRequest = page.waitForRequest('**/api/terminals/feature-x/create');
  await childRow.getByRole('button', { name: 'Main thread', exact: true }).click();
  expect((await parentRequest).postDataJSON()).toMatchObject({ target: 'codex', sessionId: sessions[0].id });
});

test('Sessions tab defaults to conversations and can reveal delegated tasks', async ({ page }) => {
  await page.goto('/#/workspaces/feature-x/sessions');
  await page.getByRole('button', { name: /Timeline/i }).click();
  await expect(page.getByText(sessions[0].title)).toBeVisible();
  await expect(page.getByText(/^Last activity/).first().locator('time')).toHaveAttribute('datetime', '2026-09-21T00:00:00.000Z');
  await expect(page.getByText(child.title)).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Include subagent/ }).check();
  await expect(page.getByText(child.title)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Main thread', exact: true })).toBeVisible();
});

test('workspace creation shows harness choices without preselecting a provider', async ({ page }) => {
  await page.goto('/#/new');
  const choices = page.getByRole('region', { name: 'AI harnesses' });
  await expect(choices).toBeVisible();
  const checkboxes = choices.getByRole('checkbox');
  await expect(checkboxes).toHaveCount(2);
  for (const checkbox of await checkboxes.all()) await expect(checkbox).not.toBeChecked();
  await expect(choices.getByText('Codex', { exact: true })).toBeVisible();
  await expect(choices.getByText('Antigravity', { exact: true })).toBeVisible();
  await choices.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '../scratch/harness-ux/04-create-after.png' });
});
