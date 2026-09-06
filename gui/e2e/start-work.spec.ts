import { test, expect, type Page } from './fixtures';
import type { Route } from '@playwright/test';

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

async function mockRunningCreationStream(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
      onerror: ((e: Event) => void) | null = null;
      closed = false;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          if (this.closed) return;
          const eventPayload = {
            status: 'running',
            progress: 17,
            steps: [
              { id: 'workspace', name: 'Register Workspace', status: 'running', message: 'Registering workspace...' },
              { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
              { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
            ],
          };
          const progressEvent = new MessageEvent('progress', { data: JSON.stringify(eventPayload) });
          this.listeners.progress?.forEach((cb) => cb(progressEvent));
        }, 500);
      }

      addEventListener(type: string, cb: (e: MessageEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(cb);
      }

      close() {
        this.closed = true;
      }
    }

    (window as any).EventSource = MockEventSource;
  });
}

async function mockFailedCreationReplay(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
      onerror: ((e: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => {
          const eventPayload = {
            status: 'failed',
            error: 'Workspace setup could not be resumed.',
            steps: [
              { id: 'workspace', name: 'Register Workspace', status: 'failed', message: 'Workspace setup could not be resumed.' },
            ],
          };
          const progressEvent = new MessageEvent('progress', { data: JSON.stringify(eventPayload) });
          this.listeners.progress?.forEach((cb) => cb(progressEvent));
        }, 0);
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

async function mockStaleCreationStream(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      url: string;
      listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
      onerror: ((e: Event) => void) | null = null;

      constructor(url: string) {
        this.url = url;
        const jobId = decodeURIComponent(url.split('/').pop() ?? 'unknown');
        const eventPayload = jobId === 'first-job'
          ? {
              status: 'completed',
              workspacePath: 'C:\\mock-dev\\workspaces\\first-job',
              feature: { id: 'first-job' },
              steps: [{ id: 'workspace', name: 'First job', status: 'completed', message: 'Done' }],
            }
          : {
              status: 'running',
              steps: [{ id: 'workspace', name: 'Second job', status: 'running', message: 'Still working' }],
            };
        setTimeout(() => {
          const progressEvent = new MessageEvent('progress', { data: JSON.stringify(eventPayload) });
          this.listeners.progress?.forEach((cb) => cb(progressEvent));
        }, jobId === 'first-job' ? 150 : 20);
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

async function mockFailedCreationStream(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      static CLOSED = 2;
      url: string;
      listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
      onerror: ((e: Event) => void) | null = null;
      readyState = MockEventSource.CLOSED;

      constructor(url: string) {
        this.url = url;
        setTimeout(() => this.onerror?.(new Event('error')), 0);
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
    configData: {
      exists: true,
      config: {
        version: '0.2.7',
        devDir: 'C:\\mock-dev',
        workspacesDir: 'C:\\mock-dev\\workspaces',
        defaultAssistant: 'ANTIGRAVITY',
        defaultEditor: 'code',
        scanDepth: 2,
      },
    },
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
    workspacesData: [
      {
        id: 'demo-worktree',
        branchName: 'demo-worktree',
        description: 'Implement the demo flow',
        repos: ['C:\\mock-dev\\nexus-frontend'],
        assistants: ['claude'],
        workspacePath: 'C:\\mock-dev\\workspaces\\demo-worktree',
        createdAt: '2026-08-10T00:00:00.000Z',
      },
    ],
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

    await expect(page.locator('h1')).toContainText('Welcome to ContextSpace');
    await expect(page.locator('h2')).toContainText('Initialize Config');

    await page.getByPlaceholder('e.g. C:\\Users\\username\\dev', { exact: true }).fill('C:\\mock-dev');
    await page
      .getByPlaceholder('e.g. C:\\Users\\username\\dev\\workspaces', { exact: true })
      .fill('C:\\mock-dev\\workspaces');

    await page.locator('button:has-text("Save & Get Started")').click();
  });

  test('should create a workspace in worktree mode from the new Start work flow', async ({ page }) => {
    await mockCompletedCreationStream(page);
    const chatFrames: Array<Record<string, unknown>> = [];
    const legacyRequests: string[] = [];
    let launchBody: Record<string, unknown> | null = null;
    let releaseLaunch!: () => void;
    const launchResponseGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    page.on('request', (request) => {
      if (/\/resume$|\/api\/open-editor$/.test(new URL(request.url()).pathname)) {
        legacyRequests.push(request.url());
      }
    });
    await page.route('**/api/adapters/status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'claude-cli',
            name: 'Claude Code (Local CLI)',
            isConfigured: true,
            executionProfiles: [
              { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
              { id: 'workspace-write', label: 'Edit workspace', description: 'Auto-accepts in-workspace file edits.' },
            ],
            defaultExecutionProfile: 'review',
            capabilities: {
              transport: 'cli-print',
              sessionIdentity: 'client-assigned',
              workspaceAccess: 'harness-managed',
              sessionIdFormat: 'uuid',
            },
          },
        ]),
      });
    });
    await page.routeWebSocket('**/ws', (socket) => {
      socket.onMessage((message) => {
        chatFrames.push(JSON.parse(String(message)));
      });
    });
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

    await page.route('**/api/workspace/demo-worktree/launch', async (route, request) => {
      launchBody = request.postDataJSON();
      await launchResponseGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, targetId: launchBody?.targetId }),
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
    await page.getByRole('button', { name: 'Open workspace' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/demo-worktree/);
  });

  test('keeps the setup screen visible after a creation-page reload', async ({ page }) => {
    await mockRunningCreationStream(page);
    await page.route('**/api/workspace', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'running-workspace' }),
      });
    });

    await page.goto('/#/new');
    await page.getByRole('checkbox', { name: 'nexus-frontend' }).click();
    await page.getByLabel('Workspace name').fill('Running workspace');
    await page.getByLabel('What are you building?').fill('Keep setup progress visible');
    await page.getByRole('button', { name: 'Start working' }).click();

    await expect(page).toHaveURL(/#\/new\?job=running-workspace/);
    await expect(page.getByRole('heading', { name: 'Setting up your workspace…' })).toBeVisible();
    await expect(page.getByText('Connecting to workspace setup…')).toBeVisible();
    await expect(page.getByText('Register Workspace')).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/#\/new\?job=running-workspace/);
    await expect(page.getByRole('heading', { name: 'Setting up your workspace…' })).toBeVisible();
    await expect(page.getByText('Connecting to workspace setup…')).toBeVisible();
    await expect(page.getByText('Register Workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Return to form' }).click();
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.getByRole('heading', { name: 'Start work' })).toBeVisible();
  });

  test('renders a replayed failed creation job with its server error', async ({ page }) => {
    await mockFailedCreationReplay(page);

    await page.goto('/#/new?job=failed-workspace');

    await expect(page.getByRole('heading', { name: 'Workspace creation failed' })).toBeVisible();
    await expect(page.getByText('Workspace setup could not be resumed.').last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back to form (edit & retry)' })).toBeVisible();

    await page.getByRole('button', { name: 'Start over (clear form)' }).click();
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.getByRole('heading', { name: 'Start work' })).toBeVisible();
  });

  test('renders a replayed completed creation job opened directly', async ({ page }) => {
    await mockCompletedCreationStream(page);

    await page.goto('/#/new?job=completed-workspace');

    await expect(page).toHaveURL(/#\/new\?job=completed-workspace/);
    await expect(page.getByRole('heading', { name: 'Workspace ready' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeVisible();
  });

  test('ignores a late event from a replaced creation stream', async ({ page }) => {
    await mockStaleCreationStream(page);

    await page.goto('/#/new?job=first-job');
    await page.evaluate(() => {
      window.location.hash = '#/new?job=second-job';
    });

    await expect(page).toHaveURL(/#\/new\?job=second-job/);
    await expect(page.getByText('Second job')).toBeVisible();
    await page.waitForTimeout(200);
    await expect(page.getByRole('heading', { name: 'Setting up your workspace…' })).toBeVisible();
    await expect(page.getByText('Second job')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workspace ready' })).toBeHidden();
  });

  test('shows an honest recovery state when the creation stream closes', async ({ page }) => {
    await mockFailedCreationStream(page);
    await page.route('**/api/workspace', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'missing-workspace' }),
      });
    });

    await page.goto('/#/new');
    await page.getByRole('checkbox', { name: 'nexus-frontend' }).click();
    await page.getByLabel('Workspace name').fill('Missing workspace');
    await page.getByLabel('What are you building?').fill('Show a recovery state');
    await page.getByRole('button', { name: 'Start working' }).click();

    await expect(page.getByRole('heading', { name: 'Unable to reconnect to workspace setup' })).toBeVisible();
    await expect(page.getByText('Unable to reconnect to the creation stream. The workspace may still have been created.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try reconnecting' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to form' }).click();
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.getByRole('heading', { name: 'Start work' })).toBeVisible();
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
