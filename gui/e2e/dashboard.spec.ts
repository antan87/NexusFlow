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

test.describe('Redesigned ContextSpace shell', () => {
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

  test('puts active workspaces and their status first', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    const totals = page.getByRole('region', { name: 'Overview totals' });
    await expect(totals.getByRole('group', { name: 'Workspaces' })).toContainText('1');
    await expect(totals.getByRole('group', { name: 'Review queue' })).toContainText('3');
    await expect(totals.getByRole('group', { name: 'Tracked repos' })).toContainText('1');
    await expect(page.getByRole('heading', { name: /Active workspaces/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Test feature workspace' })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article').getByRole('button', { name: /Open workspace/ })).toBeVisible();
    await expect(page.getByRole('article').getByText('3 modified files')).toBeVisible();
    await expect(page.getByRole('article').getByRole('button', { name: 'Review diffs' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Search workspaces' })).toHaveCount(0);
    await expect(page.getByText('External Coding Harnesses')).not.toBeVisible();
    await page.screenshot({ path: 'test-results/overview-cards.png', fullPage: true });
    await page.getByText('Assistant launchers').click();
    await expect(page.getByText('External Coding Harnesses')).toBeVisible();
  });

  test('navigates to the workspaces master-detail and opens a workspace via deep link', async ({ page }) => {
    // Sidebar navigation updates the route.
    await page.goto('/');
    await page.getByRole('link', { name: /feature-x/ }).first().click();
    await expect(page).toHaveURL(/#\/workspaces\/feature-x/);
    await expect(page.getByRole('heading', { name: 'feature-x' })).toBeVisible();

    // Deep link selects a workspace and shows the detail tabs.
    await page.goto('/#/workspaces/feature-x/overview');
    await expect(page.getByRole('heading', { name: 'feature-x' })).toBeVisible();
    await expect(page.getByText('Test feature workspace', { exact: true }).first()).toBeVisible();
    // The overview keeps its address; the rail beside it opens the other parts.
    await page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Plan' }).click();
    await expect(page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Plan' })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Overview diffs', () => {
  test.use({
    workspacesData: [[feature, {
      ...feature,
      id: 'feature-clean', branchName: 'feature-clean', description: 'Clean workspace',
      repos: ['C:/dev/website'], workspacePath: 'C:/ws/feature-clean',
    }], { scope: 'test' }],
    workspacesStatusData: {
      'feature-x': { id: 'feature-x', branchName: 'feature-x', changedFiles: 3, dirtyRepos: 1, runningServices: 0, syncStatus: 'up-to-date', pendingValidation: false },
      'feature-clean': { id: 'feature-clean', branchName: 'feature-clean', changedFiles: 0, dirtyRepos: 0, runningServices: 0, syncStatus: 'up-to-date', pendingValidation: false },
    },
  });

  test('shows the total and opens the workspaces with diffs', async ({ page }) => {
    await page.goto('/');
    const reviewQueue = page.getByRole('region', { name: 'Overview totals' }).getByRole('group', { name: 'Review queue' });
    await expect(reviewQueue).toContainText('3');
    await expect(reviewQueue).toContainText('1 workspace with diffs');
    await expect(page.getByRole('article')).toHaveCount(2);

    await reviewQueue.getByRole('button', { name: 'Show workspaces with diffs' }).click();
    await expect(page.getByRole('heading', { name: /Workspaces with diffs/ })).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(1);
    await expect(page.getByRole('article').getByRole('heading', { name: 'Clean workspace' })).toHaveCount(0);
    await page.getByRole('article').getByRole('button', { name: 'Review diffs' }).click();
    await expect(page).toHaveURL(/#\/workspaces\/feature-x\/changes/);
  });
});

test.describe('Many workspaces', () => {
  const workspaces = Array.from({ length: 33 }, (_, index) => ({
    ...feature,
    id: `feature-${index}`,
    branchName: `feature-${index}`,
    description: `Workspace ${index}`,
    workspacePath: `C:/ws/feature-${index}`,
    createdAt: new Date(Date.UTC(2026, 5, 33 - index)).toISOString(),
  }));
  test.use({
    workspacesData: [workspaces, { scope: 'test' }],
    workspacesStatusData: Object.fromEntries(workspaces.map((ws, index) => [ws.branchName, {
      id: ws.id, branchName: ws.branchName, changedFiles: index === 32 ? 7 : 0,
      dirtyRepos: index === 32 ? 1 : 0, runningServices: 0,
      syncStatus: 'up-to-date', pendingValidation: false,
    }])),
  });

  test('loads status in pages, then reveals cards and sidebar rows on demand', async ({ page }) => {
    const offsets: number[] = [];
    let releaseSecondPage = () => {};
    const secondPageHeld = new Promise<void>((resolve) => { releaseSecondPage = resolve; });
    await page.route('**/api/workspaces/status?*', async (route) => {
      if (new URL(route.request().url()).searchParams.get('offset') === '24') await secondPageHeld;
      await route.fallback();
    });
    page.on('request', (request) => {
      if (request.url().includes('/api/workspaces/status?')) {
        offsets.push(Number(new URL(request.url()).searchParams.get('offset')));
      }
    });
    await page.goto('/');
    const totals = page.getByRole('region', { name: 'Overview totals' });
    await expect(page.getByRole('article')).toHaveCount(12);
    await expect(totals.getByRole('group', { name: 'Review queue' })).toContainText('Checking 24 of 33 workspaces');
    releaseSecondPage();
    await expect(totals.getByRole('group', { name: 'Review queue' })).toContainText('7');
    expect(offsets).toContain(0);
    expect(offsets).toContain(24);
    await page.getByRole('button', { name: /Show more workspaces \(21 remaining\)/ }).click();
    await expect(page.getByRole('article')).toHaveCount(24);
    await page.getByRole('button', { name: /Show more workspaces \(3 remaining\)/ }).click();
    await expect(page.getByRole('link', { name: /feature-32/ })).toBeVisible();
  });
});

test.describe('Narrow-screen navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, workspacesData: [feature] });

  test('opens, restores keyboard focus, and closes after selecting a workspace', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Active workspaces/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const trigger = page.getByRole('button', { name: 'Open navigation', exact: true });
    await trigger.click();
    const navigation = page.getByRole('dialog', { name: 'Navigation', exact: true });
    await expect(navigation).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(navigation).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await navigation.getByRole('link', { name: /feature-x/ }).click();
    await expect(page).toHaveURL(/#\/workspaces\/feature-x/);
    await expect(navigation).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'feature-x' })).toBeVisible();
    const main = await page.getByRole('main').boundingBox();
    expect(main?.width).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // Every destination and section stays reachable by keyboard without growing the page.
    const skills = page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: /^Skills/ });
    await skills.focus();
    await page.keyboard.press('Enter');
    await expect(skills).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
