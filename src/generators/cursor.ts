/**
 * @module generators/cursor
 * Generates a .cursor/rules/nexusflow.mdc file for Cursor.
 * Uses the shared base content with Cursor-specific YAML frontmatter.
 */

import path from 'node:path';
import fse from 'fs-extra';
import type { WorkspaceContext } from '../types.js';
import { GENERATED_SNAPSHOT_HEADER, GENERATED_VIEW_HEADER } from '../core/generation-lock.js';

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
  const canonical = (await fse.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf-8'))
    .replace(`${GENERATED_SNAPSHOT_HEADER}\n\n`, '');

  const content = `---
description: "NexusFlow workspace context for multi-repo feature development"
alwaysApply: true
---

${GENERATED_VIEW_HEADER}

${canonical}`;

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
