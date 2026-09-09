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

  test('switches between Sunset and Aurora palettes and updates favicon and data-color-theme', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const favicon = page.locator('link[rel="icon"]');

    // Default palette is sunset
    await expect(html).toHaveAttribute('data-color-theme', 'sunset');
    await expect(favicon).toHaveAttribute('href', '/favicon.svg');

    // Switch to Aurora
    await page.getByRole('button', { name: 'Aurora' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
    await expect(favicon).toHaveAttribute('href', '/favicon-aurora.svg');

    // Choice survives reload
    await page.reload();
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
    await expect(favicon).toHaveAttribute('href', '/favicon-aurora.svg');

    // Switch back to Sunset
    await page.getByRole('button', { name: 'Sunset' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'sunset');
    await expect(favicon).toHaveAttribute('href', '/favicon.svg');
  });

  test('persists appearance mode and color palette independently across reloads', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');

    // Switch to dark mode + Aurora palette
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Aurora' }).click();

    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    // Reload and verify both dark mode and aurora are active
    await page.reload();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    // Switch back to light mode while keeping Aurora
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    await page.reload();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
  });
});
