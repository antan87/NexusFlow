import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare global {
  interface Window {
    Neutralino?: any;
    NL_PATH?: string;
  }
}

async function waitForBackend(url: string, maxRetries = 25, delay = 200): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        console.log(`Backend connection established on attempt ${i + 1}`);
        return true;
      }
    } catch {
      // Ignored, retry
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  console.warn(`Backend connection timed out after ${maxRetries} attempts`);
  return false;
}

function renderApp() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (typeof window !== 'undefined' && window.Neutralino) {
  window.Neutralino.init();
  window.Neutralino.events.on('windowClose', () => {
    window.Neutralino.app.exit();
  });

  (async () => {
    // The desktop owns its backend, so it pins a fixed port and starts the
    // server with --strict-port (no silent auto-increment it couldn't find).
    const BACKEND_PORT = 3000;
    const backendUrl = `http://localhost:${BACKEND_PORT}/api/config`;

    // Only treat the port as "already ours" if it responds like NexusFlow —
    // an unrelated service answering on the port must not suppress launch.
    async function isNexusFlowBackend(): Promise<boolean> {
      try {
        const res = await fetch(backendUrl);
        if (!res.ok) return false;
        const data = await res.json();
        return data && typeof data === 'object' && 'config' in data;
      } catch {
        return false;
      }
    }

    try {
      if (await isNexusFlowBackend()) {
        console.log('NexusFlow Hono backend is already running.');
        return;
      }

      console.log('NexusFlow Hono backend not detected. Launching...');
      const isWin = navigator.platform.includes('Win') || navigator.userAgent.includes('Windows');
      const nlPath = window.NL_PATH || '.';

      // Construct paths for packaged mode
      const nodeBinary = isWin ? `${nlPath}/node/node.exe` : `${nlPath}/node/bin/node`;
      const serverScript = `${nlPath}/server/dist/index.js`;

      // Check if we are running in packaged mode by testing if the embedded node exists
      let isPackaged = false;
      try {
        await window.Neutralino.filesystem.getStats(nodeBinary);
        isPackaged = true;
      } catch {
        // File doesn't exist or filesystem API failed, meaning dev mode
      }

      const serverArgs = `ui --server-only --strict-port --port ${BACKEND_PORT}`;
      let cmd: string;
      if (isPackaged) {
        console.log('Running in packaged mode, using embedded node and server...');
        cmd = `"${nodeBinary}" "${serverScript}" ${serverArgs}`;
      } else {
        console.log('Running in development mode, using global node and relative path...');
        cmd = `node ../NexusFlow/dist/index.js ${serverArgs}`;
      }

      console.log('Spawning backend command:', cmd);
      await window.Neutralino.os.execCommand(cmd, { background: true });
      console.log(`Hono backend successfully spawned. Waiting for port ${BACKEND_PORT}...`);
      await waitForBackend(backendUrl);
    } catch (err) {
      console.error('Failed to spawn Hono backend:', err);
    } finally {
      renderApp();
    }
  })();
} else {
  renderApp();
}
