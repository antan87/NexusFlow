import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_READY_TIMEOUT_MS = 20000;

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
    <p>The desktop app launches the backend from <code>../dist/index.js</code> using
    <code>node</code> on your PATH. Ensure the project is built (<code>npm run build</code>
    at the repo root) and Node is installed.</p>`;
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
  let backendCmd;
  let backendArgs;
  let backendEnv = { ...process.env };
  if (app.isPackaged) {
    const backendPath = path.join(process.resourcesPath, 'backend', 'dist', 'index.js');
    backendCmd = process.execPath;
    backendArgs = [backendPath, 'ui', '--port=0'];
    backendEnv.ELECTRON_RUN_AS_NODE = '1';
  } else {
    backendCmd = 'node';
    backendArgs = [path.join(__dirname, '../dist/index.js'), 'ui', '--port=0'];
  }

  backendProcess = spawn(backendCmd, backendArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: backendEnv
  });

  // Surface a spawn failure (node missing, backend path absent in a packaged
  // build) as a readable page instead of a permanently blank window.
  backendProcess.on('error', (err) => {
    console.error('[Backend] failed to spawn:', err);
    if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
    showBackendError(`Failed to launch the backend process: ${err.message}`);
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
    console.log(`[Backend] ${output}`);

    // Look for a log like "Dashboard is already active at: http://localhost:PORT"
    const match = output.match(/http:\/\/localhost:(\d+)/);
    if (match && !assignedPort) {
      assignedPort = parseInt(match[1], 10);
      if (readyTimer) { clearTimeout(readyTimer); readyTimer = null; }
      console.log(`[Electron] Backend detected on port ${assignedPort}`);
      mainWindow.loadURL(`http://localhost:${assignedPort}`);

      mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Browser Console] ${message}`);
      });
    }
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error] ${data}`);
  });

  // Expose the port to the frontend via IPC
  ipcMain.handle('get-server-port', () => assignedPort);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (readyTimer) clearTimeout(readyTimer);
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
