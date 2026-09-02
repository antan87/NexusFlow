import { test, expect } from './fixtures';
import type { Route } from '@playwright/test';

const workspace = {
  id: 'feature-one',
  branchName: 'feature-one',
  description: 'Build collaboration',
  repos: ['C:\\mock-dev\\repo-one'],
  assistants: ['codex'],
  workspacePath: 'C:\\mock-dev\\workspaces\\feature-one',
  createdAt: '2026-08-27T10:00:00.000Z',
};

function hostStatus() {
  const now = '2026-08-27T10:00:00.000Z';
  return {
    mode: 'host',
    roomId: 'room-1234567890abcdef1234567890abcdef',
    name: 'Feature One Workroom',
    url: 'https://10.0.0.7:4242',
    localWorkspaceId: 'feature-one',
    certificateFingerprint: 'AB'.repeat(32),
    snapshot: {
      schemaVersion: 1,
      roomId: 'room-1234567890abcdef1234567890abcdef',
      name: 'Feature One Workroom',
      address: '10.0.0.7',
      port: 4242,
      certificateFingerprint: 'AB'.repeat(32),
      revision: 1,
      createdAt: now,
      bundle: {
        schemaVersion: 1,
        project: { id: 'project-one', name: 'Project One' },
        feature: { id: 'feature-one', goal: 'Build collaboration', description: 'Synthetic E2E room.' },
        repos: [{ id: 'repo-one', name: 'Repo One', remoteUrl: 'https://example.test/repo-one', defaultBranch: 'main' }],
        pinnedResources: [],
        createdAt: now,
      },
      documents: {
        plan: { name: 'plan', revision: 0, content: '# Plan', updatedAt: now, updatedBy: 'member-host', history: [] },
        decisions: { name: 'decisions', revision: 0, content: '# Decisions', updatedAt: now, updatedBy: 'member-host', history: [] },
        handoff: { name: 'handoff', revision: 0, content: '', updatedAt: now, updatedBy: 'member-host', history: [] },
      },
      participants: [{ id: 'member-host', displayName: 'Host', role: 'host', joinedAt: now, lastSeenAt: now }],
      pendingJoins: [],
      resources: [],
      activity: [{ sequence: 1, type: 'room.created', actorId: 'member-host', createdAt: now, summary: 'Workroom created.' }],
    },
  };
}

test.describe('Workrooms', () => {
  test.use({ workspacesData: [workspace] });
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/workrooms/bootstrap', async (route) => route.fulfill({
      json: { token: 'test-workroom-bootstrap-token' },
      headers: { 'Set-Cookie': 'nexusflow_workroom_bootstrap=test-workroom-bootstrap-token; Path=/api/workrooms; HttpOnly; SameSite=Strict' },
    }));
  });

  test('previews the sharing boundary and starts an explicit private listener', async ({ page }) => {
    let status: any = { mode: 'idle' };
    await page.route('**/api/workrooms/status', async (route) => route.fulfill({ json: { status } }));
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [{ name: 'VPN', address: '10.0.0.7', family: 'IPv4', internal: false }] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/preview/feature-one', async (route) => route.fulfill({ json: {
      preview: {
        workspaceId: 'feature-one',
        bundle: hostStatus().snapshot.bundle,
        bundleDigest: 'ab'.repeat(32),
        bundleWarnings: [],
        documents: { plan: '# Plan', decisions: '# Decisions', handoff: '' },
        warnings: { plan: [], decisions: [], handoff: [] },
      },
    } }));
    await page.route('**/api/workrooms/start', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.address).toBe('10.0.0.7');
      expect(body.workspaceId).toBe('feature-one');
      expect(body.contextConfirmed).toBe(true);
      expect(body.contextDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(body.documents).toEqual({ plan: '# Plan', decisions: '', handoff: '' });
      status = hostStatus();
      await route.fulfill({ status: 201, json: { status } });
    });
    await page.route('**/api/workrooms/local-resources', async (route) => route.fulfill({ json: { resources: [] } }));

    await page.goto('/#/workrooms');
    await expect(page.getByRole('heading', { name: 'Workrooms' })).toBeVisible();
    await page.getByText('Select a workspace').click();
    await page.getByRole('option', { name: 'feature-one' }).click();
    await expect(page.getByText('Exact sharing review')).toBeVisible();
    await expect(page.getByText(/never adds code, diffs, credentials/i)).toBeVisible();
    await page.getByLabel('Include Plan').check();
    await page.getByText(/I reviewed the exact included text/).click();
    await page.getByRole('button', { name: 'Start private Workroom' }).click();
    await expect(page.getByRole('heading', { name: 'Feature One Workroom' })).toBeVisible();
    await expect(page.getByText('Never collected automatically')).toBeVisible();
  });

  test('keeps an optimistic context draft visible after a conflict', async ({ page }) => {
    const status = hostStatus();
    await page.route('**/api/workrooms/status', async (route) => route.fulfill({ json: { status } }));
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/local-resources', async (route) => route.fulfill({ json: { resources: [] } }));
    await page.route('**/api/workrooms/documents/plan', async (route) => route.fulfill({ status: 409, json: { error: 'revision conflict' } }));

    await page.goto('/#/workrooms');
    await page.getByRole('tab', { name: 'context' }).click();
    const plan = page.locator('textarea').first();
    await plan.fill('# My preserved draft');
    await page.getByRole('button', { name: 'Share revision' }).first().click();
    await expect(plan).toHaveValue('# My preserved draft');
    await expect(page.getByText(/draft is preserved/i)).toBeVisible();
  });

  test('shows a locked active room and explicitly reconnects the local dashboard', async ({ page }) => {
    let reclaimed = false;
    await page.route('**/api/workrooms/status', async (route) => reclaimed
      ? route.fulfill({ json: { status: hostStatus() } })
      : route.fulfill({ status: 401, json: { error: 'human session required' } }));
    await page.route('**/api/workrooms/session', async (route) => route.fulfill({ json: { active: true, locked: true, roomType: 'host' } }));
    await page.route('**/api/workrooms/session/reclaim', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ password: 'correct horse battery staple' });
      reclaimed = true;
      await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/local-resources', async (route) => route.fulfill({ json: { resources: [] } }));

    await page.goto('/#/workrooms');
    await expect(page.getByRole('heading', { name: 'Active Workroom is locked' })).toBeVisible();
    await page.getByLabel('Room password').fill('correct horse battery staple');
    await page.getByRole('button', { name: 'Unlock host dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Feature One Workroom' })).toBeVisible();
  });

  test('reacquires one rotated bootstrap for concurrent rejected read and mutation requests', async ({ page }) => {
    await page.unroute('**/api/workrooms/bootstrap');
    let bootstrapCalls = 0;
    await page.route('**/api/workrooms/bootstrap', async (route) => {
      bootstrapCalls += 1;
      const token = bootstrapCalls === 1 ? 'stale-bootstrap-token' : 'fresh-bootstrap-token';
      await route.fulfill({
        json: { token },
        headers: { 'Set-Cookie': `nexusflow_workroom_bootstrap=${token}; Path=/api/workrooms; HttpOnly; SameSite=Strict` },
      });
    });
    let staleRequests = 0;
    let releaseStaleRequests!: () => void;
    const bothStaleRequestsArrived = new Promise<void>((resolve) => { releaseStaleRequests = resolve; });
    const respondAfterRotation = (body: unknown) => async (route: Route) => {
      const token = route.request().headers()['x-nexusflow-workroom-bootstrap'];
      if (token === 'stale-bootstrap-token') {
        staleRequests += 1;
        if (staleRequests === 2) releaseStaleRequests();
        await bothStaleRequestsArrived;
        await route.fulfill({ status: 403, json: { error: 'Workroom access requires a same-origin dashboard bootstrap.' } });
        return;
      }
      expect(token).toBe('fresh-bootstrap-token');
      await route.fulfill({ json: body });
    };
    const digest = 'a'.repeat(64);
    await page.route('**/api/workrooms/status', respondAfterRotation({ status: { mode: 'idle' } }));
    await page.route(`**/api/workrooms/resources/${digest}/quarantine`, respondAfterRotation({ success: true }));

    await page.goto('/');
    const results = await page.evaluate(async (resourceDigest) => {
      const { apiFetch } = await import('/src/lib/api/client.ts');
      return Promise.all([
        apiFetch<{ status: { mode: string } }>('/api/workrooms/status'),
        apiFetch<{ success: boolean }>(`/api/workrooms/resources/${resourceDigest}/quarantine`, {
          method: 'POST', body: '{}',
        }),
      ]);
    }, digest);
    expect(results).toEqual([{ status: { mode: 'idle' } }, { success: true }]);
    expect(bootstrapCalls).toBe(2);
    expect(staleRequests).toBe(2);
  });

  test('makes a locked guest leave before joining again', async ({ page }) => {
    await page.route('**/api/workrooms/status', async (route) => route.fulfill({ status: 401, json: { error: 'human session required' } }));
    await page.route('**/api/workrooms/session', async (route) => route.fulfill({ json: { active: true, locked: true, roomType: 'guest' } }));
    await page.route('**/api/workrooms/session/abandon', async (route) => {
      expect(route.request().postDataJSON()).toEqual({ confirm: true });
      await route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));

    await page.goto('/#/workrooms');
    await expect(page.getByText(/leave this local guest connection/i)).toBeVisible();
    await page.getByRole('button', { name: 'Leave and rejoin' }).click();
    await expect(page.getByRole('heading', { name: 'Workrooms' })).toBeVisible();
  });

  test('lets a disconnected accepted guest retry or leave locally', async ({ page }) => {
    const status = {
      mode: 'guest', roomId: 'room-one', url: 'https://10.0.0.7:4242',
      status: 'accepted', connection: 'disconnected', memberId: 'member-guest',
    };
    await page.route('**/api/workrooms/status', async (route) => route.fulfill({ json: { status } }));
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));

    await page.goto('/#/workrooms');
    await expect(page.getByRole('heading', { name: 'Workroom connection is unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave local connection' })).toBeVisible();
  });

  test('submits human workflow evidence when completing a required step', async ({ page }) => {
    const status = hostStatus();
    (status.snapshot as any).workflowProgress = {
      workflow: { digest: 'cd'.repeat(32), version: '0.1.0' },
      package: { name: 'Verification workflow', steps: [{ id: 'verify', title: 'Verify', requiresEvidence: true }] },
      revision: 0,
      steps: [{ stepId: 'verify', status: 'in_progress', revision: 0 }],
    };
    await page.route('**/api/workrooms/status', async (route) => route.fulfill({ json: { status } }));
    await page.route('**/api/workrooms/interfaces', async (route) => route.fulfill({ json: { interfaces: [] } }));
    await page.route('**/api/workrooms/paused', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/quarantined', async (route) => route.fulfill({ json: { rooms: [] } }));
    await page.route('**/api/workrooms/local-resources', async (route) => route.fulfill({ json: { resources: [] } }));
    await page.route('**/api/workrooms/workflow/steps/verify/transition', async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ status: 'completed', expectedRevision: 0, evidence: '39 focused tests passed' });
      await route.fulfill({ json: { step: { stepId: 'verify', status: 'completed', revision: 1 } } });
    });

    await page.goto('/#/workrooms');
    await page.getByRole('tab', { name: 'workflow' }).click();
    await page.getByLabel('Completion evidence').fill('39 focused tests passed');
    await page.getByRole('button', { name: 'Complete' }).click();
    await expect(page.getByLabel('Completion evidence')).toHaveValue('39 focused tests passed');
  });
});
