import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, spawnSync } from 'child_process';
import { existsSync, createWriteStream } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_READY_TIMEOUT_MS = 20000;

// Reliable diagnostics: Playwright doesn't consistently surface the Electron
// main-process console, so mirror startup + backend output to a log file
// (overridable via NEXUSFLOW_DESKTOP_LOG) as well as stderr.
const LOG_PATH = process.env.NEXUSFLOW_DESKTOP_LOG || path.join(os.tmpdir(), 'nexusflow-desktop.log');
let logStream;
try { logStream = createWriteStream(LOG_PATH, { flags: 'w' }); } catch { logStream = null; }
function diag(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  try { logStream?.write(line); } catch { /* ignore */ }
  try { process.stderr.write(`[nf] ${line}`); } catch { /* ignore */ }
}

let mainWindow;
let backendProcess;
let assignedPort = 0;
let readyTimer = null;
// True once we are deliberately tearing the app down (window closed / before-quit),
// so the backend 'exit' handler can tell our own kill apart from the backend
// exiting on its own (e.g. the update hand-off, below).
let appQuitting = false;

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showBackendError(detail) {
  if (!mainWindow) return;
  const html = `<!doctype html><meta charset="utf-8">
    <style>body{font:14px system-ui;background:#1e1e1e;color:#ddd;padding:40px;line-height:1.6}
    code{background:#333;padding:2px 6px;border-radius:4px}</style>
    <h2>NexusFlow could not start its backend</h2>
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
    if (url.startsWith('data:')) return;
    if (assignedPort && !url.startsWith(`http://localhost:${assignedPort}`)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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
    if (code === 0) {
      // The backend only exits(0) on its own to hand off to the update
      // installer (POST /api/updates/apply). That installer must overwrite the
      // running NexusFlow.exe, so the app has to fully quit to release the file
      // lock — otherwise the silent (/S) install stalls against the locked
      // binary and the update never applies. electron-builder relaunches the
      // app after install.
      diag('backend exited cleanly — quitting app so the update installer can replace the exe');
      app.quit();
    } else {
      // Unexpected death: surface it instead of leaving a dead, disconnected window.
      showBackendError(`The backend process stopped unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`);
    }
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

    // Match only our explicit ready token — never arbitrary URLs in output.
    const match = output.match(/NEXUSFLOW_READY_PORT=(\d+)/);
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
  ipcMain.handle('get-server-port', () => assignedPort);
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

app.whenReady().then(createWindow);

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  stopBackend();
  // exit(0) terminates immediately (no lingering handles / graceful-close
  // wait), so Playwright's app.close() resolves and teardown doesn't hang.
  if (process.platform !== 'darwin') app.exit(0);
});
