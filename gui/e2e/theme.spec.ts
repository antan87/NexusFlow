import { test, expect, type Page } from '@playwright/test';

async function mockAppShell(page: Page) {
  await page.route('**/api/adapters', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adapters: [] }) });
  });
  await page.route('**/api/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        exists: true,
        config: {
          version: '0.2.7',
          devDir: 'C:\\Users\\patro\\dev',
          workspacesDir: 'C:\\Users\\patro\\dev\\workspaces',
          defaultAssistant: null,
          scanDepth: 2,
        },
      }),
    });
  });
  for (const path of ['**/api/repos', '**/api/ai-detect', '**/api/editor-detect', '**/api/workspaces']) {
    await page.route(path, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
  }
  await page.route('**/api/workflows/templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
  });
  await page.route('**/api/update-status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ currentVersion: '0.2.7', latestVersion: '0.2.7', updateAvailable: false }),
    });
  });
  await page.route('**/api/workspaces/status', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
}

test.describe('Theme toggle', () => {
  test('switches between dark and light and persists the choice', async ({ page }) => {
    await mockAppShell(page);
    await page.goto('/');

    const html = page.locator('html');
    // Dark by default (prefers-color-scheme in headless Chromium is light, but
    // the stored default resolves before first paint; assert on whatever the
    // initial state is, toggle, and expect the inverse).
    const initiallyDark = await html.evaluate((el) => el.classList.contains('dark'));

    await page
      .getByRole('button', { name: initiallyDark ? 'Switch to light theme' : 'Switch to dark theme' })
      .click();
    await expect(html).toHaveClass(initiallyDark ? /^(?!.*dark).*$/ : /dark/);

    // The choice survives a reload.
    await page.reload();
    const darkAfterReload = await html.evaluate((el) => el.classList.contains('dark'));
    expect(darkAfterReload).toBe(!initiallyDark);
  });
});
