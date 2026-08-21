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
});


