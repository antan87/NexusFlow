import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
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

function showBackendError(detail) {
  if (!mainWindow) return;
  const html = `<!doctype html><meta charset="utf-8">
    <style>body{font:14px system-ui;background:#1e1e1e;color:#ddd;padding:40px;line-height:1.6}
    code{background:#333;padding:2px 6px;border-radius:4px}</style>
    <h2>NexusFlow could not start its backend</h2>
    <p>${detail}</p>
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
      contextIsolation: true
    }
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

    // Look for a log like "Dashboard is already active at: http://localhost:PORT"
    const match = output.match(/http:\/\/localhost:(\d+)/);
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
// CI teardown) hanging.
function stopBackend() {
  if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
  const child = backendProcess;
  backendProcess = null;
  if (!child || child.killed || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
  } else {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
  }
}

app.whenReady().then(createWindow);

app.on('before-quit', stopBackend);

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') app.quit();
});
