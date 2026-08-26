/**
 * @module generators/copilot
 * Generates a .github/copilot-instructions.md file for GitHub Copilot.
 * Uses the shared base content and adds Copilot-specific sections.
 */

import path from 'node:path';
import fse from 'fs-extra';
import type { WorkspaceContext } from '../types.js';
import { GENERATED_SNAPSHOT_HEADER, GENERATED_VIEW_HEADER } from '../core/generation-lock.js';

/**
 * Generates a `.github/copilot-instructions.md` file at the workspace root.
 *
 * Copilot reads this file for repository-level guidance in Chat and Agent modes.
 *
 * @param ctx           - The workspace context (feature + repos + analysis).
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateCopilotConfig(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  const canonical = (await fse.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf-8'))
    .replace(`${GENERATED_SNAPSHOT_HEADER}\n\n`, '');

  const copilotExtra = `
---

## Copilot-Specific Notes

- Path-scoped instructions can be added in \`.github/instructions/\`
  using \`*.instructions.md\` files with YAML frontmatter to target
  specific file patterns.
- Example path-scoped file:
  \`\`\`markdown
  ---
  applyTo:
    - src/frontend/**
  ---
  # Frontend Guidelines
  - Use TypeScript strict mode.
  \`\`\`
`;

  const content = `${GENERATED_VIEW_HEADER}\n\n${canonical}${copilotExtra}`;
  const githubDir = path.join(workspacePath, '.github');
  const filePath = path.join(githubDir, 'copilot-instructions.md');

  try {
    await fse.ensureDir(githubDir);
    await fse.writeFile(filePath, content, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write copilot-instructions.md: ${message}`);
  }
}
