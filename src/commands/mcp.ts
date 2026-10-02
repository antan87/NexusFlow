import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import chalk from 'chalk';
import { startMcpServer, type McpServerOptions } from '../mcp/server.js';
import { BRAND_NAME, BRAND_CONFIG, CLI_NAME } from '../core/constants.js';
import { registerAgentMcp, unboundMcpServer, type AgentMcpResult } from '../core/agent-mcp.js';

export interface McpRunOptions {
  role?: string;
  allow?: string[];
  deny?: string[];
}

export interface McpSetupOptions {
  /** Report what would be registered with each agent; change nothing. */
  dryRun?: boolean;
}

export async function mcpRunCommand(workspace?: string, options?: McpRunOptions) {
  // If not provided, it attempts to use process.cwd() or waits for workspaceId in MCP calls.
  // The startMcpServer function handles this.
  await startMcpServer({
    workspacePath: workspace,
    role: options?.role,
    allowList: options?.allow,
    denyList: options?.deny,
  });
}

/** Writes the server into editor and desktop-app MCP config files that already exist. Returns how many it updated. */
async function configureEditors(): Promise<number> {
  const isWin = os.platform() === 'win32';
  const isMac = os.platform() === 'darwin';
  const home = os.homedir();

  const configPaths = [
    // Cursor
    path.join(home, '.cursor', 'mcp.json'),
    // VS Code Insiders (for Antigravity/Copilot)
    isWin
      ? path.join(home, 'AppData', 'Roaming', 'Code - Insiders', 'User', 'mcp.json')
      : isMac
        ? path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'mcp.json')
        : path.join(home, '.config', 'Code - Insiders', 'User', 'mcp.json'),
    // VS Code (Stable)
    isWin
      ? path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json')
      : isMac
        ? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
        : path.join(home, '.config', 'Code', 'User', 'mcp.json'),
    // Claude Desktop
    isWin
      ? path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
      : isMac
        ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : ''
  ].filter(Boolean);

  // Setup is an explicit grant for the normal workspace-management surface.
  // Ad-hoc `mcp run` remains read-only unless its caller names a role.
  const mcpConfig = unboundMcpServer();

  let updatedCount = 0;

  for (const configPath of configPaths) {
    if (!configPath) continue;
    try {
      let configData: any = { mcpServers: {} };

      try {
        const raw = await fs.readFile(configPath, 'utf8');
        // Handle empty or invalid files gracefully
        if (raw.trim()) {
            configData = JSON.parse(raw);
        }
        if (!configData.mcpServers) configData.mcpServers = {};
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          // File doesn't exist, we will create it if the directory exists
          const dir = path.dirname(configPath);
          try {
            await fs.access(dir);
          } catch {
            // Directory doesn't exist, skip this environment
            continue;
          }
        } else {
          throw e;
        }
      }

      configData.mcpServers[BRAND_CONFIG.mcp.serverName] = mcpConfig;

      await fs.writeFile(configPath, JSON.stringify(configData, null, 2), 'utf8');
      console.log(chalk.green(`  ✓ Configured MCP in: ${configPath}`));
      updatedCount++;
    } catch (e: any) {
      console.log(chalk.gray(`  - Skipped ${configPath} (${e.message})`));
    }
  }

  return updatedCount;
}

function describeAgentResult({ name, outcome }: AgentMcpResult): string {
  switch (outcome.result) {
    case 'added': return chalk.green(`  ✓ ${name}: registered (${outcome.how})`);
    case 'would-add': return chalk.cyan(`  + ${name}: would register (${outcome.how})`);
    case 'already': return chalk.gray(`  ✓ ${name}: already available as "${outcome.serverName}"`);
    case 'skipped': return chalk.gray(`  - ${name}: ${outcome.reason}`);
    case 'failed': return chalk.red(`  ✗ ${name}: failed: ${outcome.reason}`);
  }
}

export async function mcpSetupCommand(options: McpSetupOptions = {}) {
  console.log(chalk.blue.bold(`\nSetting up ${BRAND_NAME} MCP Server for AI Assistants...`));

  // Editors have no dry-run: say so rather than writing during one.
  const editorsUpdated = options.dryRun ? 0 : await configureEditors();

  console.log(chalk.bold(`\nAI agents${options.dryRun ? ' (dry run, nothing is changed)' : ''}:`));
  const agents = await registerAgentMcp({ dryRun: options.dryRun });
  for (const agent of agents) console.log(describeAgentResult(agent));

  const added = agents.filter((agent) => agent.outcome.result === 'added').length;
  const failed = agents.filter((agent) => agent.outcome.result === 'failed').length;
  const available = agents.some((agent) => ['added', 'already', 'would-add'].includes(agent.outcome.result));
  if (failed > 0) process.exitCode = 1;

  if (options.dryRun) return;

  if (editorsUpdated + added > 0) {
    console.log(chalk.green.bold(`\nConfigured ${editorsUpdated + added} AI environment${editorsUpdated + added === 1 ? '' : 's'}.`));
    console.log(chalk.white('Restart running agent sessions, editors and Claude Desktop for the changes to take effect.'));
  } else if (!available && editorsUpdated === 0) {
    console.log(chalk.yellow('\nCould not find any AI agent or standard configuration file to update.'));
    console.log('You can manually add this configuration to your mcp.json:');
    console.log(JSON.stringify({ mcpServers: { [BRAND_CONFIG.mcp.serverName]: unboundMcpServer() } }, null, 2));
  } else {
    console.log(chalk.green(`\nNothing to change. Run \`${CLI_NAME} doctor\` any time to check again.`));
  }
}
