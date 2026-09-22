// Stages the NexusFlow backend for packaging: builds the CLI, copies dist/ and
// the package manifests into desktop/backend/, and installs production-only
// dependencies there. electron-builder then ships desktop/backend as an
// extraResource, and main.js runs backend/dist/desktop-server.js via Electron-as-Node.
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, cpSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..');
const backendDir = path.join(desktopDir, 'backend');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit', shell: true });

console.log('[prepare-backend] building the CLI…');
run('npm run build', repoRoot);

if (!existsSync(path.join(repoRoot, 'dist', 'index.js'))) {
  throw new Error('Build did not produce dist/index.js');
}

console.log('[prepare-backend] staging backend/…');
rmSync(backendDir, { recursive: true, force: true });
mkdirSync(backendDir, { recursive: true });
cpSync(path.join(repoRoot, 'dist'), path.join(backendDir, 'dist'), { recursive: true });
copyFileSync(path.join(repoRoot, 'package.json'), path.join(backendDir, 'package.json'));
const lock = path.join(repoRoot, 'package-lock.json');
if (existsSync(lock)) copyFileSync(lock, path.join(backendDir, 'package-lock.json'));

console.log('[prepare-backend] installing production dependencies…');
run(existsSync(path.join(backendDir, 'package-lock.json')) ? 'npm ci --omit=dev' : 'npm install --omit=dev', backendDir);

// npm's node-pty@1.1.0 Darwin prebuilds contain spawn-helper with mode 0644.
// Repair the staged copy before electron-builder snapshots it into Resources.
if (process.platform === 'darwin') {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  for (const relative of [
    path.join('build', 'Release', 'spawn-helper'),
    path.join('build', 'Debug', 'spawn-helper'),
    path.join('prebuilds', `darwin-${arch}`, 'spawn-helper'),
  ]) {
    const helper = path.join(backendDir, 'node_modules', 'node-pty', relative);
    if (existsSync(helper) && statSync(helper).isFile()) chmodSync(helper, statSync(helper).mode | 0o111);
  }
}

// Guard: fail loudly if the production install didn't actually stage its deps.
// A silently empty node_modules would package into an app whose backend can't
// start (ERR_MODULE_NOT_FOUND at launch) — catch it here, at build time.
// node-pty is optional for CLI installs; desktop distributions require it.
if (!existsSync(path.join(backendDir, 'node_modules', 'node-pty', 'package.json'))) {
  throw new Error('Native terminal dependency is missing from the staged backend. Install the platform build prerequisites and retry.');
}

const sentinel = path.join(backendDir, 'node_modules', 'hono', 'package.json');
if (!existsSync(sentinel)) {
  throw new Error(
    `[prepare-backend] runtime dependencies missing after install (expected ${sentinel}). ` +
      'The bundled backend would fail to start — aborting.',
  );
}

console.log('[prepare-backend] done.');
