/**
 * @module generators/claude
 * Generates a CLAUDE.md file for Claude Code / Antigravity.
 * Now uses the shared base content builder which includes analysis data.
 */

import path from 'node:path';
import fse from 'fs-extra';
import type { WorkspaceContext } from '../types.js';
import { buildContextContent } from './base.js';

/**
 * Generates a `CLAUDE.md` file at the workspace root.
 *
 * Claude Code reads this file automatically when opened in a directory,
 * so it is the primary way to give Claude long-lived project context.
 *
 * @param ctx           - The workspace context (feature + repos + analysis).
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateClaudeConfig(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  const content = await buildContextContent(ctx);
  const filePath = path.join(workspacePath, 'CLAUDE.md');

  try {
    await fse.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write CLAUDE.md: ${message}`);
  }
}
