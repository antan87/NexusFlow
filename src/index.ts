#!/usr/bin/env node

/**
 * @module index
 * NexusFlow CLI entry point.
 *
 * Combines multiple repositories into a workspace with rich AI assistant
 * context files so tools like Claude, Codex, Copilot, and Cursor understand
 * your entire project.
 */

import { Command } from 'commander';

import { createCommand } from './commands/create.js';
import { listCommand } from './commands/list.js';
import { openCommand } from './commands/open.js';
import { initCommand } from './commands/init.js';
import { startCommand } from './commands/start.js';
import { stopCommand } from './commands/stop.js';
import { logsCommand } from './commands/logs.js';
import { statusCommand } from './commands/status.js';
import { uiCommand } from './commands/ui.js';

const program = new Command();

program
  .name('nexusflow')
  .description(
    'Combine multiple repos into a workspace with rich AI assistant context',
  )
  .version('0.1.0');

program
  .command('create')
  .description(
    'Create a new feature workspace — pick repos, pick AI assistants, generate context',
  )
  .action(async () => {
    try {
      await createCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all existing workspaces')
  .action(async () => {
    try {
      await listCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('open')
  .description('Re-open an existing workspace in an editor')
  .action(async () => {
    try {
      await openCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize NexusFlow configuration')
  .action(async () => {
    try {
      await initCommand();
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start all services in a workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await startCommand(workspace);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('stop')
  .description('Stop all running services in a workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await stopCommand(workspace);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Show logs from running services')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-n, --lines <number>', 'Number of lines per service', '30')
  .action(async (workspace: string | undefined, options: { lines: string }) => {
    try {
      await logsCommand(workspace, parseInt(options.lines, 10));
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show status of running services')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await statusCommand(workspace);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('ui')
  .description('Open the web GUI dashboard for NexusFlow')
  .option('-p, --port <number>', 'Port to run the dashboard server on', '3000')
  .action(async (options: { port?: string }) => {
    try {
      await uiCommand(options);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program.parse();
