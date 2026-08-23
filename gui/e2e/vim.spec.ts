import { test, expect } from './fixtures.js';

const featureA = {
  id: 'feature-alpha',
  branchName: 'feature-alpha',
  description: 'First test feature workspace',
  repos: ['C:/dev/api-gateway'],
  assistants: ['antigravity'],
  workspacePath: 'C:/ws/feature-alpha',
  createdAt: '2026-06-01T00:00:00.000Z',
};

test.describe('Vim Navigation Mode', () => {
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
    workspacesData: [featureA],
    workspacesStatusData: {
      'feature-alpha': {
        id: 'feature-alpha',
        branchName: 'feature-alpha',
        changedFiles: 2,
        dirtyRepos: 1,
        runningServices: 1,
        syncStatus: 'up-to-date',
        pendingValidation: false,
      },
    },
  });

  test('displays statusline and responds to basic mode transitions', async ({ page }) => {
    await page.goto('/');

    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();
    await expect(statusline.locator('.badge-normal')).toHaveText('NORMAL');

    // Open command mode with :
    await page.keyboard.press(':');
    await expect(statusline.locator('.badge-command')).toHaveText('COMMAND');
    const cmdline = statusline.locator('.vim-cmdline');
    await expect(cmdline).toBeVisible();
    await expect(cmdline).toBeFocused();

    // Escape returns to normal mode
    await page.keyboard.press('Escape');
    await expect(statusline.locator('.badge-normal')).toHaveText('NORMAL');
  });

  test('opens and closes help cheatsheet with ? and Esc', async ({ page }) => {
    await page.goto('/');

    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();

    // Press ? to open cheatsheet
    await page.keyboard.press('?');
    const helpModal = page.locator('.vim-help');
    await expect(helpModal).toBeVisible();
    await expect(helpModal.getByText('NexusFlow — Vim Keys')).toBeVisible();

    // Press Escape to close
    await page.keyboard.press('Escape');
    await expect(helpModal).not.toBeVisible();

    // Open via :help
    await page.keyboard.press(':');
    await page.keyboard.type('help');
    await page.keyboard.press('Enter');
    await expect(helpModal).toBeVisible();

    // Close via :q
    await page.keyboard.press(':');
    await page.keyboard.type('q');
    await page.keyboard.press('Enter');
    await expect(helpModal).not.toBeVisible();
  });

  test('navigates items with j/k, gg/G and count prefix', async ({ page }) => {
    await page.goto('/');

    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();
    await expect(page.getByText('feature-alpha').first()).toBeVisible();

    // Navigate down with j
    await page.keyboard.press('j');
    const focused1 = page.locator('.vim-focus');
    await expect(focused1).toBeVisible();

    // Navigate to bottom with G
    await page.keyboard.press('G');
    const focusedLast = page.locator('.vim-focus');
    await expect(focusedLast).toBeVisible();

    // Navigate to top with gg
    await page.keyboard.press('g');
    await page.keyboard.press('g');
    const focusedFirst = page.locator('.vim-focus');
    await expect(focusedFirst).toBeVisible();
  });

  test('switches tabs in workspace view with h/l and g-chords', async ({ page }) => {
    await page.goto('/');
    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();

    // Navigate to workspace feature-alpha
    await page.getByRole('link', { name: /feature-alpha/i }).first().click();
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha/);
    await expect(page.getByRole('heading', { name: 'feature-alpha' })).toBeVisible();

    // Initial subtab is overview
    await expect(page.locator('[data-vim-scope="overview"]')).toBeVisible();

    // Press l to advance tab to changes
    await page.keyboard.press('l');
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha\/changes/);
    await expect(page.locator('[data-vim-scope="changes"]')).toBeVisible();

    // Press l again to advance tab to services
    await page.keyboard.press('l');
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha\/services/);
    await expect(page.locator('[data-vim-scope="services"]')).toBeVisible();

    // Press h to go back to changes
    await page.keyboard.press('h');
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha\/changes/);
    await expect(page.locator('[data-vim-scope="changes"]')).toBeVisible();

    // Jump to tab 1 (overview) with g1
    await page.keyboard.press('g');
    await page.keyboard.press('1');
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha\/overview/);
    await expect(page.locator('[data-vim-scope="overview"]')).toBeVisible();
  });

  test('focuses filter input with i and returns to normal mode with Escape', async ({ page }) => {
    await page.goto('/');

    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();

    // Press i to focus filter input
    await page.keyboard.press('i');
    await expect(statusline.locator('.badge-insert')).toHaveText('INSERT');

    const filterInput = page.locator('[data-vim-search]').first();
    await expect(filterInput).toBeFocused();

    // Escape leaves INSERT mode
    await page.keyboard.press('Escape');
    await expect(statusline.locator('.badge-normal')).toHaveText('NORMAL');
    await expect(filterInput).not.toBeFocused();
  });

  test('toggles vim mode with backslash key and in Settings', async ({ page }) => {
    await page.goto('/');

    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();

    // Press \ to disable vim mode
    await page.keyboard.press('\\');
    await expect(statusline).not.toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/vim-on/);

    // Press \ to enable vim mode again
    await page.keyboard.press('\\');
    await expect(statusline).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/vim-on/);

    // Navigate to settings and check toggle
    await page.goto('/#/settings');
    const vimToggle = page.getByRole('switch', { name: 'Vim navigation toggle' });
    await expect(vimToggle).toBeVisible();
    await expect(vimToggle).toBeChecked();

    // Click toggle to disable
    await vimToggle.click();
    await expect(statusline).not.toBeVisible();
    await expect(vimToggle).not.toBeChecked();
  });

  test('clears stale focus on route/scope change and selects new scope items without throwing', async ({ page }) => {
    await page.goto('/#/workspaces/feature-alpha');
    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();
    await expect(page.getByRole('heading', { name: 'feature-alpha' })).toBeVisible();

    // Focus an item on workspace overview
    await page.keyboard.press('j');
    await expect(page.locator('.vim-focus')).toBeVisible();

    // Switch tab to changes using l
    await page.keyboard.press('l');
    await expect(page).toHaveURL(/#\/workspaces\/feature-alpha\/changes/);
    await expect(page.locator('[data-vim-scope="changes"]')).toBeVisible();

    // Focus must be cleared (detached node reference avoided)
    await expect(page.locator('.vim-focus')).toHaveCount(0);

    // Pressing j now cleanly focuses the first item in the new scope without throwing
    await page.keyboard.press('j');
    await expect(page.locator('.vim-focus')).toBeVisible();
  });

  test('suspends navigation and action triggers during modal overlays', async ({ page }) => {
    const postCalls: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/services$/.test(req.url())) {
        postCalls.push(req.url());
      }
    });

    await page.goto('/#/workspaces/feature-alpha');
    const statusline = page.locator('.vim-statusline');
    await expect(statusline).toBeVisible();
    await expect(page.getByRole('heading', { name: 'feature-alpha' })).toBeVisible();

    // Open help modal dialog
    await page.keyboard.press('?');
    const helpModal = page.locator('.vim-help');
    await expect(helpModal).toBeVisible();

    // Press j inside open modal — normal navigation is suspended and focus does not leak to background
    await page.keyboard.press('j');
    await expect(page.locator('.vim-focus')).toHaveCount(0);

    // Press s inside open modal — action key must NOT trigger background workspace start action
    await page.keyboard.press('s');
    await expect(page.locator('.vim-focus')).toHaveCount(0);
    expect(postCalls).toHaveLength(0);

    // Escape closes modal cleanly
    await page.keyboard.press('Escape');
    await expect(helpModal).not.toBeVisible();
  });
});
