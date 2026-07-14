import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// When NEXUSFLOW_PACKAGED_EXE is set (CI, after electron-builder), drive the
// real packaged binary — exercising the app.isPackaged path in main.js that
// runs the bundled backend via ELECTRON_RUN_AS_NODE. Otherwise run the dev
// build (`electron .`).
const packagedExe = process.env.NEXUSFLOW_PACKAGED_EXE
  ? path.resolve(desktopDir, process.env.NEXUSFLOW_PACKAGED_EXE)
  : null;

test.describe('desktop app', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;

  test.beforeAll(async () => {
    app = packagedExe
      ? await electron.launch({ executablePath: packagedExe })
      : await electron.launch({ args: ['.'], cwd: desktopDir });
    // Surface the Electron main-process output (main.js logs the backend
    // spawn path and its stdout/stderr) so a backend startup failure is
    // visible in the test log instead of an opaque navigation timeout.
    app.process().stdout?.on('data', (d) => console.log(`[main] ${d.toString().trimEnd()}`));
    app.process().stderr?.on('data', (d) => console.log(`[main:err] ${d.toString().trimEnd()}`));
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
