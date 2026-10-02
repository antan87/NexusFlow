/**
 * Starts the real ContextSpace backend (dist/desktop-server.js, the entry the
 * desktop app embeds) against a perf fixture and serves the production GUI.
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureEnv } from './env.mjs';
import { assertFixtureHome } from './fixtures.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const READY = /(?:CONTEXTSPACE|NEXUSFLOW)_READY_PORT=(\d+)/;

export async function startBackend({ home, counters = true, timeoutMs = 60_000, nodeArgs = [], env = {} }) {
  const fixture = assertFixtureHome(home);
  const entry = path.join(REPO_ROOT, 'dist', 'desktop-server.js');
  const started = performance.now();
  const child = spawn(process.execPath, [...nodeArgs, entry], {
    cwd: REPO_ROOT,
    env: fixtureEnv(home, { ...(counters ? { CONTEXTSPACE_PERF_COUNTERS: '1' } : {}), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Backend did not report a port within ${timeoutMs} ms.\n${stderr}`)), timeoutMs);
    child.stdout.on('data', (d) => {
      const match = String(d).match(READY);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Backend exited with code ${code}.\n${stderr}`)); });
  });
  const readyMs = performance.now() - started;
  // `localhost` matches the host guard and the origin the desktop app uses.
  const base = `http://localhost:${port}`;

  const json = async (p, init) => {
    const response = await fetch(base + p, init);
    if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${p} → ${response.status}`);
    return response.json();
  };

  return {
    port,
    base,
    fixture,
    pid: child.pid,
    readyMs,
    json,
    /** Work counters since the last reset (requires counters: true). */
    counters: (reset = false) => json(`/api/perf/counters${reset ? '?reset=1' : ''}`),
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      await new Promise((resolve) => {
        const force = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5_000);
        child.once('exit', () => { clearTimeout(force); resolve(); });
      });
    },
  };
}
