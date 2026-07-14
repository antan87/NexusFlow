import { test, expect, _electron as electron } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const desktopDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// When NEXUSFLOW_PACKAGED_EXE is set (CI, after electron-builder), drive the
// real packaged binary — exercising the app.isPackaged path in main.js that
// runs the bundled backend via ELECTRON_RUN_AS_NODE. Otherwise run the dev
// build (`electron .`).
const packagedExe = process.env.NEXUSFLOW_PACKAGED_EXE
  ? path.resolve(desktopDir, process.env.NEXUSFLOW_PACKAGED_EXE)
  : null;

// main.js mirrors its startup + backend output here so a boot failure is
// diagnosable even when Playwright doesn't surface the main-process console.
const logPath = path.join(os.tmpdir(), `nexusflow-desktop-e2e-${process.pid}.log`);

function dumpBackendLog(label) {
  try {
    console.log(`\n===== ${label}: ${logPath} =====\n${readFileSync(logPath, 'utf8')}\n=====================================\n`);
  } catch {
    console.log(`\n(no backend log at ${logPath})\n`);
  }
}

test.describe('desktop app', () => {
  /** @type {import('playwright').ElectronApplication} */
  let app;
  /** @type {import('playwright').Page} */
  let window;

  test.beforeAll(async () => {
    const launchEnv = { ...process.env, NEXUSFLOW_DESKTOP_LOG: logPath };
    app = packagedExe
      ? await electron.launch({ executablePath: packagedExe, env: launchEnv })
      : await electron.launch({ args: ['.'], cwd: desktopDir, env: launchEnv });
    try {
      window = await app.firstWindow();
      // The window stays blank until main.js parses the backend port from
      // stdout and calls loadURL.
      await window.waitForURL(/localhost:\d+/, { timeout: 60_000 });
    } catch (e) {
      // Backend never reported a port — surface main.js's log so CI shows why.
      dumpBackendLog('backend boot log (failure)');
      throw e;
    }
  });

  test.afterAll(async () => {
    if (!app) return;
    const proc = app.process();
    // close() can hang if the app doesn't exit cleanly; cap it, then force-kill
    // the whole process tree (the app + its spawned backend server child), so
    // the Playwright worker teardown doesn't time out.
    await Promise.race([
      app.close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 8_000)),
    ]);
    try {
      if (proc?.pid) {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
          proc.kill('SIGKILL');
        }
      }
    } catch { /* already gone */ }
  });

  test('boots the backend and loads the dashboard shell', async () => {
    await expect(window.getByText('NexusFlow', { exact: true }).first()).toBeVisible();

    const port = await window.evaluate(() => window.nexusBridge.getServerPort());
    expect(port).toBeGreaterThan(0);
  });

  test('workspaces page renders with the chat panel', async () => {
    const workspacesNav = window.getByRole('button', { name: 'Workspaces' });
    await expect(workspacesNav).toBeVisible({ timeout: 30_000 });
    await workspacesNav.click();

    await expect(window.getByText('Select a workspace to start chatting.')).toBeVisible({ timeout: 15_000 });
  });
});
