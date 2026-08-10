import { test, expect, type Page } from './fixtures';

const feature = {
  id: 'feature-x',
  branchName: 'feature-x',
  description: 'Improve the local harness handoff',
  repos: ['C:/dev/nexusflow'],
  assistants: ['claude', 'codex'],
  workspacePath: 'C:/ws/feature-x',
  createdAt: '2026-08-10T00:00:00.000Z',
};

const provider = (assistant: 'claude' | 'codex', isConfigured = true) => ({
  id: `${assistant}-cli`,
  name: assistant === 'claude' ? 'Claude Code (Local CLI)' : 'Codex (Local CLI)',
  isConfigured,
  message: isConfigured ? undefined : `Run ${assistant} login first.`,
  capabilities: {
    transport: 'cli-print',
    sessionIdentity: assistant === 'claude' ? 'client-assigned' : 'provider-assigned',
    workspaceAccess: 'workspace-write',
    sessionIdFormat: 'uuid',
  },
});

async function mockProviderStatus(page: Page, providers: unknown[]) {
  await page.route('**/api/adapters/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(providers),
    });
  });
}

test.describe('Claude and Codex embedded handoff', () => {
  test.use({
    workspacesData: [feature],
    workspacesStatusData: {
      'feature-x': {
        id: 'feature-x',
        branchName: 'feature-x',
        changedFiles: 0,
        dirtyRepos: 0,
        runningServices: 0,
        syncStatus: 'up-to-date',
        pendingValidation: false,
      },
    },
  });

  for (const scenario of [
    { assistant: 'claude' as const, id: '123e4567-e89b-42d3-a456-426614174000' },
    { assistant: 'codex' as const, id: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
  ]) {
    test(`resumes a ${scenario.assistant} session directly in chat`, async ({ page }) => {
      const frames: Array<Record<string, unknown>> = [];
      const legacyRequests: string[] = [];
      page.on('request', (request) => {
        if (/\/resume$|\/api\/open-editor$/.test(new URL(request.url()).pathname)) {
          legacyRequests.push(request.url());
        }
      });

      await mockProviderStatus(page, [provider('claude'), provider('codex')]);
      await page.route('**/api/workspace/feature-x/sessions', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            sessions: [{
              id: scenario.id,
              assistant: scenario.assistant,
              title: `${scenario.assistant} prior work`,
              createdAt: '2026-08-09T00:00:00.000Z',
              updatedAt: '2026-08-10T00:00:00.000Z',
              messageCount: 2,
            }],
          }),
        });
      });
      await page.route(`**/api/session/${scenario.assistant}/${scenario.id}/transcript`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            messages: [
              { role: 'user', content: 'Inspect the repository' },
              { role: 'assistant', content: 'Inspection complete' },
            ],
          }),
        });
      });
      await page.routeWebSocket('**/ws', (socket) => {
        socket.onMessage((message) => {
          const frame = JSON.parse(String(message));
          frames.push(frame);
          if (frame.type === 'input') {
            socket.send(JSON.stringify({ type: 'status', state: 'idle' }));
          }
        });
      });

      await page.goto('/#/workspaces/feature-x/sessions');
      await page.getByPlaceholder(/Start the agent/).fill('Do not send this unrelated draft');
      await page.getByRole('button', { name: 'Resume in Chat' }).click();

      await expect(page.getByText('Inspection complete')).toBeVisible();
      await expect.poll(() => frames.length).toBeGreaterThanOrEqual(1);
      expect(frames[0]).toEqual({
        type: 'start',
        command: `${scenario.assistant}-cli`,
        cwd: 'C:/ws/feature-x',
        sessionId: scenario.id,
        resume: true,
      });
      expect(frames.filter((frame) => frame.type === 'input')).toEqual([]);

      const composer = page.getByPlaceholder(/Message the agent/);
      await composer.fill('Continue from there');
      await composer.press('Enter');
      await expect.poll(() => frames.filter((frame) => frame.type === 'input').length).toBe(1);
      expect(frames.filter((frame) => frame.type === 'input')).toEqual([
        { type: 'input', input: 'Continue from there' },
      ]);
      expect(legacyRequests).toEqual([]);
    });
  }

  test('preserves the current chat when a resume transcript cannot be loaded', async ({ page }) => {
    let socketCount = 0;
    await page.addInitScript(() => {
      localStorage.setItem('nexusflow_chat_feature-x', JSON.stringify({
        v: 3,
        sessions: {},
        providerId: 'claude-cli',
        messages: [{ role: 'assistant', content: 'Keep this current chat' }],
      }));
    });
    await mockProviderStatus(page, [provider('claude')]);
    await page.route('**/api/workspace/feature-x/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [{
            id: '123e4567-e89b-42d3-a456-426614174000',
            assistant: 'claude',
            title: 'Unavailable transcript',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
            messageCount: 2,
          }],
        }),
      });
    });
    await page.route('**/api/session/claude/*/transcript', async (route) => {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"missing"}' });
    });
    await page.routeWebSocket('**/ws', () => {
      socketCount += 1;
    });

    await page.goto('/#/workspaces/feature-x/sessions');
    await expect(page.getByText('Keep this current chat')).toBeVisible();
    await page.getByRole('button', { name: 'Resume in Chat' }).click();

    await expect(page.getByText('Keep this current chat')).toBeVisible();
    await expect(page.getByText(/current chat was preserved/i)).toBeVisible();
    expect(socketCount).toBe(0);
  });

  test('does not open a socket for an unavailable local CLI', async ({ page }) => {
    let socketCount = 0;
    let transcriptRequests = 0;
    await mockProviderStatus(page, [provider('claude', false)]);
    await page.route('**/api/workspace/feature-x/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [{
            id: '123e4567-e89b-42d3-a456-426614174000',
            assistant: 'claude',
            title: 'Claude session',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
            messageCount: 2,
          }],
        }),
      });
    });
    await page.route('**/api/session/claude/*/transcript', async (route) => {
      transcriptRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"messages":[]}' });
    });
    await page.routeWebSocket('**/ws', () => {
      socketCount += 1;
    });

    await page.goto('/#/workspaces/feature-x/sessions');
    await page.getByRole('button', { name: 'Resume in Chat' }).click();

    await expect(page.getByText(/Run claude login first/i).first()).toBeVisible();
    expect(transcriptRequests).toBe(0);
    expect(socketCount).toBe(0);
  });

  test('cancels a delayed resume when the workspace chat unmounts', async ({ page }) => {
    let socketCount = 0;
    let releaseTranscript!: () => void;
    let noteTranscriptRequested!: () => void;
    const transcriptGate = new Promise<void>((resolve) => { releaseTranscript = resolve; });
    const transcriptRequested = new Promise<void>((resolve) => { noteTranscriptRequested = resolve; });

    await mockProviderStatus(page, [provider('claude')]);
    await page.route('**/api/workspace/feature-x/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [{
            id: '123e4567-e89b-42d3-a456-426614174000',
            assistant: 'claude',
            title: 'Delayed session',
            createdAt: '2026-08-09T00:00:00.000Z',
            updatedAt: '2026-08-10T00:00:00.000Z',
            messageCount: 2,
          }],
        }),
      });
    });
    await page.route('**/api/session/claude/*/transcript', async (route) => {
      noteTranscriptRequested();
      await transcriptGate;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [{ role: 'assistant', content: 'Stale transcript' }] }),
      }).catch(() => {});
    });
    await page.routeWebSocket('**/ws', () => { socketCount += 1; });

    await page.goto('/#/workspaces/feature-x/sessions');
    await page.getByPlaceholder(/Start the agent/).fill('Keep this draft');
    await page.getByRole('button', { name: 'Resume in Chat' }).click();
    await transcriptRequested;
    await expect(page.getByPlaceholder(/Start the agent/)).toBeDisabled();

    await page.goto('/#/dashboard');
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    releaseTranscript();
    await page.waitForTimeout(100);

    expect(socketCount).toBe(0);
  });

  test('keeps a connection bound to Codex when StrictMode status requests settle out of order', async ({ page }) => {
    const frames: Array<Record<string, unknown>> = [];
    let statusRequests = 0;
    let releaseFirstStatus!: () => void;
    const firstStatusGate = new Promise<void>((resolve) => { releaseFirstStatus = resolve; });

    await page.addInitScript(() => {
      localStorage.setItem('nexusflow_chat_feature-x', JSON.stringify({
        v: 3,
        sessions: {},
        providerId: 'codex-cli',
        messages: [],
      }));
    });
    await page.route('**/api/adapters/status', async (route) => {
      statusRequests += 1;
      if (statusRequests === 1) {
        await firstStatusGate;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([provider('claude')]),
        }).catch(() => {});
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([provider('claude'), provider('codex')]),
      });
    });
    await page.routeWebSocket('**/ws', (socket) => {
      socket.onMessage((message) => frames.push(JSON.parse(String(message))));
    });

    await page.goto('/#/workspaces/feature-x');
    await expect.poll(() => statusRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByLabel('Select Provider')).toContainText('Codex');
    await page.getByPlaceholder(/Start the agent/).fill('Use the bound provider');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(() => frames.length).toBeGreaterThanOrEqual(2);

    releaseFirstStatus();
    await page.waitForTimeout(100);

    await expect(page.getByLabel('Select Provider')).toContainText('Codex');
    expect(frames[0]).toMatchObject({ command: 'codex-cli', cwd: 'C:/ws/feature-x' });
    expect(frames[1]).toEqual({ type: 'input', input: 'Use the bound provider' });
  });

  test('keeps unsupported sessions view-only', async ({ page }) => {
    await mockProviderStatus(page, [provider('claude'), provider('codex')]);
    await page.route('**/api/workspace/feature-x/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: 'copilot-session',
              assistant: 'copilot',
              title: 'Copilot transcript',
              createdAt: '2026-08-09T00:00:00.000Z',
              updatedAt: '2026-08-10T00:00:00.000Z',
              messageCount: 1,
            },
            {
              id: 'antigravity-session',
              assistant: 'antigravity',
              title: 'Antigravity transcript',
              createdAt: '2026-08-09T00:00:00.000Z',
              updatedAt: '2026-08-10T00:00:00.000Z',
              messageCount: 1,
            },
          ],
        }),
      });
    });
    await page.route('**/api/session/copilot/copilot-session/transcript', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ messages: [{ role: 'assistant', content: 'Read-only history' }] }),
      });
    });

    await page.goto('/#/workspaces/feature-x/sessions');
    await expect(page.getByRole('button', { name: 'Resume in Chat' })).toHaveCount(0);
    await page.getByRole('button', { name: 'View Chat Log' }).first().click();

    await expect(page.getByText('Read-only history')).toBeVisible();
    await expect(page.getByText(/view-only transcript/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resume in Chat' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy Resume Command' })).toBeVisible();
  });
});
