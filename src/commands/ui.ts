/**
 * @module commands/ui
 * Starts the Hono web server and opens the browser to the NexusFlow GUI.
 */

import chalk from 'chalk';
import { exec } from 'node:child_process';
import { startServer } from '../server.js';

/**
 * Starts the local GUI server and opens the dashboard in the default browser.
 *
 * @param options - CLI options, including optional port.
 */
export async function uiCommand(options: { port?: string }): Promise<void> {
  const port = options.port ? parseInt(options.port, 10) : 3000;

  console.log(chalk.bold.cyan('\n🖥️  NexusFlow — Web Dashboard\n'));
  console.log(chalk.dim('  Starting local server...'));

  try {
    const { port: actualPort } = await startServer(port);
    const url = `http://localhost:${actualPort}`;

    console.log(chalk.green(`  ✔ Dashboard running at: ${chalk.bold(url)}`));
    console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

    // Open url in browser
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`  ✖ Failed to start dashboard: ${msg}`));
  }
}
