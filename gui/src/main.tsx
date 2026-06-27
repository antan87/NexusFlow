import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

declare global {
  interface Window {
    Neutralino?: any;
  }
}

if (typeof window !== 'undefined' && window.Neutralino) {
  window.Neutralino.init();
  window.Neutralino.events.on('windowClose', () => {
    window.Neutralino.app.exit();
  });

  (async () => {
    try {
      const res = await fetch('http://localhost:3000/api/config');
      if (res.ok) {
        console.log('NexusFlow Hono backend is already running.');
        return;
      }
    } catch {
      console.log('NexusFlow Hono backend not detected. Launching...');
      try {
        await window.Neutralino.os.execCommand('node ../NexusFlow/dist/index.js ui --server-only --port 3000', { background: true });
        console.log('Hono backend successfully spawned.');
      } catch (err) {
        console.error('Failed to spawn Hono backend:', err);
      }
    }
  })();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
