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
import { tuiCommand } from './commands/tui.js';
import { syncCommand } from './commands/sync.js';
import { commitCommand } from './commands/commit.js';
import { diffCommand } from './commands/diff.js';
import { removeCommand } from './commands/remove.js';
import { loadConfig } from './core/config.js';
import { loadPlugins } from './core/plugins/loader.js';
import { addRepoCommand } from './commands/add-repo.js';
import { mcpRunCommand, mcpSetupCommand } from './commands/mcp.js';
import { handoffCommand } from './commands/handoff.js';
import { refreshCommand } from './commands/refresh.js';
import { doctorCommand } from './commands/doctor.js';
import { desktopCommand } from './commands/desktop.js';
import { configShowCommand, configGetCommand, configSetCommand } from './commands/config.js';
import { adapterListCommand, adapterUseCommand, adapterInfoCommand, adapterInitCommand } from './commands/adapter.js';
import { getCurrentVersion, checkForUpdates, printUpdateBanner } from './utils/update-check.js';

const program = new Command();

program
  .name('nexusflow')
  .description(
    'Combine multiple repos into a workspace with rich AI assistant context',
  )
  .version(getCurrentVersion());

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
  .option('-d, --daemon', 'Run the dashboard server in the background (daemon mode)')
  .option('--server-only', 'Start the dashboard server without opening the browser')
  .action(async (options: { port?: string; daemon?: boolean; serverOnly?: boolean }) => {
    try {
      await uiCommand(options);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('dashboard')
  .alias('dash')
  .description('Instantly open the web GUI dashboard in your default browser')
  .option('-p, --port <number>', 'Port to run the dashboard server on', '3000')
  .action(async (options: { port?: string }) => {
    try {
      await uiCommand({ ...options, daemon: true });
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });


program
  .command('tui')
  .description('Open the interactive terminal GUI (TUI) dashboard')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await tuiCommand({ workspace });
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Sync all repositories in a workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await syncCommand(workspace);
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
  .command('commit')
  .description('Commit changes across all repositories in a workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .requiredOption('-m, --message <msg>', 'Commit message')
  .option('--no-push', 'Stage and commit changes without pushing to remote')
  .option('--dry-run', 'Preview changes without committing')
  .action(async (workspace: string | undefined, options: { message: string; noPush?: boolean; dryRun?: boolean }) => {
    try {
      await commitCommand(options.message, workspace, options);
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
  .command('diff')
  .description('Display a unified summary of changes across all repositories')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await diffCommand(workspace);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

// Pack command removed.

program
  .command('remove')
  .alias('rm')
  .description('Delete a workspace and cleanly prune/remove its git worktrees')
  .argument('[workspace]', 'Workspace name or path')
  .action(async (workspace?: string) => {
    try {
      await removeCommand(workspace);
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
  .command('add-repo')
  .alias('add')
  .description('Add a repository to an existing workspace and update configurations')
  .argument('[repo-path]', 'Path to the repository to add')
  .argument('[workspace]', 'Workspace name or path')
  .action(async (repoPath?: string, workspace?: string) => {
    try {
      await addRepoCommand(repoPath, workspace);
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
  .command('handoff')
  .description('Generate a compact handoff bundle (nexusflow-handoff.md) for session resumption')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await handoffCommand(workspace);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('refresh')
  .description('Refresh workspace context, maps, plans and handoff files')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-r, --repo <repo>', 'Only refresh the map for a specific repository')
  .option('-b, --base', 'Only refresh base-layer maps and codebase knowledge from main')
  .action(async (workspace: string | undefined, options: { repo?: string; base?: boolean }) => {
    try {
      await refreshCommand(options, workspace);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Run diagnostics to verify workspace health and check for local loop issues')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await doctorCommand(workspace);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('desktop')
  .description('Launch the NexusFlow desktop application')
  .action(async () => {
    try {
      await desktopCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });
// Config command group
const configCmd = program.command('config').description('View and update NexusFlow configuration');

configCmd
  .command('show')
  .description('Display the current configuration')
  .action(async () => {
    try {
      await configShowCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

configCmd
  .command('get')
  .description('Get a specific configuration key')
  .argument('<key>', 'Configuration key to read')
  .action(async (key: string) => {
    try {
      await configGetCommand(key);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

configCmd
  .command('set')
  .description('Set a configuration key to a value')
  .argument('<key>', 'Configuration key to set')
  .argument('<value>', 'Value to assign')
  .action(async (key: string, value: string) => {
    try {
      await configSetCommand(key, value);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

// Default action when 'nexusflow config' is run without a subcommand
configCmd.action(async () => {
  try {
    await configShowCommand();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});

// Adapter command group
const adapterCmd = program.command('adapter').description('Manage storage adapters — list, switch, configure, or create new ones');

adapterCmd
  .command('list')
  .description('List all available storage adapters')
  .action(async () => {
    try {
      await adapterListCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

adapterCmd
  .command('use')
  .description('Switch to a different storage adapter (prompts for config if needed)')
  .argument('<name>', 'Adapter name to activate')
  .action(async (name: string) => {
    try {
      await adapterUseCommand(name);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

adapterCmd
  .command('info')
  .description('Show detailed information about an adapter')
  .argument('<name>', 'Adapter name to inspect')
  .action(async (name: string) => {
    try {
      await adapterInfoCommand(name);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

adapterCmd
  .command('init')
  .description('Scaffold a new adapter plugin project')
  .argument('<name>', 'Name for the new adapter')
  .action(async (name: string) => {
    try {
      await adapterInitCommand(name);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

// Default action when 'nexusflow adapter' is run without a subcommand
adapterCmd.action(async () => {
  try {
    await adapterListCommand();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});

const mcp = program.command('mcp').description('Manage the NexusFlow MCP Server for AI assistants');

mcp
  .command('run')
  .description('Start the NexusFlow MCP Server (typically called automatically by AI assistants)')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .action(async (workspace?: string) => {
    try {
      await mcpRunCommand(workspace);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

mcp
  .command('setup')
  .description('Automatically configure your AI environments (Claude Desktop, Cursor, VS Code) to use the NexusFlow MCP Server')
  .action(async () => {
    try {
      await mcpSetupCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

program.hook('postAction', async (thisCommand, actionCommand) => {
  // Skip update check for MCP run to prevent contaminating stdout stream
  if (actionCommand.name() === 'run' && actionCommand.parent?.name() === 'mcp') {
    return;
  }

  try {
    const status = await checkForUpdates();
    if (status) {
      printUpdateBanner(status);
    }
  } catch {
    // Silently ignore to prevent crashing CLI
  }
});

async function bootstrap() {
  try {
    const config = await loadConfig();
    if (config.plugins && config.plugins.length > 0) {
      await loadPlugins(program, config.plugins);
    }
  } catch {}
  await program.parseAsync(process.argv);
}

bootstrap();

