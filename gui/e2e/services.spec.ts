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
    const req = page.waitForRequest((r) => r.url().includes('/orchestrators/start') && r.method() === 'POST');
    await page.route('**/api/workspace/*/orchestrators/start', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByText('docker-compose', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start docker-compose' }).click();
    // Read the payload from the request itself: the route handler may not have
    // run yet when waitForRequest resolves.
    expect((await req).postDataJSON()?.id).toBe('docker-compose:docker-compose.yml');
  });

  test('displays error banner with Retry button when services query fails, and recovers on retry', async ({ page }) => {
    let shouldFail = true;
    await page.route('**/api/workspace/*/services', async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Database service discovery failed' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ services: [webService], orchestrationTools: [], runningState: [], runningOrchestrators: [] }),
        });
      }
    });

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByText('Failed to load services: Database service discovery failed')).toBeVisible();
    const retryBtn = page.getByRole('button', { name: 'Retry' });
    await expect(retryBtn).toBeVisible();

    shouldFail = false;
    await retryBtn.click();
    await expect(page.getByRole('button', { name: 'Start web' })).toBeVisible();
    await expect(page.getByText('Failed to load services')).toBeHidden();
  });

  test('displays action error banner when a service action fails and dismisses it', async ({ page }) => {
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ services: [webService], orchestrationTools: [], runningState: [], runningOrchestrators: [] }),
      }),
    );

    await page.route('**/api/workspace/*/services/web/start', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Port 5173 is already allocated' }),
      });
    });

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByRole('button', { name: 'Start web' })).toBeVisible();
    await page.getByRole('button', { name: 'Start web' }).click();

    await expect(page.getByText('Action failed: Port 5173 is already allocated')).toBeVisible();
    const dismissBtn = page.getByRole('button', { name: 'Dismiss' });
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();
    await expect(page.getByText('Action failed:')).toBeHidden();
  });

  test('with nothing declared, Start All is off and the next step is a reviewed Procfile.dev', async ({ page }) => {
    let scans = 0;
    const suggestion = { file: 'C:\\mock-dev\\api\\Procfile.dev', content: 'web: npm run dev\n' };
    await page.route('**/api/workspace/*/services', async (route) => {
      scans++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ services: [{ ...webService, declared: false }], orchestrationTools: [], runningState: [], runningOrchestrators: [], failures: [], suggestions: [suggestion] }),
      });
    });

    await page.goto('/#/workspaces/demo/services');
    const declare = page.getByRole('region', { name: 'No declared services' });
    await expect(declare).toContainText('1 service was guessed from project files');
    await expect(declare.locator('pre')).toHaveText('web: npm run dev');
    await expect(declare.getByRole('button', { name: `Copy suggested ${suggestion.file}` })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start declared services' })).toBeDisabled();
    await expect(page.getByText('Guessed from package.json')).toBeVisible();
    // A guessed service can still be started on its own.
    await expect(page.getByRole('button', { name: 'Start web' })).toBeEnabled();
    const before = scans;
    await declare.getByRole('button', { name: 'Rescan' }).click();
    await expect.poll(() => scans).toBeGreaterThan(before);
  });

  test('declared services start together and each keeps its own failure reason', async ({ page }) => {
    const web = { name: 'api/web', command: '/bin/sh', args: ['-c', 'PORT=5173 npm run dev'], cwd: 'C:\\mock-dev\\api', port: 5173, source: 'procfile', declared: true, declaredIn: { file: 'Procfile.dev', line: 1 }, display: 'PORT=5173 npm run dev' };
    const worker = { ...web, name: 'api/worker', args: ['-c', 'honcho start'], port: undefined, declaredIn: { file: 'Procfile.dev', line: 2 }, display: 'honcho start' };
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [web, worker],
          orchestrationTools: [],
          runningState: [],
          runningOrchestrators: [],
          failures: [{ name: 'api/worker', reason: '"honcho" was not found on PATH. Install it, or change the command in Procfile.dev line 2.', at: 'x' }],
          suggestions: [],
        }),
      }),
    );
    const bulk = page.waitForRequest((r) => r.url().endsWith('/services/start') && r.method() === 'POST');
    await page.route('**/api/workspace/*/services/start', async (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, results: [] }) }),
    );

    await page.goto('/#/workspaces/demo/services');
    await expect(page.getByRole('region', { name: 'No declared services' })).toHaveCount(0);
    await expect(page.getByText('Procfile.dev:2')).toBeVisible();
    await expect(page.getByText('PORT=5173 npm run dev')).toBeVisible();
    const failures = page.getByTestId('service-failure');
    await expect(failures).toHaveCount(1);
    await expect(failures).toHaveText(/"honcho" was not found on PATH.*Procfile\.dev line 2/);
    await page.getByRole('button', { name: 'Start declared services' }).click();
    await bulk;
  });

  test('a repository that declares nothing still gets its own suggestion beside declared ones', async ({ page }) => {
    const web = { name: 'api/web', command: '/bin/sh', args: ['-c', 'npm run dev'], cwd: 'C:\\mock-dev\\api', source: 'procfile', declared: true, declaredIn: { file: 'Procfile.dev', line: 1 }, display: 'npm run dev' };
    const tools = { name: 'tools', command: 'npm', args: ['run', 'dev'], cwd: 'C:\\mock-dev\\tools', source: 'package.json', declared: false };
    await page.route('**/api/workspace/*/services', async (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ services: [web, tools], orchestrationTools: [], runningState: [], runningOrchestrators: [], failures: [], suggestions: [{ file: 'C:\\mock-dev\\tools\\Procfile.dev', content: 'web: npm run dev\n' }] }),
      }),
    );
    await page.goto('/#/workspaces/demo/services');
    const panel = page.getByRole('region', { name: 'Some services are not declared' });
    await expect(panel).toContainText('will not start with the declared ones');
    await expect(panel.getByText('C:\\mock-dev\\tools\\Procfile.dev')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start declared services' })).toBeEnabled();
  });
});
