import { test, expect } from './fixtures';

const feature = {
  id: 'feature-x',
  branchName: 'feature-x',
  description: 'Test feature workspace',
  repos: ['C:/dev/api-gateway'],
  assistants: [],
  workspacePath: 'C:/ws/feature-x',
  createdAt: '2026-06-01T00:00:00.000Z',
};

test.describe('Redesigned NexusFlow shell', () => {
  test.use({
    configData: {
      exists: true,
      config: { version: '0.2.19', devDir: 'C:/dev', workspacesDir: 'C:/ws', defaultAssistant: 'claude', scanDepth: 2 },
    },
    workspacesData: [feature],
    workspacesStatusData: {
      'feature-x': { id: 'feature-x', branchName: 'feature-x', changedFiles: 3, dirtyRepos: 1, runningServices: 0, syncStatus: 'up-to-date', pendingValidation: false },
    },
  });

  test('shows the dashboard overview with environment stats', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    // Stat tiles + workspace row driven by the mocked status endpoint.
    await expect(page.getByText('With uncommitted changes')).toBeVisible();
    await expect(page.getByText('feature-x').first()).toBeVisible();
    await expect(page.getByText('3 changed').first()).toBeVisible();
  });

  test('navigates to the workspaces master-detail and opens a workspace via deep link', async ({ page }) => {
    // Sidebar navigation updates the route.
    await page.goto('/');
    await page.getByRole('link', { name: 'Workspaces' }).click();
    await expect(page).toHaveURL(/#\/workspaces/);
    await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible();

    // Deep link selects a workspace and shows the detail tabs.
    await page.goto('/#/workspaces/feature-x');
    await expect(page.getByRole('heading', { name: 'feature-x' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Test feature workspace')).toBeVisible();
  });
});
