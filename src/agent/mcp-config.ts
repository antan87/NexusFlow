import * as fs from 'node:fs';
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
import { BRAND_NAME } from '../core/constants.js';

export function getLocalCliEntry(distIndexOverride?: string): string {
  const currentFile = fileURLToPath(import.meta.url);
  const baseDir = path.dirname(currentFile);
  const packageDir = path.resolve(baseDir, '..', '..');
  const distIndex = distIndexOverride ?? path.join(packageDir, 'dist', 'index.js');

  if (!fs.existsSync(distIndex)) {
    throw new Error(
      `${BRAND_NAME} CLI entrypoint not found at ${distIndex}. Run "npm run build" to compile before starting SDK sessions.`,
    );
  }

  return distIndex;
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
