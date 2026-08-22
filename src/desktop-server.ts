/**
 * @module desktop-server
 * Minimal entry point for the desktop app's embedded backend: starts the Hono
 * dashboard server directly, without the CLI layer (commander/pm2/inquirer and
 * all the command modules). The Electron shell spawns this and parses the
 * explicit "NEXUSFLOW_READY_PORT=<port>" token from stdout.
 *
 * Running the full CLI (`index.js ui`) here is both unnecessary and fragile —
 * under Electron-as-Node the CLI's commander import can resolve to pm2's
 * ancient nested commander (v2, no `.hook`) and crash at startup.
 */

import { startServer } from './server.js';

const port = Number(process.env.NF_PORT ?? process.argv[2] ?? 0) || 0;

startServer(port, { strictPort: false })
  .then(({ port: actualPort }) => {
    // The Electron shell watches stdout for this token to know the server is up.
    console.log(`NEXUSFLOW_READY_PORT=${actualPort}`);
    console.log(`Dashboard running at: http://localhost:${actualPort}`);
  })
  .catch((err) => {
    console.error('Failed to start dashboard server:', err);
    process.exit(1);
  });
