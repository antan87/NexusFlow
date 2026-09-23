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
    await page.getByRole('button', { name: 'Tools & Library' }).click();

    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(html).toHaveClass(/dark/);

    // The choice survives a reload (applied pre-paint by the boot script).
    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).toHaveClass(/dark/);
  });

  test('switches between Sunset and Aurora palettes and updates favicon and data-color-theme', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools & Library' }).click();

    const html = page.locator('html');
    const favicon = page.locator('link[rel="icon"]');

    // Default palette is sunset
    await expect(html).toHaveAttribute('data-color-theme', 'sunset');
    await expect(favicon).toHaveAttribute('href', '/favicon.svg');

    // Switch to Aurora
    await page.getByRole('button', { name: 'Switch to Aurora palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
    await expect(favicon).toHaveAttribute('href', '/favicon-aurora.svg');

    // Choice survives reload
    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
    await expect(favicon).toHaveAttribute('href', '/favicon-aurora.svg');

    // Switch back to Sunset
    await page.getByRole('button', { name: 'Switch to Sunset palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'sunset');
    await expect(favicon).toHaveAttribute('href', '/favicon.svg');
  });

  test('persists appearance mode and color palette independently across reloads', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools & Library' }).click();

    const html = page.locator('html');

    // Switch to dark mode + Aurora palette
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Switch to Aurora palette' }).click();

    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    // Reload and verify both dark mode and aurora are active
    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    // Switch back to light mode while keeping Aurora
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');

    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'aurora');
  });

  test('switches across all extended palettes (Forest, Nebula, Glacier) and validates attributes and favicons', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools & Library' }).click();

    const html = page.locator('html');
    const favicon = page.locator('link[rel="icon"]');

    // Switch to Forest
    await page.getByRole('button', { name: 'Switch to Forest palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'forest');
    await expect(favicon).toHaveAttribute('href', '/favicon-forest.svg');

    // Switch to Nebula
    await page.getByRole('button', { name: 'Switch to Nebula palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'nebula');
    await expect(favicon).toHaveAttribute('href', '/favicon-nebula.svg');

    // Switch to Glacier
    await page.getByRole('button', { name: 'Switch to Glacier palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'glacier');
    await expect(favicon).toHaveAttribute('href', '/favicon-glacier.svg');

    // Reload with Glacier active
    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'glacier');
    await expect(favicon).toHaveAttribute('href', '/favicon-glacier.svg');

    // Switch back to Sunset
    await page.getByRole('button', { name: 'Switch to Sunset palette' }).click();
    await expect(html).toHaveAttribute('data-color-theme', 'sunset');
    await expect(favicon).toHaveAttribute('href', '/favicon.svg');
  });

  test('persists newly added palettes across dark mode toggles and reloads', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Tools & Library' }).click();

    const html = page.locator('html');

    // Switch to dark mode + Forest palette
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await page.getByRole('button', { name: 'Switch to Forest palette' }).click();

    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'forest');

    // Reload and verify dark mode and forest persist
    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'forest');

    // Switch to Nebula in dark mode
    await page.getByRole('button', { name: 'Switch to Nebula palette' }).click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'nebula');

    // Switch back to light mode while keeping Nebula
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'nebula');

    await page.reload();
    await page.getByRole('button', { name: 'Tools & Library' }).click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute('data-color-theme', 'nebula');
  });
});
