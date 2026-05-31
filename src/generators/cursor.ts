/**
 * @module generators/cursor
 * Generates a .cursor/rules/nexusflow.mdc file for Cursor.
 * Uses the shared base content with Cursor-specific YAML frontmatter.
 */

import path from 'node:path';
import fse from 'fs-extra';
import type { WorkspaceContext } from '../types.js';
import { buildContextContent } from './base.js';

/**
 * Generates a `.cursor/rules/nexusflow.mdc` file at the workspace root.
 *
 * Cursor reads `.mdc` rule files from `.cursor/rules/` for project-wide
 * instructions. The YAML frontmatter controls when the rule is applied.
 *
 * @param ctx           - The workspace context (feature + repos + analysis).
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateCursorConfig(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  const baseContent = buildContextContent(ctx);

  const content = `---
description: "NexusFlow workspace context for multi-repo feature development"
alwaysApply: true
---

${baseContent}`;

  const rulesDir = path.join(workspacePath, '.cursor', 'rules');
  const filePath = path.join(rulesDir, 'nexusflow.mdc');

  try {
    await fse.ensureDir(rulesDir);
    await fse.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write nexusflow.mdc: ${message}`);
  }
}
