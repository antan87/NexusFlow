/**
 * Launches the desktop app on a perf fixture through Playwright's Electron
 * support, the same way desktop/e2e/app.spec.js does.
 *
 * `packaged` runs desktop/dist/linux-unpacked (build it with
 * `npm run pack --prefix desktop`); otherwise Electron runs desktop/main.js,
 * which starts the backend from dist/ with system Node.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { REPO_ROOT } from './backend.mjs';
import { fixtureEnv } from './env.mjs';
import { assertFixtureHome } from './fixtures.mjs';
import { loadPlaywright } from './playwright.mjs';
import { findDescendant } from './system.mjs';

const DESKTOP_DIR = path.join(REPO_ROOT, 'desktop');

export function packagedExecutable() {
  const candidates = {
    linux: path.join(DESKTOP_DIR, 'dist', 'linux-unpacked', 'contextspace-desktop'),
    win32: path.join(DESKTOP_DIR, 'dist', 'win-unpacked', 'ContextSpace.exe'),
    darwin: path.join(DESKTOP_DIR, 'dist', 'mac', 'ContextSpace.app', 'Contents', 'MacOS', 'ContextSpace'),
  };
  return candidates[process.platform];
}

/** Reads `<ISO time> message` lines written by main.js diag(). */
export function readDesktopLog(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    const space = line.indexOf(' ');
    return { at: Date.parse(line.slice(0, space)), message: line.slice(space + 1) };
  });
}

/**
 * Starts the app. `headless` uses Chromium's headless Ozone backend so runs do
 * not open windows on the developer's screen; compositing then differs from a
 * real display, which the report records.
 */
export async function launchDesktop({ home, packaged = true, headless = true, logDir }) {
  assertFixtureHome(home);
  const { _electron: electron } = loadPlaywright('desktop');
  await fs.mkdir(logDir, { recursive: true });
  const logFile = path.join(logDir, `desktop-${Date.now()}.log`);
  const env = fixtureEnv(home, {
    CONTEXTSPACE_PERF_COUNTERS: '1',
    CONTEXTSPACE_DESKTOP_LOG: logFile,
    NEXUSFLOW_DESKTOP_LOG: logFile,
  });
  // The Chromium sandbox helper is not setuid-root in unpacked builds.
  const flags = ['--no-sandbox', ...(headless ? ['--ozone-platform=headless'] : [])];
  const executable = packaged ? packagedExecutable() : null;
  if (packaged && !existsSync(executable)) {
    throw new Error(`Packaged app not found at ${executable}. Run \`npm run pack --prefix desktop\`, or pass --unpacked.`);
  }

  const launchedAt = Date.now();
  const app = packaged
    ? await electron.launch({ executablePath: executable, args: flags, env })
    : await electron.launch({ args: [...flags, '.'], cwd: DESKTOP_DIR, env });
  const window = await app.firstWindow();
  await window.waitForURL(/localhost:\d+/, { timeout: 90_000 });
  const base = new URL(window.url()).origin;
  const electronPid = app.process().pid;
  const backendPid = findDescendant(electronPid, /desktop-server\.js/);

  const json = async (p) => {
    const response = await fetch(base + p);
    if (!response.ok) throw new Error(`GET ${p} → ${response.status}`);
    return response.json();
  };

  return {
    app, window, base, launchedAt, logFile, electronPid, backendPid, json,
    counters: (reset = false) => json(`/api/perf/counters${reset ? '?reset=1' : ''}`),
    log: () => readDesktopLog(logFile),
    versions: () => app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node })),
    async close() {
      await Promise.race([app.close(), new Promise((r) => setTimeout(r, 10_000))]);
      try { process.kill(electronPid, 'SIGKILL'); } catch { /* already gone */ }
      if (backendPid) try { process.kill(backendPid, 'SIGKILL'); } catch { /* already gone */ }
    },
  };
}
