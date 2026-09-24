import { test, expect } from './fixtures';

const alpha = { id: 'alpha', branchName: 'alpha', description: 'Alpha workspace', repos: [], assistants: [], workspacePath: '/tmp/alpha', createdAt: '2026-09-24T00:00:00Z' };
const beta = { id: 'beta', branchName: 'beta', description: 'Beta workspace', repos: [], assistants: [], workspacePath: '/tmp/beta', createdAt: '2026-09-24T00:00:00Z' };

test.use({ workspacesData: [[alpha, beta], { option: true }], viewport: { width: 1365, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.route('**/api/terminals/bootstrap', route => route.fulfill({ json: { token: 'test-token', expiresAt: Date.now() + 300_000 } }));
  await page.route('**/api/terminals/*/status', route => route.fulfill({ json: { available: true, sessions: [], targets: [] } }));
  await page.route('**/api/workspace/*/sessions', route => route.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/workspace/*/plan', route => route.fulfill({ json: { content: '# Plan' } }));
});

test('workspace actions open the selected CLI chat without starting a session', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ modes: { alpha: 'chat' } }));
  });
  const launches: string[] = [];
  page.on('request', request => {
    if (/\/api\/terminals\/[^/]+\/create$/.test(request.url())) launches.push(request.url());
  });

  await page.goto('/#/overview');
  await page.locator('section[aria-labelledby="workspaces-heading"]')
    .getByRole('button', { name: 'Open CLI chat for alpha' }).click();

  const chat = page.getByRole('region', { name: 'Workspace Chat' });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole('tab', { name: 'Show alpha in the left pane' })).toHaveAttribute('aria-selected', 'true');
  await expect(chat.getByRole('button', { name: 'CLI', exact: true })).toHaveAttribute('aria-pressed', 'true');

  await chat.getByRole('button', { name: 'Close floating chat' }).click();

  await page.getByRole('button', { name: 'Open CLI chat for beta' }).first().click();
  await expect(chat.getByRole('tab', { name: 'Show beta in the left pane' })).toHaveAttribute('aria-selected', 'true');
  await expect(chat.getByRole('button', { name: 'CLI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(launches).toEqual([]);
});

test('creation from chat returns to the new workspace in CLI mode', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('contextspace_floating_chat_state_v1', JSON.stringify({ modes: { beta: 'chat' } }));
  });
  await page.route('**/api/workspace/create-stream/create-beta', route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: `event: progress\ndata: ${JSON.stringify({ status: 'completed', steps: [], workspacePath: beta.workspacePath, feature: beta })}\n\n`,
  }));

  await page.goto('/#/overview');
  await page.getByRole('button', { name: 'Open Floating Workspace Chat' }).click();
  const picker = page.getByRole('region', { name: 'Workspace Chat' });
  await expect(picker.getByRole('heading', { name: 'Choose a workspace for CLI chat' })).toBeVisible();
  await picker.getByRole('button', { name: 'Create workspace for CLI chat' }).click();
  await expect(page).toHaveURL(/#\/new\?from=chat$/);

  await page.goto('/#/new?from=chat&job=create-beta');
  await expect(page).toHaveURL(/#\/workspaces\/beta$/);
  const chat = page.getByRole('region', { name: 'Workspace Chat' });
  await expect(chat).toBeVisible();
  await expect(chat.getByRole('tab', { name: 'Show beta in the left pane' })).toHaveAttribute('aria-selected', 'true');
  await expect(chat.getByRole('button', { name: 'CLI', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(chat.getByRole('button', { name: 'Start session' })).toBeDisabled();
});
