import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({
  workspacesData: [{
    id: 'demo', branchName: 'demo', name: 'Invoice speed-up', description: 'Make invoice totals load under a second', repos: ['/dev/api', '/dev/web'],
    assistants: [], workspacePath: '/ws/demo', createdAt: '2026-06-01T00:00:00.000Z',
  }],
  workspacesStatusData: { demo: { id: 'demo', branchName: 'demo', changedFiles: 3, dirtyRepos: 1, syncStatus: 'up-to-date', runningServices: 0 } },
});

async function mockWorkspace(page: Page) {
  const lifecycle = { workspaceId: 'demo', flowType: 'feature', revision: 0, updatedAt: '', fleet: [], steps: [
    { id: 'baseline', title: 'Measure baseline', status: 'completed' },
    { id: 'cache', title: 'Cache invoice lookups', status: 'in_progress' },
  ] };
  const guidance = { version: 1, revision: 0, workType: 'performance', size: 'standard', documents: [],
    assignment: { stage: 'implement', objective: 'Find the bottleneck', expectedOutput: '', stopCondition: '' } };
  await page.route('**/api/workspace/demo/plan', (route) => route.fulfill({ json: { content: '# Plan' } }));
  await page.route('**/api/workspace/demo/lifecycle', (route) => route.fulfill({ json: { lifecycle, report: { overallStatus: 'pass', canProgress: true, durationMs: 1200, repos: [] } } }));
  await page.route('**/api/workspace/demo/work', (route) => route.fulfill({ json: { guidance, lifecycle, sharedDocuments: [], assignment: '' } }));
  await page.route('**/api/workspace/demo/documents', (route) => route.fulfill({ json: { documents: [] } }));
}

const workspaceNav = (page: Page) => page.getByRole('navigation', { name: 'Workspace' });

test('one header shows where the task stands and links to where to act', async ({ page }) => {
  await mockWorkspace(page);
  // A workspace opens on its chat, whose header is short. The full header with where the task stands is on the other destinations.
  await page.goto('/#/workspaces/demo/overview');
  await expect(page.getByRole('heading', { level: 1, name: 'Invoice speed-up' })).toBeVisible();
  await expect(page.getByText('Make invoice totals load under a second').first()).toBeVisible();
  const status = page.getByRole('group', { name: 'Task status' });
  await expect(status).toContainText('Stage Implement');
  await expect(status).toContainText('Cache invoice lookups');
  await expect(status).toContainText('3 files');
  await expect(status).toContainText('Verified (1.2s)');
  // The workspace is named once; the old cockpit strip and stage switcher are gone.
  await expect(page.getByRole('heading', { name: 'Invoice speed-up' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Diff Review' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Process DAG' })).toHaveCount(0);

  await expect(workspaceNav(page).getByRole('link')).toHaveText(['Chat', 'Overview', 'Plan & Context', 'Changes3', 'Run']);
  await status.getByRole('link', { name: /Changes/ }).click();
  await expect(page).toHaveURL(/#\/workspaces\/demo\/changes$/);
  await expect(workspaceNav(page).getByRole('link', { name: /Changes/ })).toHaveAttribute('aria-current', 'page');
});

test('old section links still open, grouped under their destination, and back navigation works', async ({ page }) => {
  await mockWorkspace(page);
  for (const [section, destination] of [['knowledge', 'Plan & Context'], ['documents', 'Plan & Context'], ['services', 'Run'], ['sessions', 'Run']] as const) {
    await page.goto(`/#/workspaces/demo/${section}`);
    await expect(workspaceNav(page).getByRole('link', { name: destination })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation', { name: `${destination} sections` }).getByRole('link', { name: new RegExp(`^${section}`, 'i') })).toHaveAttribute('aria-current', 'page');
  }
  await page.goto('/#/workspaces/demo/overview');
  await workspaceNav(page).getByRole('link', { name: 'Run' }).click();
  await expect(page).toHaveURL(/\/sessions$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(workspaceNav(page).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
});

test('switching sections keeps an unsaved brief and reopens the last section used', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto('/#/workspaces/demo/plan');
  const objective = page.getByLabel('Current objective');
  await expect(objective).toHaveValue('Find the bottleneck');
  await objective.fill('Cache invoice lookups per customer');

  const sections = page.getByRole('navigation', { name: 'Plan & Context sections' });
  await sections.getByRole('link', { name: 'Documents' }).click();
  await expect(page.getByRole('region', { name: 'Documents', exact: true })).toBeVisible();
  await sections.getByRole('link', { name: 'Plan' }).click();
  // The draft was not saved, and it was not lost.
  await expect(page.getByLabel('Current objective')).toHaveValue('Cache invoice lookups per customer');

  await sections.getByRole('link', { name: 'Documents' }).click();
  await workspaceNav(page).getByRole('link', { name: 'Overview' }).click();
  await workspaceNav(page).getByRole('link', { name: 'Plan & Context' }).click();
  await expect(page).toHaveURL(/\/documents$/);
});
