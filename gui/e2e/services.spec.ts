import { test, expect } from './fixtures';

const workspace = {
  id: 'demo',
  mode: 'in-place',
  branchName: 'demo',
  description: 'Demo workspace',
  repos: ['C:\\mock-dev\\api'],
  assistants: [],
  workspacePath: 'C:\\mock-dev\\api',
  createdAt: '2026-07-17T00:00:00.000Z',
};

const webService = { name: 'web', command: 'npm', args: ['run', 'dev'], cwd: 'C:\\mock-dev\\api', port: 5173, source: 'package.json' };

test.describe('Service console', () => {
  test.use({ workspacesData: [workspace] });

  test('shows a Start control for a stopped service and posts to its start route', async ({ page }) => {
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ services: [webService], orchestrationTools: [], runningState: [], runningOrchestrators: [] }),
      }),
    );

    const startReq = page.waitForRequest((r) => r.url().includes('/services/web/start') && r.method() === 'POST');
    let startBody: string | null = null;
    await page.route('**/api/workspace/*/services/web/start', async (route, request) => {
      startBody = request.postData();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByRole('button', { name: 'Start web' })).toBeVisible();
    await page.getByRole('button', { name: 'Start web' }).click();
    await startReq;
    // No command is ever sent from the client.
    expect(startBody).toBeFalsy();
  });

  test('shows Stop and Restart for a running service', async ({ page }) => {
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [webService],
          orchestrationTools: [],
          runningState: [{ name: 'web', pid: 4321, config: webService, startedAt: 'x' }],
          runningOrchestrators: [],
        }),
      }),
    );
    const stopReq = page.waitForRequest((r) => r.url().includes('/services/web/stop') && r.method() === 'POST');
    await page.route('**/api/workspace/*/services/web/stop', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, stopped: true }) }),
    );

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByRole('button', { name: 'Restart web' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop web' }).click();
    await stopReq;
  });

  test('backfills then live-streams logs, and clear empties the console', async ({ page }) => {
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ services: [webService], orchestrationTools: [], runningState: [], runningOrchestrators: [] }),
      }),
    );

    // Assert the stream is opened from the backfill offset.
    const streamReq = page.waitForRequest((r) => r.url().includes('/services/logs/web/stream') && r.url().includes('offset=14'));

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByText('backfill line')).toBeVisible();
    await expect(page.getByText('hello from sse')).toBeVisible();
    await streamReq;

    await page.getByTitle('Clear Console').click();
    await expect(page.getByText('backfill line')).toBeHidden();
  });

  test('starts a detected orchestration tool by its id', async ({ page }) => {
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [],
          orchestrationTools: [
            { id: 'docker-compose:docker-compose.yml', tool: 'docker-compose', configPath: 'C:\\mock-dev\\api\\docker-compose.yml', startCommand: 'x', stopCommand: 'y', mode: 'oneshot' },
          ],
          runningState: [],
          runningOrchestrators: [],
        }),
      }),
    );
    let body: any = null;
    const req = page.waitForRequest((r) => r.url().includes('/orchestrators/start') && r.method() === 'POST');
    await page.route('**/api/workspace/*/orchestrators/start', async (route, request) => {
      body = request.postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByText('docker-compose', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start docker-compose' }).click();
    await req;
    expect(body?.id).toBe('docker-compose:docker-compose.yml');
  });
});
