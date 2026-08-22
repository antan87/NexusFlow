/**
 * @module commands/desktop
 * Launches the NexusFlow Electron desktop app from the workspace `desktop/`
 * project. (The previous Neutralino build was replaced by Electron.)
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';

/**
 * Resolves the repo root directory.
 *
 * The Electron `desktop/` project lives inside this repo:
 *
 *   NexusFlow/            ← repo root
 *     dist/commands/desktop.js   ← this file at runtime
 *     desktop/                   ← Electron desktop app (main.js)
 *
 * This file compiles to `NexusFlow/dist/commands/desktop.js`, so the repo
 * root is two levels up (and `desktop/` sits beside `dist/`).
 */
function resolveRepoRoot(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, '..', '..');
}

function getDesktopDir(): string {
  return path.join(resolveRepoRoot(), 'desktop');
}

/**
 * Launches the NexusFlow Electron desktop app via `npm start` in the desktop
 * project. Spawns detached so the CLI returns while the app keeps running.
 */
export async function desktopCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n🖥️  NexusFlow — Desktop App\n'));

  const desktopDir = getDesktopDir();

  if (!existsSync(path.join(desktopDir, 'main.js'))) {
    console.log(chalk.yellow('Desktop app not found at:'));
    console.log(chalk.dim(`  ${desktopDir}\n`));
    console.log(chalk.white('The Electron app lives in the workspace `desktop/` folder. From a source checkout:\n'));
    console.log(chalk.green('  cd desktop && npm install && npm start\n'));
    return;
  }

  if (!existsSync(path.join(desktopDir, 'node_modules'))) {
    console.log(chalk.yellow('Desktop dependencies are not installed.\n'));
    console.log(chalk.white('Install them first:\n'));
    console.log(chalk.green('  cd desktop && npm install\n'));
    return;
  }

  console.log(chalk.dim('Launching the desktop app…'));

  // The Electron app spawns the backend from ../dist, so the CLI must be built.
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmCmd, ['start'], {
    cwd: desktopDir,
    detached: true,
    stdio: 'ignore',
    shell: false,
  });

  child.on('error', (err) => {
    console.error(chalk.red(`  ✖ Failed to launch desktop app: ${err.message}`));
  });

  child.unref();

  console.log(chalk.green('Desktop app launched.\n'));
  console.log(chalk.dim('(Ensure the CLI is built — `npm run build` — so the app can start its backend.)\n'));
}
