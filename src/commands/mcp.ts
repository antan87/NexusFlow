import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import chalk from 'chalk';
import { startMcpServer, type McpServerOptions } from '../mcp/server.js';
import { BRAND_NAME, ENGINE_NPM_PACKAGE, BRAND_CONFIG } from '../core/constants.js';

export interface McpRunOptions {
  role?: string;
  allow?: string[];
  deny?: string[];
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

export async function mcpSetupCommand() {
  console.log(chalk.blue.bold(`\nSetting up ${BRAND_NAME} MCP Server for AI Assistants...`));
  
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

  const mcpConfig = {
    command: 'npx',
    // Setup is an explicit grant for the normal workspace-management surface.
    // Ad-hoc `mcp run` remains read-only unless its caller names a role.
    args: ['-y', ENGINE_NPM_PACKAGE, 'mcp', 'run', '--role', 'interactive']
  };

  let updatedCount = 0;

  for (const configPath of configPaths) {
    if (!configPath) continue;
    try {
      let configData: any = { mcpServers: {} };
      
      try {
        await fs.access(configPath);
        const raw = await fs.readFile(configPath, 'utf8');
        // Handle empty or invalid files gracefully
        if (raw.trim()) {
            configData = JSON.parse(raw);
        }
        if (!configData.mcpServers) configData.mcpServers = {};
      } catch (e) {
        // File doesn't exist, we will create it if the directory exists
        const dir = path.dirname(configPath);
        try {
          await fs.access(dir);
        } catch {
          // Directory doesn't exist, skip this environment
          continue;
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

  if (updatedCount > 0) {
    console.log(chalk.green.bold(`\nSuccessfully configured ${updatedCount} AI environments!`));
    console.log(chalk.white('You may need to restart your editor or Claude Desktop for the changes to take effect.'));
  } else {
    console.log(chalk.yellow('\nCould not find any standard configuration files to update.'));
    console.log('You can manually add this configuration to your mcp.json:');
    console.log(JSON.stringify({ mcpServers: { [BRAND_CONFIG.mcp.serverName]: mcpConfig } }, null, 2));
  }
}


