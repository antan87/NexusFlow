/**
 * @module commands/ui
 * Starts the Hono dashboard server (the backend the desktop app embeds).
 * Opening a browser is opt-in via --open.
 */

import chalk from 'chalk';
import { exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as net from 'node:net';
import { startServer } from '../server.js';

function isPortActive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, 'localhost');
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url: string): void {
  let openCmd = '';
  if (process.platform === 'win32') {
    openCmd = `start ${url}`;
  } else if (process.platform === 'darwin') {
    openCmd = `open ${url}`;
  } else {
    openCmd = `xdg-open ${url}`;
  }

  exec(openCmd, (err) => {
    if (err) {
      console.log(chalk.dim(`  Could not auto-open browser. Please visit ${url} manually.`));
    }
  });
}

export async function findAvailablePort(startPort: number, attempts = 100): Promise<number> {
  let p = startPort;
  for (let i = 0; i < attempts; i++) {
    const active = await isPortActive(p);
    if (!active) {
      return p;
    }
    p++;
  }
  throw new Error(`No available port found after ${attempts} attempts (starting at ${startPort})`);
}

/**
 * Starts the local dashboard server. Pass `open: true` to also launch the
 * default browser. `serverOnly` is deprecated (server-only is the default)
 * but still accepted so existing callers keep working.
 *
 * @param options - CLI options, including optional port, daemon, and open.
 */
export async function uiCommand(options: { port?: string; daemon?: boolean; serverOnly?: boolean; strictPort?: boolean; open?: boolean }): Promise<void> {
  const requestedPort = options.port ? parseInt(options.port, 10) : 3000;

  console.log(chalk.bold.cyan('\n🖥️  NexusFlow — Web Dashboard\n'));

  let targetPort = requestedPort;
  const isRequestedPortActive = await isPortActive(requestedPort);

  if (isRequestedPortActive) {
    if (options.strictPort) {
      console.error(chalk.red(`  ✖ Port ${requestedPort} is already in use (strictPort mode).`));
      return;
    }
    targetPort = await findAvailablePort(requestedPort + 1);
    console.log(chalk.yellow(`  ℹ Port ${requestedPort} is currently in use. Selecting next available port: ${chalk.bold(targetPort)}`));
  }

  const url = `http://localhost:${targetPort}`;

  // Handle Daemon mode (runs detached in the background)
  if (options.daemon) {
    console.log(chalk.dim('  Starting server in the background...'));
    try {
      const serverScript = fileURLToPath(new URL('../index.js', import.meta.url));
      const daemonArgs = [serverScript, 'ui', '--port', String(targetPort), '--server-only'];
      if (options.strictPort) daemonArgs.push('--strict-port');
      const child = spawn(process.execPath, daemonArgs, {
        detached: true,
        stdio: 'ignore'
      });
      child.unref();

      const deadline = Date.now() + 10_000;
      let ready = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null && child.exitCode !== undefined) {
          throw new Error(`Backend exited prematurely during startup (code ${child.exitCode})`);
        }
        if (await isPortActive(targetPort)) {
          ready = true;
          break;
        }
        await sleep(200);
      }
      if (!ready) {
        try { child.kill(); } catch {}
        throw new Error(`Backend daemon failed to bind port ${targetPort} within 10s`);
      }

      console.log(chalk.green(`  ✔ Dashboard daemon successfully running on port ${chalk.bold(targetPort)}.`));
      if (options.open) {
        console.log(chalk.dim('  Opening browser...'));
        openBrowser(url);
      } else {
        console.log(chalk.dim(`  Dashboard available at ${url} — use the desktop app or 'nexusflow dashboard' to open it.`));
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`  ✖ Failed to start background daemon: ${msg}`));
      return;
    }
  }

  // Standard foreground blocking mode
  console.log(chalk.dim('  Starting local server...'));
  try {
    const { port: actualPort } = await startServer(targetPort, { strictPort: options.strictPort });
    const actualUrl = `http://localhost:${actualPort}`;

    console.log(chalk.green(`  ✔ Dashboard running at: ${chalk.bold(actualUrl)}`));
    console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

    if (options.open) {
      openBrowser(actualUrl);
    }

    // Keep process alive
    await new Promise(() => {});
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ✖ Failed to start dashboard: ${msg}`));
  }
}


