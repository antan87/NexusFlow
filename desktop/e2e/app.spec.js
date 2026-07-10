import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test.describe('desktop app', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;

  test.beforeAll(async () => {
    app = await electron.launch({ args: ['.'], cwd: desktopDir });
    window = await app.firstWindow();
    // The window stays blank until main.js parses the backend port from
    // stdout and calls loadURL.
    await window.waitForURL(/localhost:\d+/, { timeout: 60_000 });
  });

  test.afterAll(async () => {
    if (!app) return;
    // close() waits for the app to exit; don't let a wedged shutdown eat
    // the whole hook timeout — force-kill as a fallback.
    await Promise.race([
      app.close(),
      new Promise((resolve) => setTimeout(resolve, 15_000)),
    ]);
    try { app.process().kill(); } catch { /* already gone */ }
  });

  test('boots the backend and loads the dashboard shell', async () => {
    await expect(window.getByText('NexusFlow', { exact: true }).first()).toBeVisible();

    const port = await window.evaluate(() => window.nexusBridge.getServerPort());
    expect(port).toBeGreaterThan(0);
  });

  test('workspaces page renders with the chat panel', async () => {
    await window.getByRole('button', { name: 'Workspaces' }).click();

    await expect(window.getByText('Select a workspace to start chatting.')).toBeVisible({ timeout: 15_000 });
  });
});
