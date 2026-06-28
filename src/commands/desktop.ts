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
 * Resolves the workspace root directory.
 *
 * Assumes the standard NexusFlow workspace layout where the `desktop/`
 * project is a sibling of the `NexusFlow/` project under the same
 * workspace root:
 *
 *   <workspace-root>/
 *     NexusFlow/          ← this CLI project
 *     desktop/            ← Neutralinojs desktop app
 *       dist/nexusflow-desktop/<platform-binary>
 *
 * At runtime this file is compiled to `NexusFlow/dist/commands/desktop.js`,
 * so the workspace root is three levels up.
 */
function resolveWorkspaceRoot(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..', '..');
}

/**
 * Returns the desktop dist directory path.
 */
function getDesktopDistDir(): string {
  return path.join(resolveWorkspaceRoot(), 'desktop', 'dist', 'nexusflow-desktop');
}

/**
 * Resolves the platform-specific binary path for the desktop app.
 *
 * On macOS the architecture is taken into account:
 * - arm64 → `nexusflow-desktop-mac_arm64`
 * - x64   → prefers `nexusflow-desktop-mac_x64`, falls back to universal
 */
function findDesktopBinary(): string | null {
  const desktopDistDir = getDesktopDistDir();
  const platform = process.platform;
  const arch = process.arch;
  let binaryName: string;

  if (platform === 'win32') {
    binaryName = 'nexusflow-desktop-win_x64.exe';
  } else if (platform === 'darwin') {
    if (arch === 'arm64') {
      binaryName = 'nexusflow-desktop-mac_arm64';
    } else {
      // Prefer smaller x64 binary, fall back to universal
      const x64Path = path.join(desktopDistDir, 'nexusflow-desktop-mac_x64');
      binaryName = existsSync(x64Path) ? 'nexusflow-desktop-mac_x64' : 'nexusflow-desktop-mac_universal';
    }
  } else {
    // Linux — detect ARM architectures
    if (arch === 'arm64') {
      binaryName = 'nexusflow-desktop-linux_arm64';
    } else if (arch === 'arm') {
      binaryName = 'nexusflow-desktop-linux_armhf';
    } else {
      binaryName = 'nexusflow-desktop-linux_x64';
    }
  }

  const fullPath = path.join(desktopDistDir, binaryName);
  return existsSync(fullPath) ? fullPath : null;
}

/**
 * Returns the expected binary path for display in the "not found" message.
 */
function getExpectedBinaryPath(): string {
  const desktopDistDir = getDesktopDistDir();
  switch (process.platform) {
    case 'win32':
      return path.join(desktopDistDir, 'nexusflow-desktop-win_x64.exe');
    case 'darwin':
      return path.join(desktopDistDir, 'nexusflow-desktop-mac_*');
    case 'linux':
    default:
      return path.join(desktopDistDir, 'nexusflow-desktop-linux_x64');
  }
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
    const expectedPath = getExpectedBinaryPath();
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
    cwd: path.dirname(binaryPath), // Required: Neutralino looks for resources.neu in cwd
  });

  child.on('error', (err) => {
    console.error(chalk.red(`  ✖ Desktop app process error: ${err.message}`));
  });

  child.unref();

  console.log(chalk.green('Desktop app launched successfully.\n'));
}
