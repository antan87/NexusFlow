import { test, expect, type Page } from './fixtures';

async function mockCompletedCreationStream(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
      onerror: ((e: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          const jobId = decodeURIComponent(url.split('/').pop() ?? 'created-workspace');
          const eventPayload = {
            status: 'completed',
            progress: 100,
            workspacePath: `C:\\mock-dev\\workspaces\\${jobId}`,
            feature: { id: jobId },
            steps: [
              { id: 'workspace', name: 'Create workspace', status: 'completed', message: 'Done' },
              { id: 'analysis', name: 'Analyze repositories', status: 'completed', message: 'Done' },
              { id: 'context', name: 'Generate AI context', status: 'completed', message: 'Done' },
            ],
          };
          const progressEvent = new MessageEvent('progress', { data: JSON.stringify(eventPayload) });
          this.listeners.progress?.forEach((cb) => cb(progressEvent));
        }, 50);
      }

      addEventListener(type: string, cb: (e: MessageEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
      }

      close() {}
    }

    (window as any).EventSource = MockEventSource;
  });
}

test.describe('NexusFlow E2E GUI Tests', () => {
  test.use({
    reposData: [
      { name: 'nexus-frontend', path: 'C:\\mock-dev\\nexus-frontend', defaultBranch: 'main' },
    ],
    aiDetectData: [{ name: 'claude', displayName: 'Claude CLI', detected: true }],
    workflowsTemplatesData: {
      templates: [
        {
          id: 'plan-implement-review',
          name: 'Plan Implement Review',
          description: 'Plan, implement, and review.',
          content: '# Plan Implement Review\n\nInstructions...',
          custom: false,
        },
      ],
    },
  });

  test('should run the onboarding flow when config does not exist', async ({ page }) => {
    await page.route('**/api/config', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            exists: false,
            config: {
              version: '0.2.7',
              devDir: '',
              workspacesDir: '',
              defaultAssistant: null,
              scanDepth: 2,
            },
          }),
        });
      } else if (request.method() === 'POST') {
        const body = request.postDataJSON();
        expect(body.devDir).toBe('C:\\mock-dev');
        expect(body.workspacesDir).toBe('C:\\mock-dev\\workspaces');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, config: body }),
        });
      }
    });

    await page.route('**/api/repos', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/ai-detect', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.route('**/api/workflows/templates', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
    });

    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Welcome to NexusFlow');
    await expect(page.locator('h2')).toContainText('Initialize Config');

    await page.getByPlaceholder('e.g. C:\\Users\\username\\dev', { exact: true }).fill('C:\\mock-dev');
    await page
      .getByPlaceholder('e.g. C:\\Users\\username\\dev\\workspaces', { exact: true })
      .fill('C:\\mock-dev\\workspaces');

    await page.locator('button:has-text("Save & Get Started")').click();
  });

  test('should create a workspace in worktree mode from the new Start work flow', async ({ page }) => {
    await mockCompletedCreationStream(page);
    await page.route('**/api/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'demo',
            name: 'Demo',
            description: 'Demo project',
            repos: [{ path: 'C:\\mock-dev\\nexus-frontend', defaultBranch: 'main' }],
            createdAt: '2026-07-15T00:00:00.000Z',
            updatedAt: '2026-07-15T00:00:00.000Z',
          },
        ]),
      });
    });

    let workspaceBody: any = null;
    await page.route('**/api/workspace', async (route, request) => {
      workspaceBody = request.postDataJSON();
      expect(workspaceBody.mode).toBe('worktree');
      expect(workspaceBody.branchName).toBe('feature/demo-work');
      expect(workspaceBody.projectId).toBe('demo');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'demo-worktree' }),
      });
    });

    await page.goto('/#/new?project=demo');
    await expect(page.getByRole('heading', { name: 'Start work' })).toBeVisible();

    await page.getByRole('radio', { name: /Isolated worktrees/ }).click();
    await page.getByLabel('Feature branch').fill('feature/demo-work');
    await page.getByLabel('What are you building?').fill('Implement the demo flow');
    await page.getByRole('button', { name: 'Create workspace' }).click();

    await expect.poll(() => workspaceBody?.mode).toBe('worktree');
    await expect(page.getByRole('heading', { name: 'Workspace ready' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeVisible();
  });

  test('should create an in-place workspace without showing branch fields', async ({ page }) => {
    await mockCompletedCreationStream(page);

    let workspaceBody: any = null;
    await page.route('**/api/workspace', async (route, request) => {
      workspaceBody = request.postDataJSON();
      expect(workspaceBody.mode).toBe('in-place');
      expect(workspaceBody.name).toBe('Fix invoices');
      expect(workspaceBody.branchName).toBeUndefined();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'fix-invoices' }),
      });
    });

    await page.goto('/#/new');
    await expect(page.getByRole('heading', { name: 'Start work' })).toBeVisible();

    await page.getByRole('radio', { name: /In-place/ }).click();
    await expect(page.getByLabel('Feature branch')).toBeHidden();
    await page.getByRole('checkbox', { name: 'nexus-frontend' }).click();
    await page.getByLabel('Workspace name').fill('Fix invoices');
    await page.getByLabel('What are you building?').fill('Fix invoice rounding issues');
    await page.getByRole('button', { name: 'Start working' }).click();

    await expect.poll(() => workspaceBody?.mode).toBe('in-place');
  });

  test('should save settings changes', async ({ page }) => {
    let savedConfig: any = null;

    await page.route('**/api/config', async (route, request) => {
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            exists: true,
            config: {
              version: '0.2.7',
              devDir: 'C:\\mock-dev',
              workspacesDir: 'C:\\mock-dev\\workspaces',
              defaultAssistant: 'ANTIGRAVITY',
              scanDepth: 2,
            },
          }),
        });
      } else if (request.method() === 'POST') {
        savedConfig = request.postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, config: savedConfig }),
        });
      }
    });

    await page.route('**/api/updates/tools', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });

    await page.goto('/');
    await page.locator('aside a:has-text("Settings")').click();

    await expect(page.locator('h1')).toContainText('Global Settings');

    const devDirInput = page.locator('label:has-text("Development Directory") + input, input[value="C:\\\\mock-dev"]').first();
    await devDirInput.fill('C:\\mock-code');

    const saveButton = page.locator('button:has-text("Save Configuration")');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect.poll(() => savedConfig?.devDir).toBe('C:\\mock-code');
  });
});
