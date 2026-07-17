import { test, expect } from './fixtures';

test.describe('Theme toggle', () => {
  // Pin the OS preference so the initial state is deterministic: fresh
  // context + light color scheme → the app must start in light mode.
  test.use({
    colorScheme: 'light',
    configData: {
      exists: true,
      config: {
        version: '0.2.7',
        devDir: 'C:\\mock-dev',
        workspacesDir: 'C:\\mock-dev\\workspaces',
        defaultAssistant: null,
        scanDepth: 2,
      },
    },
  });

  test('starts light, switches to dark, and persists the choice', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(html).toHaveClass(/dark/);

    // The choice survives a reload (applied pre-paint by the boot script).
    await page.reload();
    await expect(html).toHaveClass(/dark/);
  });
});
