/**
 * @module commands/desktop
 * Launches the NexusFlow desktop application (Neutralinojs).
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

/**
 * Returns the platform-specific binary name for the desktop app.
 */
function getDesktopBinaryName(): string {
  switch (process.platform) {
    case 'win32':
      return 'nexusflow-desktop-win_x64.exe';
    case 'darwin':
      // Prefer universal binary, fall back to arm64
      return 'nexusflow-desktop-mac_universal';
    case 'linux':
      return 'nexusflow-desktop-linux_x64';
    default:
      return 'nexusflow-desktop-linux_x64';
  }
}

/**
 * Resolves the absolute path to the desktop app binary.
 *
 * The binary lives at `<workspace-root>/desktop/dist/nexusflow-desktop/<binary>`.
 * The workspace root is two levels up from this file's compiled location
 * (`dist/commands/desktop.js` → `dist/` → `NexusFlow/` → workspace root).
 */
function resolveDesktopBinaryPath(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  // thisDir = <NexusFlow>/dist/commands  →  go up to <NexusFlow>, then up to workspace root
  const workspaceRoot = path.resolve(thisDir, '..', '..', '..');
  const binaryName = getDesktopBinaryName();
  return path.join(workspaceRoot, 'desktop', 'dist', 'nexusflow-desktop', binaryName);
}

/**
 * On macOS the universal binary might not exist; try the arm64 fallback.
 */
function findDesktopBinary(): string | null {
  const primary = resolveDesktopBinaryPath();
  if (existsSync(primary)) return primary;

  // macOS fallback: try arm64 if universal is missing
  if (process.platform === 'darwin') {
    const fallback = primary.replace('nexusflow-desktop-mac_universal', 'nexusflow-desktop-mac_arm64');
    if (existsSync(fallback)) return fallback;
  }

  return null;
}

/**
 * Launches the NexusFlow desktop application.
 *
 * Spawns the process detached and unrefs it so the CLI exits immediately
 * while the desktop app keeps running.
 */
export async function desktopCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🖥️  NexusFlow — Desktop App\n'));

  const binaryPath = findDesktopBinary();

  if (!binaryPath) {
    const expectedPath = resolveDesktopBinaryPath();
    console.log(chalk.yellow('Desktop binary not found at:'));
    console.log(chalk.dim(`  ${expectedPath}\n`));
    console.log(chalk.white('To build it, run:\n'));
    console.log(chalk.green('  cd desktop && npm install && npm run build\n'));
    return;
  }

  console.log(chalk.dim(`Launching ${path.basename(binaryPath)}…`));

  const child = spawn(binaryPath, [], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  console.log(chalk.green('Desktop app launched successfully.\n'));
}
