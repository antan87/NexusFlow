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
    const chatFrames: Array<Record<string, unknown>> = [];
    const legacyRequests: string[] = [];
    let launchBody: Record<string, unknown> | null = null;
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
    await expect(page.getByRole('button', { name: 'Start editing with Claude' })).toBeVisible();
    await expect(page.getByText(/Embedded start allows edits inside this workspace/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Open with…' }).click();
    await expect(page.getByRole('heading', { name: 'Open workspace with…' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open workspace in Codex Desktop' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Claude Desktop unavailable' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Open workspace in VS Code' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'VS Code Insiders unavailable' })).toBeDisabled();
    await page.getByRole('button', { name: 'Open workspace in Codex Desktop' }).click();
    await expect.poll(() => launchBody).toEqual({ targetId: 'codex-desktop' });

    await page.getByRole('button', { name: 'Start editing with Claude' }).click();
    await expect.poll(() => chatFrames.length).toBeGreaterThanOrEqual(2);
    expect(chatFrames[0]).toMatchObject({
      type: 'start',
      command: 'claude-cli',
      cwd: 'C:\\mock-dev\\workspaces\\demo-worktree',
      resume: false,
    });
    expect(chatFrames[0].sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(chatFrames.filter((frame) => frame.type === 'start')).toHaveLength(1);
    expect(chatFrames.filter((frame) => frame.type === 'input')).toMatchObject([
      {
        type: 'input',
        input: 'Read the workspace instructions and implementation plan, inspect the repository state, then begin the task described for this workspace. Ask before making a decision that materially changes scope.',
        executionProfile: 'workspace-write',
      },
    ]);
    expect(legacyRequests).toEqual([]);
  });

  test('refreshes CLI availability and preserves prior chat across explicit kickoff retries', async ({ page }) => {
    await mockCompletedCreationStream(page);
    let providerConfigured = false;
    let supportsWorkspaceWrite = true;
    let providerIssue: 'signed-out' | 'probe-failed' = 'signed-out';
    let refreshChecks = 0;
    await page.addInitScript(() => {
      localStorage.setItem('nexusflow_chat_demo-worktree', JSON.stringify({
        v: 3,
        sessions: { 'claude-cli': { id: '123e4567-e89b-42d3-a456-426614174000', started: true } },
        providerId: 'claude-cli',
        messages: [{ role: 'assistant', content: 'Preserve this previous chat' }],
      }));

      const frames: Array<Record<string, unknown>> = [];
      let instances = 0;
      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 3;
        readyState = MockWebSocket.CONNECTING;
        onopen: (() => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;

        constructor(url: string) {
          if (new URL(url, window.location.href).pathname !== '/ws') {
            setTimeout(() => {
              this.readyState = MockWebSocket.OPEN;
              this.onopen?.();
            }, 0);
            return;
          }
          const attempt = ++instances;
          (window as any).__handoffInstances = instances;
          setTimeout(() => {
            if (attempt === 1) {
              this.readyState = MockWebSocket.CLOSED;
              this.onerror?.(new Event('error'));
              this.onclose?.(new CloseEvent('close'));
            } else {
              this.readyState = MockWebSocket.OPEN;
              this.onopen?.();
            }
          }, 0);
        }

        send(payload: string) {
          if (this.readyState !== MockWebSocket.OPEN) throw new Error('socket is not open');
          frames.push(JSON.parse(payload));
        }

        close() {
          this.readyState = MockWebSocket.CLOSED;
        }
      }

      (window as any).__handoffFrames = frames;
      (window as any).WebSocket = MockWebSocket;
      (window as any).__copiedRecovery = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as any).__copiedRecovery = text;
          },
        },
      });
    });
    const fulfillProviderStatus = async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'claude-cli',
          name: 'Claude Code (Local CLI)',
          isConfigured: providerConfigured,
          message: providerConfigured
            ? undefined
            : providerIssue === 'signed-out'
              ? 'Claude Code is installed but not signed in. No API key is required.'
              : 'NexusFlow could not verify Claude Code login.',
          setupIssue: providerConfigured ? undefined : providerIssue,
          recoveryCommand: providerConfigured
            ? undefined
            : providerIssue === 'signed-out' ? 'claude auth login' : 'claude auth status --json',
          recoveryLabel: providerConfigured
            ? undefined
            : providerIssue === 'signed-out' ? 'Copy sign-in command' : 'Copy status command',
          executionProfiles: supportsWorkspaceWrite
            ? [
                { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
                { id: 'workspace-write', label: 'Edit workspace', description: 'Auto-accepts in-workspace file edits.' },
              ]
            : [{ id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' }],
          defaultExecutionProfile: 'review',
          capabilities: {
            transport: 'cli-print',
            sessionIdentity: 'client-assigned',
            workspaceAccess: 'harness-managed',
            sessionIdFormat: 'uuid',
          },
        }]),
      });
    };
    await page.route('**/api/adapters/status/refresh', async (route, request) => {
      refreshChecks += 1;
      expect(request.method()).toBe('POST');
      expect(request.postDataJSON()).toEqual({ providerId: 'claude-cli' });
      await fulfillProviderStatus(route);
    });
    await page.route('**/api/adapters/status', async (route) => {
      await fulfillProviderStatus(route);
    });
    await page.route('**/api/projects', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'demo',
          name: 'Demo',
          description: 'Demo project',
          repos: [{ path: 'C:\\mock-dev\\nexus-frontend', defaultBranch: 'main' }],
          createdAt: '2026-07-15T00:00:00.000Z',
          updatedAt: '2026-07-15T00:00:00.000Z',
        }]),
      });
    });
    await page.route('**/api/workspace', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, jobId: 'demo-worktree' }),
      });
    });

    await page.goto('/#/new?project=demo');
    await page.getByRole('radio', { name: /Isolated worktrees/ }).click();
    await page.getByLabel('Feature branch').fill('feature/demo-work');
    await page.getByLabel('What are you building?').fill('Implement the demo flow');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace ready' })).toBeVisible();

    await page.getByRole('button', { name: 'Start editing with Claude' }).click();
    await expect(page.getByText('Preserve this previous chat')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recheck & retry' })).toBeVisible();
    await page.getByRole('button', { name: 'Copy sign-in command' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__copiedRecovery)).toBe('claude auth login');
    expect(await page.evaluate(() => (window as any).__handoffFrames)).toEqual([]);

    providerIssue = 'probe-failed';
    await page.getByRole('button', { name: 'Recheck & retry' }).click();
    await expect.poll(() => refreshChecks).toBe(1);
    await expect(page.getByRole('button', { name: 'Try with existing CLI auth' })).toBeVisible();
    await expect(page.getByText('claude auth status --json')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__handoffFrames)).toEqual([]);

    await page.getByRole('button', { name: 'Try with existing CLI auth' }).click();
    await expect.poll(() => refreshChecks).toBe(2);
    await expect(page.getByText(/Could not open the local agent connection/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Recheck & retry' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__handoffFrames)).toEqual([]);

    providerConfigured = true;
    supportsWorkspaceWrite = false;
    await page.getByRole('button', { name: 'Recheck & retry' }).click();
    await expect.poll(() => refreshChecks).toBe(3);
    await expect(page.getByText(/Select a supported execution profile/i)).toBeVisible();
    await expect(page.getByText('Preserve this previous chat')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__handoffFrames)).toEqual([]);
    expect(await page.evaluate(() => (window as any).__handoffInstances)).toBe(1);

    supportsWorkspaceWrite = true;
    await page.getByRole('button', { name: 'Recheck & retry' }).click();
    await expect.poll(() => refreshChecks).toBe(4);
    await expect.poll(() => page.evaluate(() => (window as any).__handoffFrames.length)).toBe(2);
    const frames = await page.evaluate(() => (window as any).__handoffFrames);
    expect(frames[0]).toMatchObject({
      type: 'start',
      command: 'claude-cli',
      cwd: 'C:\\mock-dev\\workspaces\\demo-worktree',
      resume: false,
    });
    expect(frames[1]).toMatchObject({ type: 'input', executionProfile: 'workspace-write' });
    await expect(page.getByText('Preserve this previous chat')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__handoffInstances)).toBe(2);
    expect(refreshChecks).toBe(4);
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
