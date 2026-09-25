/**
 * @module generators/claude
 * Generates `CLAUDE.md` as a thin import of the canonical `AGENTS.md`.
 *
 * In Claude Code v2.1.277+, Claude Code natively supports `AGENTS.md` as a fallback
 * when no `CLAUDE.md` is present. However, when `CLAUDE.md` exists, Claude Code
 * prioritizes it over `AGENTS.md`.
 *
 * `CLAUDE.md` is maintained in the workspace to:
 * 1. Provide Claude-specific guidance (such as preferring `/plan` for multi-repo changes
 *    and recording durable findings via the CLI).
 * 2. Use `@AGENTS.md` to import the canonical workspace context, ensuring `AGENTS.md`
 *    remains the single source of truth without duplicating instructions.
 * 3. Preserve compatibility with older Claude Code releases (< v2.1.277) that only
 *    read `CLAUDE.md`.
 *
 * The import costs nothing: `@path` files are expanded into context at launch,
 * so this is an include rather than a link — Claude gets the full body without a
 * tool call.
 *
 * A symlink would also work, but creating one on Windows needs Administrator
 * rights or Developer Mode, so the import is the portable choice.
 */

import type { WorkspaceContext } from '../types.js';
import { writeWorkspaceFile } from '../core/storage.js';
import { GENERATED_VIEW_HEADER } from '../core/generation-lock.js';
import { CLI_NAME } from '../core/constants.js';

/**
 * Writes a `CLAUDE.md` that imports `AGENTS.md`, plus anything Claude-specific.
 *
 * Written through the storage layer, like `AGENTS.md` — not with a raw path join.
 * The two must land in the same directory or the import resolves to nothing, and
 * an unresolved `@`-import is silent: Claude Code would start with no workspace
 * context and no error. Routing both through one writer is what keeps them
 * together no matter which backend is active.
 *
 * @param ctx           - The workspace context (feature + repos + analysis).
 * @param workspacePath - Absolute path to the workspace root directory.
 */
export async function generateClaudeConfig(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  const content = `${GENERATED_VIEW_HEADER}

@AGENTS.md

## Claude Code

- Prefer \`/plan\` before a change that spans more than one repository in this workspace.
- Record durable findings with \`${CLI_NAME} knowledge add\` rather than in chat, so the next session inherits them.
`;

  try {
    await writeWorkspaceFile(workspacePath, ctx.feature.id, 'CLAUDE.md', content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write CLAUDE.md: ${message}`);
  }
}
