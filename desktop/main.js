import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn, spawnSync } from 'child_process';
import { existsSync, statSync, createWriteStream } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import updaterPackage from 'electron-updater';
import { isExactLocalOrigin, isTrustedIpcEvent } from './lib/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { autoUpdater } = updaterPackage;

const UPDATE_EVENT = 'update:event';
const SUPPORTED_UPDATE_PLATFORMS = new Set(['win32', 'linux']);

const BACKEND_READY_TIMEOUT_MS = 20000;

// Reliable diagnostics: Playwright doesn't consistently surface the Electron
// main-process console, so mirror startup + backend output to a log file
// (overridable via NEXUSFLOW_DESKTOP_LOG) as well as stderr.
const LOG_PATH = process.env.CONTEXTSPACE_DESKTOP_LOG || process.env.NEXUSFLOW_DESKTOP_LOG || path.join(os.tmpdir(), 'contextspace-desktop.log');
let logStream;
try { logStream = createWriteStream(LOG_PATH, { flags: 'w' }); } catch { logStream = null; }
function diag(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { logStream?.write(line); } catch { /* ignore */ }
  try { process.stderr.write(`[cs] ${line}`); } catch { /* ignore */ }
}

let mainWindow;
let backendProcess;
let assignedPort = 0;
let readyTimer = null;
// True once we are deliberately tearing the app down (window closed / before-quit),
// so the backend 'exit' handler can tell our own kill apart from an unexpected
// backend exit.
let appQuitting = false;

/**
 * Keep updater state in the main process. Renderer code receives this small,
 * serializable projection rather than an electron-updater object, which can
 * contain functions and internal request details.
 */
let updateState = {
  supported: false,
  status: 'unsupported',
  currentVersion: app.getVersion(),
  version: null,
  releaseNotes: null,
  progress: 0,
  error: null,
};

function isSupportedUpdatePlatform() {
  if (!app.isPackaged || !SUPPORTED_UPDATE_PLATFORMS.has(process.platform)) return false;
  // electron-updater's Linux target is AppImage. An unpacked
  // linux-unpacked executable can boot for CI, but it has no updater-backed
  // installation location; only an actual absolute APPIMAGE is supported.
  if (process.platform === 'linux') {
    const appImage = process.env.APPIMAGE || '';
    try {
      return path.isAbsolute(appImage) && existsSync(appImage) && statSync(appImage).isFile();
    } catch {
      return false;
    }
  }
  return true;
}

function updateProjection() {
  return { ...updateState };
}

function assertTrustedIpcEvent(event) {
  if (!isTrustedIpcEvent(event, mainWindow, assignedPort)) {
    throw new Error('Untrusted renderer IPC sender.');
  }
}

function publishUpdateEvent(status, patch = {}) {
  updateState = {
    ...updateState,
    ...patch,
    status,
    currentVersion: app.getVersion(),
  };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UPDATE_EVENT, updateProjection());
  }
}

function updateInfoProjection(info) {
  if (!info) return {};
  return {
    version: typeof info.version === 'string' ? info.version : null,
    releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
  };
}

function isAllowedReleaseLink(candidate) {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) {
      return false;
    }
    if (url.pathname === '/antan87/NexusFlow/releases/latest') return true;
    return /^\/antan87\/NexusFlow\/releases\/tag\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(url.pathname);
  } catch {
    return false;
  }
}

function setUpdaterError(error) {
  const message = error instanceof Error ? error.message : String(error);
  publishUpdateEvent('error', { error: message, progress: 0 });
  return updateProjection();
}

function registerUpdateIpc() {
  // These handlers are registered even in development/unsupported builds so
  // the renderer gets a structured `supported: false` response instead of an
  // unhandled IPC rejection. Every operation remains guarded in the main
  // process; no renderer-controlled URL/command is accepted.
  ipcMain.handle('update:get-status', (event) => {
    assertTrustedIpcEvent(event);
    return updateProjection();
  });
  ipcMain.handle('update:check', async (event) => {
    assertTrustedIpcEvent(event);
    // A check must not replace an in-progress download or a downloaded update;
    // doing so would make the GUI lose its restart/install action. A failed
    // download remains retryable through update:download below.
    if (!isSupportedUpdatePlatform() || updateState.status === 'downloading' || updateState.status === 'downloaded') {
      return updateProjection();
    }
    try {
      await autoUpdater.checkForUpdates();
      return updateProjection();
    } catch (error) {
      return setUpdaterError(error);
    }
  });
  ipcMain.handle('update:download', async (event) => {
    assertTrustedIpcEvent(event);
    // A failed transfer keeps the verified release version in state, so the
    // user can retry without another forced check. Never retry an error that
    // did not identify a concrete update version.
    const retryable = updateState.status === 'available'
      || (updateState.status === 'error' && Boolean(updateState.version));
    if (!isSupportedUpdatePlatform() || !retryable) return updateProjection();
    try {
      publishUpdateEvent('downloading', { progress: 0, error: null });
      await autoUpdater.downloadUpdate();
      return updateProjection();
    } catch (error) {
      return setUpdaterError(error);
    }
  });
  ipcMain.handle('update:restart', (event) => {
    assertTrustedIpcEvent(event);
    if (!isSupportedUpdatePlatform() || updateState.status !== 'downloaded') return updateProjection();
    // electron-updater closes the app, swaps the installed files, and relaunches
    // it. The backend is stopped by before-quit, releasing all file locks first.
    autoUpdater.quitAndInstall(false, true);
    return updateProjection();
  });
}

/**
 * Wire electron-updater once, and only for packaged Windows/Linux builds.
 * Development and browser mode intentionally have no native installer API.
 */
function configureAutoUpdater() {
  registerUpdateIpc();
  if (!isSupportedUpdatePlatform()) {
    updateState = {
      ...updateState,
      supported: false,
      status: 'unsupported',
      error: null,
    };
    return;
  }

  updateState = { ...updateState, supported: true, status: 'idle', error: null };
  // Updates are opt-in from the GUI. In particular, never download or install
  // an update just because the app was opened or quit.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => publishUpdateEvent('checking', {
    // Do not let a failed metadata check inherit an older version and become a
    // false download retry. A newly emitted update-available event fills this
    // back in when a release is actually found.
    version: null,
    releaseNotes: null,
    progress: 0,
    error: null,
  }));
  autoUpdater.on('update-available', (info) => publishUpdateEvent('available', {
    ...updateInfoProjection(info),
    progress: 0,
    error: null,
  }));
  autoUpdater.on('update-not-available', (info) => publishUpdateEvent('not-available', {
    ...updateInfoProjection(info),
    progress: 0,
    error: null,
  }));
  autoUpdater.on('download-progress', (progress) => publishUpdateEvent('downloading', {
    progress: Number.isFinite(progress?.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0,
    error: null,
  }));
  autoUpdater.on('update-downloaded', (info) => publishUpdateEvent('downloaded', {
    ...updateInfoProjection(info),
    progress: 100,
    error: null,
  }));
  autoUpdater.on('error', (error) => setUpdaterError(error));

  // Checking is non-blocking and never downloads. The user still chooses when
  // to download/install from the GUI.
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => setUpdaterError(error));
  }, 1500);
}

import { escapeHtml } from './lib/html.js';

function showBackendError(detail) {
  if (!mainWindow) return;
  const html = `<!doctype html><meta charset="utf-8">
    <style>body{font:14px system-ui;background:#1e1e1e;color:#ddd;padding:40px;line-height:1.6}
    code{background:#333;padding:2px 6px;border-radius:4px}</style>
    <h2>ContextSpace could not start its backend</h2>
    <p>${escapeHtml(detail)}</p>
    <p>In development the backend is run from <code>../dist</code> with <code>node</code>;
    a packaged build runs the bundled backend under <code>resources/backend</code>. If this
    persists, rebuild (<code>npm run build</code>) and relaunch.</p>`;
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // User-initiated navigation may stay on the exact dashboard origin only.
    // A localhost port prefix, userinfo URL, or data: page is not trusted.
    if (!isExactLocalOrigin(url, assignedPort)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // The browser dashboard can link to the release page. In the desktop app,
    // open only that fixed HTTPS destination outside the renderer.
    if (isAllowedReleaseLink(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Start the NexusFlow backend server dynamically on port 0 (OS assigns port).
  // Dev: run ../dist with node on PATH. Packaged: run the backend bundled under
  // resources/backend using Electron's own binary as Node (ELECTRON_RUN_AS_NODE),
  // so no separate Node runtime has to ship.
  // Don't leak the launcher's Node debug/inspector options into the backend
  // child (Playwright/CI can set these; an inherited --inspect-brk would make
  // the child hang before it ever binds a port).
  let backendEnv = { ...process.env };
  delete backendEnv.NODE_OPTIONS;
  delete backendEnv.ELECTRON_RUN_AS_NODE;

  if (process.platform === 'darwin') {
    const home = process.env.HOME || '';
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')];
    const currentPaths = (backendEnv.PATH || '').split(':');
    backendEnv.PATH = [...new Set([...extraPaths, ...currentPaths])].filter(Boolean).join(':');
  }

  // Run the minimal server entry (dist/desktop-server.js), not the full CLI —
  // the CLI pulls in commander/pm2/inquirer, and under Electron-as-Node its
  // commander import can resolve to pm2's ancient nested copy and crash.
  let backendCmd;
  let backendArgs;
  if (app.isPackaged) {
    const backendPath = path.join(process.resourcesPath, 'backend', 'dist', 'desktop-server.js');
    backendCmd = process.execPath;
    backendArgs = [backendPath];
    backendEnv.ELECTRON_RUN_AS_NODE = '1';
    diag(`packaged backend: ${backendPath} (exists=${existsSync(backendPath)})`);
    if (!existsSync(backendPath)) {
      showBackendError(`Bundled backend not found at ${backendPath}.`);
      return;
    }
  } else {
    backendCmd = 'node';
    backendArgs = [path.join(__dirname, '../dist/desktop-server.js')];
  }
  diag(`isPackaged=${app.isPackaged} execPath=${process.execPath}`);
  diag(`spawning: ${backendCmd} ${backendArgs.join(' ')}`);

  backendProcess = spawn(backendCmd, backendArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: backendEnv
  });

  // Surface a spawn failure (node missing, backend path absent in a packaged
  // build) as a readable page instead of a permanently blank window.
  backendProcess.on('error', (err) => {
    diag(`backend failed to spawn: ${err.message}`);
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    showBackendError(`Failed to launch the backend process: ${err.message}`);
  });

  backendProcess.on('exit', (code, signal) => {
    diag(`backend exited code=${code} signal=${signal} (port ${assignedPort || 'not yet detected'})`);
    // We killed it ourselves during shutdown — nothing to do.
    if (appQuitting) return;
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    // A backend exit is always unexpected now: native update installation is
    // owned by Electron, not an HTTP endpoint in the backend process.
    showBackendError(`The backend process stopped unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`);
  });

  // If the backend never reports a port, tell the user rather than hang.
  readyTimer = setTimeout(() => {
    if (!assignedPort) {
      showBackendError('The backend did not report a ready port in time.');
    }
  }, BACKEND_READY_TIMEOUT_MS);

  // Parse the assigned port from stdout
  backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    diag(`[backend:out] ${output.trimEnd()}`);

    // Match explicit ready token
    const match = output.match(/(?:CONTEXTSPACE|NEXUSFLOW)_READY_PORT=(\d+)/);
    if (match && !assignedPort) {
      assignedPort = parseInt(match[1], 10);
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      diag(`backend ready on port ${assignedPort}`);
      mainWindow.loadURL(`http://localhost:${assignedPort}`);

      // Electron >= 37 passes a single event object (message on the event);
      // older versions passed positional args. Support both.
      mainWindow.webContents.on('console-message', (event, _level, message) => {
        console.log(`[Browser Console] ${event?.message ?? message ?? ''}`);
      });
    }
  });

  backendProcess.stderr.on('data', (data) => {
    diag(`[backend:err] ${data.toString().trimEnd()}`);
  });

  // Expose the port to the frontend via IPC
  ipcMain.handle('get-server-port', (event) => {
    assertTrustedIpcEvent(event);
    return assignedPort;
  });
}

// Kill the backend and its whole tree — the child is a listening server that
// won't die from a plain kill on Windows, which otherwise keeps the app (and
// CI teardown) hanging. Synchronous so it completes before the app exits.
function stopBackend() {
  appQuitting = true;
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
  const child = backendProcess;
  backendProcess = null;
  if (child && !child.killed && child.exitCode === null && child.pid) {
    if (process.platform === 'win32') {
      try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    } else {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }
  }
  // Release the log file handle so it can't keep the event loop alive.
  try { logStream?.end(); logStream = null; } catch { /* ignore */ }
}

app.whenReady().then(() => {
  configureAutoUpdater();
  createWindow();
});

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  stopBackend();
  // exit(0) terminates immediately (no lingering handles / graceful-close
  // wait), so Playwright's app.close() resolves and teardown doesn't hang.
  if (process.platform !== 'darwin') app.exit(0);
});
