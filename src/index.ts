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
import chalk from 'chalk';

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
import { debugLog } from './utils/debug.js';
import { loadPlugins } from './core/plugins/loader.js';
import { addRepoCommand } from './commands/add-repo.js';
import { mcpRunCommand, mcpSetupCommand } from './commands/mcp.js';
import { handoffCommand } from './commands/handoff.js';
import { refreshCommand } from './commands/refresh.js';
import { doctorCommand } from './commands/doctor.js';
import { knowledgeAddCommand, knowledgeShowCommand, knowledgePromoteCommand } from './commands/knowledge.js';
import { finishCommand } from './commands/finish.js';
import { desktopCommand } from './commands/desktop.js';
import { configShowCommand, configGetCommand, configSetCommand } from './commands/config.js';
import {
  scheduleAddCommand,
  scheduleListCommand,
  scheduleRemoveCommand,
  scheduleRunCommand,
  scheduleToggleCommand,
} from './commands/schedule.js';
import { adapterListCommand, adapterUseCommand, adapterInfoCommand, adapterInitCommand } from './commands/adapter.js';
import { getCurrentVersion, checkForUpdates, printUpdateBanner } from './utils/update-check.js';

const program = new Command();

program
  .name('nexusflow')
  .description(
    'Combine multiple repos into a workspace with rich AI assistant context',
  )
  .version(getCurrentVersion())
  .option('--debug', 'Enable verbose debug logging to stderr (or set NEXUSFLOW_DEBUG=1)');

// Turn the global --debug flag into the env var the debug logger reads, before
// any action runs.
program.hook('preAction', (thisCommand) => {
  if (thisCommand.opts().debug) {
    process.env.NEXUSFLOW_DEBUG = '1';
  }
});

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
  .option('--strict-port', 'Fail instead of auto-incrementing when the port is in use')
  .action(async (options: { port?: string; daemon?: boolean; serverOnly?: boolean; strictPort?: boolean }) => {
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
  .option('-r, --repo <repos...>', 'Only commit the given repositories (by name)')
  .action(async (workspace: string | undefined, options: { message: string; push?: boolean; dryRun?: boolean; repo?: string[] }) => {
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
  .description('Display a unified summary of changes across all repositories (including unpushed commits)')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-r, --repo <repos...>', 'Only show the given repositories (by name)')
  .action(async (workspace: string | undefined, options: { repo?: string[] }) => {
    try {
      await diffCommand(workspace, options);
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
  .description('Refresh workspace context, maps, plans and handoff files (re-analyzes only changed repos)')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-r, --repo <repo>', 'Only refresh the map for a specific repository')
  .option('-b, --base', 'Only refresh base-layer maps and codebase knowledge from main')
  .option('-f, --force', 'Ignore the analysis cache and re-analyze every repository')
  .action(async (workspace: string | undefined, options: { repo?: string; base?: boolean; force?: boolean }) => {
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
  .command('finish')
  .description('Finish a feature — commit & push everything, open PRs, promote learnings, optionally remove the workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-m, --message <msg>', 'Commit message for any remaining changes')
  .option('--no-pr', 'Skip PR creation and compare links')
  .option('--no-knowledge', 'Skip the knowledge promotion step')
  .option('--cleanup', 'Remove the workspace after everything is confirmed pushed (still asks for confirmation)')
  .option('-y, --yes', 'Accept defaults for non-destructive prompts')
  .option('--dry-run', 'Show what finish would do without changing anything')
  .action(async (workspace: string | undefined, options: { message?: string; pr?: boolean; knowledge?: boolean; cleanup?: boolean; yes?: boolean; dryRun?: boolean }) => {
    try {
      await finishCommand(workspace, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

// Knowledge command group
const knowledgeCmd = program
  .command('knowledge')
  .alias('know')
  .description('Capture and manage workspace learnings (decisions, gotchas, progress)');

knowledgeCmd
  .command('add')
  .description('Append a timestamped learning to the workspace knowledge file')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .requiredOption('-t, --type <type>', 'Entry type: decision | gotcha | progress | assumption | question')
  .requiredOption('-m, --message <msg>', 'The learning to record')
  .option('--title <title>', 'Short title (used for decision headings)')
  .option('-r, --repo <repo>', "Write to this repo's persistent base knowledge instead")
  .action(async (workspace: string | undefined, options: { type: string; message: string; title?: string; repo?: string }) => {
    try {
      await knowledgeAddCommand(workspace, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

knowledgeCmd
  .command('show')
  .description("Print the workspace knowledge file (or a repo's base knowledge)")
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-s, --section <name>', 'Only show one section')
  .option('-r, --repo <repo>', "Show the repo's base knowledge file instead")
  .action(async (workspace: string | undefined, options: { section?: string; repo?: string }) => {
    try {
      await knowledgeShowCommand(workspace, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

knowledgeCmd
  .command('promote')
  .description('Copy workspace learnings into per-repo base knowledge so they persist across features')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-r, --repo <repo>', 'Target repository (skips the repo prompt)')
  .option('-t, --type <type>', 'Entry type when promoting a message non-interactively')
  .option('-m, --message <msg>', 'Promote this text directly (non-interactive)')
  .option('--move', 'Remove the entry from the workspace file after promoting (default: copy)')
  .option('--all', 'Promote all decisions, gotchas and assumptions without prompting')
  .action(async (workspace: string | undefined, options: { repo?: string; type?: string; message?: string; move?: boolean; all?: boolean }) => {
    try {
      await knowledgePromoteCommand(workspace, options);
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

// Schedule command group
const scheduleCmd = program
  .command('schedule')
  .description('Manage recurring workspace jobs (sync/refresh) — jobs run while a NexusFlow server is active');

scheduleCmd
  .command('add')
  .description('Schedule a recurring job for a workspace')
  .argument('[workspace]', 'Path to workspace (auto-detects from CWD)')
  .option('-t, --task <task>', 'Job to run: "sync" or "refresh"', 'sync')
  .requiredOption('-e, --every <interval>', 'How often to run, e.g. 30m, 2h, 1d')
  .action(async (workspace: string | undefined, options: { task?: string; every?: string }) => {
    try {
      await scheduleAddCommand(workspace, options);
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log('\nCancelled.');
        process.exit(0);
      }
      console.error(error);
      process.exit(1);
    }
  });

scheduleCmd
  .command('list')
  .alias('ls')
  .description('List all scheduled jobs')
  .action(async () => {
    try {
      await scheduleListCommand();
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

scheduleCmd
  .command('remove')
  .alias('rm')
  .description('Remove a scheduled job')
  .argument('<id>', 'Job id (see "nexusflow schedule list")')
  .action(async (id: string) => {
    try {
      await scheduleRemoveCommand(id);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

scheduleCmd
  .command('enable')
  .description('Enable a scheduled job')
  .argument('<id>', 'Job id (see "nexusflow schedule list")')
  .action(async (id: string) => {
    try {
      await scheduleToggleCommand(id, true);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

scheduleCmd
  .command('disable')
  .description('Disable a scheduled job without removing it')
  .argument('<id>', 'Job id (see "nexusflow schedule list")')
  .action(async (id: string) => {
    try {
      await scheduleToggleCommand(id, false);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

scheduleCmd
  .command('run')
  .description('Run a scheduled job immediately')
  .argument('<id>', 'Job id (see "nexusflow schedule list")')
  .action(async (id: string) => {
    try {
      await scheduleRunCommand(id);
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  });

// Default action when 'nexusflow schedule' is run without a subcommand
scheduleCmd.action(async () => {
  try {
    await scheduleListCommand();
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
    // Quiet: plugins (which may register storage adapters) are not loaded yet,
    // so a storage-adapter warning here would be a false alarm.
    const config = await loadConfig({ quiet: true });
    if (config.plugins && config.plugins.length > 0) {
      await loadPlugins(program, config.plugins);
    }
  } catch (error) {
    console.warn(chalk.yellow('⚠ Plugin loading failed — continuing without plugins.'));
    debugLog('plugins', 'bootstrap', error);
  }
  await program.parseAsync(process.argv);
}

bootstrap();

