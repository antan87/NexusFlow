import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

const feature = {
  id: 'feature-x',
  branchName: 'feature-x',
  description: 'Improve the local harness handoff',
  repos: ['C:/dev/nexusflow'],
  assistants: ['antigravity', 'claude', 'codex', 'copilot'],
  workspacePath: 'C:/ws/feature-x',
  createdAt: '2026-08-10T00:00:00.000Z',
};

const provider = (assistant: 'claude' | 'codex' | 'antigravity' | 'copilot', isConfigured = true) => {
  const recoveryCommand = {
    claude: 'claude auth login',
    codex: 'codex login',
    antigravity: 'agy',
    copilot: 'copilot',
  }[assistant];
  const supportsExecutionProfiles = assistant !== 'copilot';
  const displayName = {
    claude: 'Claude Code',
    codex: 'Codex',
    antigravity: 'Antigravity',
    copilot: 'GitHub Copilot',
  }[assistant];
  return {
    id: `${assistant}-cli`,
    name: `${displayName} (Local CLI)`,
    isConfigured,
    message: isConfigured ? undefined : `${displayName} is not signed in. No API key is required.`,
    setupIssue: isConfigured ? undefined : 'signed-out',
    recoveryCommand: isConfigured ? undefined : recoveryCommand,
    recoveryLabel: isConfigured ? undefined : 'Copy sign-in command',
    executionProfiles: supportsExecutionProfiles ? [
      { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
      {
        id: 'workspace-write',
        label: 'Edit workspace',
        description: assistant === 'claude'
          ? 'Auto-accepts in-workspace file edits and common filesystem actions; other approval-requiring commands are unavailable in embedded chat.'
          : 'Workspace-write sandbox; command network and escalation outside the sandbox are denied.',
      },
    ] : undefined,
    defaultExecutionProfile: supportsExecutionProfiles ? 'review' : undefined,
    capabilities: {
      transport: assistant === 'copilot' ? 'acp' : 'cli-print',
      sessionIdentity: assistant === 'claude' ? 'client-assigned' : 'provider-assigned',
      workspaceAccess: assistant === 'copilot'
        ? 'read-only'
        : assistant === 'codex'
          ? 'workspace-write'
          : 'harness-managed',
      sessionIdFormat: 'uuid',
    },
  };
};

async function mockProviderStatus(page: Page, providers: unknown[]) {
  await page.route('**/api/adapters/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(providers),
    });
  });
}

test.describe('Multi-Harness Sessions and Launcher', () => {
  test.use({
    configData: {
      exists: true,
      config: {
        version: '0.2.19',
        devDir: 'C:/dev',
        workspacesDir: 'C:/ws',
        defaultAssistant: 'antigravity',
        scanDepth: 2,
      },
    },
    workspacesData: [feature],
    workspacesStatusData: {
      'feature-x': {
        id: 'feature-x',
        branchName: 'feature-x',
        changedFiles: 1,
        dirtyRepos: 1,
        runningServices: 0,
        syncStatus: 'up-to-date',
        pendingValidation: false,
      },
    },
  });

  test.beforeEach(async ({ page }) => {
    await mockProviderStatus(page, []);
  });

  test('displays sessions list and allows switching between AI harnesses', async ({ page }) => {
    const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
    await page.route('**/api/workspace/feature-x/sessions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: sessionId,
              assistant: 'codex',
              title: 'Finish the Desktop handoff',
              createdAt: '2026-08-15T00:00:00.000Z',
              updatedAt: '2026-08-16T00:00:00.000Z',
              messageCount: 6,
              workspacePath: feature.workspacePath,
              desktopHandoff: { targetId: 'codex-desktop', method: 'direct' },
            },
            {
              id: 'claude-session-1',
              assistant: 'claude',
              title: 'Refactor UI components',
              createdAt: '2026-08-14T00:00:00.000Z',
              updatedAt: '2026-08-14T10:00:00.000Z',
              messageCount: 4,
              workspacePath: feature.workspacePath,
            },
          ],
        }),
      });
    });

    await page.goto('/#/workspaces/feature-x');
    await expect(page.getByRole('heading', { name: 'feature-x' })).toBeVisible();

    // Navigate to sessions tab
    await page.getByRole('tab', { name: /Sessions|AI & Sessions/i }).click();

    // Switch to Timeline view so all sessions are listed
    await page.getByRole('button', { name: /Timeline/i }).click();

    // Check that recorded sessions appear
    await expect(page.getByText('Finish the Desktop handoff')).toBeVisible();
    await expect(page.getByText('Refactor UI components')).toBeVisible();
  });

  test('opens transcript dialog and copies CLI resume command', async ({ page }) => {
    const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
    await page.route('**/api/workspace/feature-x/sessions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: sessionId,
              assistant: 'codex',
              title: 'Implement feature workflow',
              createdAt: '2026-08-15T00:00:00.000Z',
              updatedAt: '2026-08-16T00:00:00.000Z',
              messageCount: 2,
              workspacePath: feature.workspacePath,
            },
          ],
        }),
      });
    });

    await page.route(`**/api/session/codex/${sessionId}/transcript*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'Please implement markdown rendering in the overview', timestamp: '2026-08-15T00:00:00.000Z' },
            { role: 'assistant', content: 'Here is the **Markdown** plan:\n\n1. Add ChatMarkdown\n2. Update tests', timestamp: '2026-08-15T00:01:00.000Z' },
          ],
        }),
      });
    });

    await page.goto('/#/workspaces/feature-x');
    await page.getByRole('tab', { name: /Sessions|AI & Sessions/i }).click();

    // Switch to Timeline view so all sessions are listed
    await page.getByRole('button', { name: /Timeline/i }).click();

    // Click transcript view button (named Logs)
    await page.getByRole('button', { name: /Logs/i }).first().click();

    // Verify transcript modal appears with rich markdown
    await expect(page.getByText('Please implement markdown rendering in the overview')).toBeVisible();
    await expect(page.getByText('Here is the Markdown plan:')).toBeVisible();

    // Verify copy CLI command button is available
    await expect(page.getByRole('button', { name: /Copy CLI Command/i })).toBeVisible();
  });

  test('offers current provider-owned models in the mounted SDK harness', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__harnessFrames = [];
      class MockWebSocket {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readyState = MockWebSocket.CONNECTING;
        onopen: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onclose: ((event: CloseEvent) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor(_url: string) {
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            this.onopen?.(new Event('open'));
          }, 0);
        }

        send(data: string) {
          (window as any).__harnessFrames.push(JSON.parse(data));
        }

        close() {
          this.readyState = MockWebSocket.CLOSED;
        }
      }
      (window as any).WebSocket = MockWebSocket;
    });
    await page.unroute('**/api/adapters/status');
    await mockProviderStatus(page, [{
      id: 'codex-sdk',
      name: 'Codex (First-Party SDK)',
      isConfigured: true,
      accessLabel: 'Workspace write',
      executionProfiles: [
        { id: 'review', label: 'Review only', description: 'Read-only sandbox.' },
        { id: 'workspace-write', label: 'Edit workspace', description: 'Workspace-write sandbox.' },
      ],
      defaultExecutionProfile: 'review',
      models: [
        { id: '', label: 'Automatic', description: 'Use the configured default.' },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Frontier capability.' },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Balanced.' },
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Cost-efficient.' },
      ],
      capabilities: {
        transport: 'sdk',
        sessionIdentity: 'provider-assigned',
        workspaceAccess: 'workspace-write',
        sessionIdFormat: 'uuid',
      },
    }]);
    await page.route('**/api/workspace/feature-x/sessions*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      });
    });

    await page.goto('/#/workspaces/feature-x/sessions');

    await expect(page.getByRole('heading', { name: 'Embedded harness' })).toBeVisible();
    await expect(page.getByLabel('Select Provider')).toContainText('Codex (First-Party SDK)');

    await page.getByLabel('Select model').click();
    await expect(page.getByRole('menuitem', { name: /GPT-5\.6 Sol/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /GPT-5\.6 Terra/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /GPT-5\.6 Luna/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /GPT-5 Codex/ })).toHaveCount(0);

    await page.getByRole('menuitem', { name: /GPT-5\.6 Luna/ }).click();
    await expect(page.getByLabel('Select model')).toContainText('GPT-5.6 Luna');

    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      (window as any).__harnessFrames.find((frame: { type?: string }) => frame.type === 'start')
    ))).toMatchObject({
      type: 'start',
      command: 'codex-sdk',
      cwd: feature.workspacePath,
      model: 'gpt-5.6-luna',
    });
  });
});


