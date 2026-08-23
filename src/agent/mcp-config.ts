import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRole } from '../mcp/tools.js';

export interface LocalMcpServerConfig {
  command: string;
  args: string[];
}

/**
 * Resolves the path to the local CLI build entrypoint (`dist/index.js`).
 * This avoids supply-chain risks from unpinned `npx` downloads and ensures
 * harness sessions run against the exact local package version.
 */
export function getLocalCliEntry(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const baseDir = path.dirname(currentFile);
  const packageDir = path.resolve(baseDir, '..', '..');
  return path.join(packageDir, 'dist', 'index.js');
}

/**
 * Constructs a local MCP server configuration object for Claude or Codex harnesses.
 */
export function getLocalMcpServerConfig(
  workspacePath: string,
  role: AgentRole = 'developer',
): LocalMcpServerConfig {
  return {
    command: process.execPath,
    args: [getLocalCliEntry(), 'mcp', 'run', workspacePath, '--role', role],
  };
}
