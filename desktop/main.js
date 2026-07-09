import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let backendProcess;
let assignedPort = 0;

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

  // Start the NexusFlow backend server dynamically on port 0 (OS assigns port)
  const backendPath = path.join(__dirname, '../dist/index.js');
  
  backendProcess = spawn('node', [backendPath, 'ui', '--port=0'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Parse the assigned port from stdout
  backendProcess.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`[Backend] ${output}`);
    
    // Look for a log like "Dashboard is already active at: http://localhost:PORT"
    const match = output.match(/http:\/\/localhost:(\d+)/);
    if (match && !assignedPort) {
      assignedPort = parseInt(match[1], 10);
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
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
