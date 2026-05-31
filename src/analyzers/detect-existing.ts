/**
 * @module analyzers/detect-existing
 * Detects existing AI assistant configuration files in a repository.
 * These are merged into the generated workspace context to preserve
 * repo-specific instructions.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ExistingAIConfig } from '../types.js';

/** Maximum chars to include as a content preview. */
const PREVIEW_LENGTH = 500;

/** Known AI config file locations. */
const AI_CONFIG_FILES = [
  { assistant: 'claude' as const, relativePath: 'CLAUDE.md' },
  { assistant: 'claude' as const, relativePath: 'CLAUDE.local.md' },
  { assistant: 'agents' as const, relativePath: 'AGENTS.md' },
  { assistant: 'copilot' as const, relativePath: '.github/copilot-instructions.md' },
  { assistant: 'cursor' as const, relativePath: '.cursorrules' },
];

/**
 * Scans a repository for existing AI assistant configuration files.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of detected {@link ExistingAIConfig} objects.
 */
export async function detectExistingAIConfigs(
  repoPath: string,
): Promise<ExistingAIConfig[]> {
  const results: ExistingAIConfig[] = [];

  for (const config of AI_CONFIG_FILES) {
    const filePath = path.join(repoPath, config.relativePath);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      results.push({
        assistant: config.assistant,
        relativePath: config.relativePath,
        contentPreview: content.slice(0, PREVIEW_LENGTH),
      });
    } catch {
      // File doesn't exist — skip
    }
  }

  // Also check for Cursor rules directory
  const cursorRulesDir = path.join(repoPath, '.cursor', 'rules');
  try {
    const entries = await fs.readdir(cursorRulesDir);
    const mdcFiles = entries.filter((e) => e.endsWith('.mdc'));

    for (const mdc of mdcFiles) {
      try {
        const content = await fs.readFile(path.join(cursorRulesDir, mdc), 'utf-8');
        results.push({
          assistant: 'cursor',
          relativePath: `.cursor/rules/${mdc}`,
          contentPreview: content.slice(0, PREVIEW_LENGTH),
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // No .cursor/rules directory
  }

  return results;
}
