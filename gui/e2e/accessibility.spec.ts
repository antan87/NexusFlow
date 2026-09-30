import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * Automated WCAG 2.2 AA checks for the primary journey (setup → new work →
 * workspace → plan → changes) in both themes. Automated rules cover names,
 * roles, contrast and structure; keyboard and screen-reader behaviour is
 * checked by the journey tests and manually. This is not a conformance claim.
 */
const workspace = {
  id: 'demo', branchName: 'demo', name: 'Invoice speed-up', description: 'Make invoice totals load under a second',
  repos: ['/dev/api'], assistants: ['claude'], workspacePath: '/ws/demo', createdAt: '2026-06-01T00:00:00.000Z',
};

async function mockWorkspace(page: Page) {
  const lifecycle = { workspaceId: 'demo', flowType: 'feature', revision: 0, updatedAt: '', fleet: [], steps: [
    { id: 'cache', title: 'Cache invoice lookups', status: 'in_progress' },
  ] };
  await page.route('**/api/workspace/demo/plan', (route) => route.fulfill({ json: { content: '# Plan\n\nCache lookups.' } }));
  await page.route('**/api/workspace/demo/lifecycle', (route) => route.fulfill({ json: { lifecycle, report: { overallStatus: 'fail', canProgress: false, durationMs: 900, repos: [] } } }));
  await page.route('**/api/workspace/demo/work', (route) => route.fulfill({ json: {
    guidance: { version: 1, revision: 0, workType: 'feature', size: 'standard', documents: [], assignment: { stage: 'implement', objective: 'Cache lookups', expectedOutput: '', stopCondition: '' } },
    lifecycle, sharedDocuments: [], assignment: '',
  } }));
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents: [] } }));
  await page.route('**/api/workspace/demo/changes', (route) => route.fulfill({ json: { changes: [{ repoName: 'api', repoPath: '/dev/api', files: [{ file: 'cache.ts', type: 'modified', additions: 4, deletions: 1 }] }] } }));
}

async function expectNoSeriousViolations(page: Page, label: string) {
  // Measure settled colours: a fade or an enabled/disabled transition caught
  // mid-way reports a contrast no user sees.
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // Third-party code editors and terminals manage their own accessibility tree.
    .exclude('.monaco-editor')
    .exclude('.xterm')
    .analyze();
  const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  const summary = serious.map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.slice(0, 3).map((node) => `${node.target.join(' ')} ${node.failureSummary?.split('\n').slice(1, 2).join('') ?? ''} ${node.html.slice(0, 120)}`).join(' | ')}`);
  expect(summary, `${label}: ${summary.join('\n')}`).toEqual([]);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({
      colorScheme,
      workspacesData: [workspace],
      workspacesStatusData: { demo: { id: 'demo', branchName: 'demo', changedFiles: 1, dirtyRepos: 1, syncStatus: 'up-to-date', runningServices: 0 } },
      reposData: { data: [{ name: 'api', path: '/dev/api', defaultBranch: 'main' }] },
    });

    test('first-run setup', async ({ page }) => {
      await page.route('**/api/config', (route) => route.fulfill({ json: {
        exists: false, platform: 'linux', suggested: { devDir: '/home/me/dev', workspacesDir: '/home/me/dev/workspaces' },
        config: { version: '1.0.0', devDir: '', workspacesDir: '', defaultAssistant: null, scanDepth: 2 },
      } }));
      await page.route('**/api/config/validate', (route) => route.fulfill({ json: {
        ok: false,
        devDir: { path: '/home/me/dev', status: 'ok', message: '', repoCount: 1 },
        workspacesDir: { path: '/home/me/dev/workspaces', status: 'not-writable', message: "ContextSpace can't create workspaces here. Choose a folder you can write to." },
      } }));
      await page.goto('/');
      await expect(page.getByText("can't create workspaces here")).toBeVisible();
      await expectNoSeriousViolations(page, 'setup');
    });

    test('overview and new work', async ({ page }) => {
      await page.goto('/#/overview');
      await expect(page.getByRole('main')).toBeVisible();
      await expectNoSeriousViolations(page, 'overview');
      await page.goto('/#/new');
      await expect(page.getByRole('heading', { name: 'New workspace' })).toBeVisible();
      await expectNoSeriousViolations(page, 'new work');
    });

    test('workspace destinations', async ({ page }) => {
      await mockWorkspace(page);
      for (const section of ['overview', 'plan', 'documents', 'changes']) {
        await page.goto(`/#/workspaces/demo/${section}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Invoice speed-up' })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Task status' })).toContainText('Verification failed');
        if (section === 'documents') await expect(page.getByText('No documents in the workspace root yet.', { exact: false })).toBeVisible();
        await expectNoSeriousViolations(page, `workspace ${section}`);
      }
    });
  });
}

test.describe('constrained windows', () => {
  test.use({ workspacesData: [workspace], viewport: { width: 900, height: 800 } });

  test('keep the task in view at 900×800 without horizontal scrolling', async ({ page }) => {
    await mockWorkspace(page);
    await page.goto('/#/workspaces/demo/plan');
    await expect(page.getByRole('heading', { level: 1, name: 'Invoice speed-up' })).toBeVisible();
    // The sidebar starts as a rail, leaving the content most of the width.
    const main = await page.getByRole('main').boundingBox();
    expect(main!.width).toBeGreaterThanOrEqual(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
    for (const name of ['Overview', 'Plan & Context', 'Changes', 'Run']) {
      await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: new RegExp(`^${name}`) })).toBeInViewport();
    }
    // The rail still expands on request, by keyboard.
    await page.getByRole('button', { name: /Expand/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'All workspaces' })).toBeVisible();
  });

  test('keep the full sidebar in a 1024-wide window', async ({ page }) => {
    // Windows CI clamps the desktop window to a 1024×768 screen; the rail is only for narrower windows.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/#/overview');
    await expect(page.getByText('ContextSpace', { exact: true }).first()).toBeVisible();
  });

  test('keep primary actions reachable at 200% zoom (720 CSS pixels)', async ({ page }) => {
    // 200% zoom of a 1440-wide window leaves 720 CSS pixels.
    await page.setViewportSize({ width: 720, height: 525 });
    await mockWorkspace(page);
    await page.goto('/#/workspaces/demo/overview');
    await expect(page.getByRole('heading', { level: 1, name: 'Invoice speed-up' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(720);
    const nav = page.getByRole('navigation', { name: 'Workspace' });
    await nav.getByRole('link', { name: 'Run' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sessions$/);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  });
});
