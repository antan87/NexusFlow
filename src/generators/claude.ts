/**
 * @module generators/claude
 * Generates `CLAUDE.md` as a thin import of the canonical `AGENTS.md`.
 *
 * Claude Code reads `CLAUDE.md`, not `AGENTS.md` — but its documented pattern for
 * a repo that already has `AGENTS.md` is a `CLAUDE.md` that imports it, "so both
 * tools read the same instructions without duplicating them".
 *
 * The import costs nothing: `@path` files are expanded into context at launch,
 * so this is an include rather than a link — Claude gets the full body without a
 * tool call. That is what makes `AGENTS.md` the single source of truth while
 * still being read by the one tool that will not look at it.
 *
 * A symlink would also work, but creating one on Windows needs Administrator
 * rights or Developer Mode, so the import is the portable choice.
 */

import type { WorkspaceContext } from '../types.js';
import { writeWorkspaceFile } from '../core/storage.js';
import { GENERATED_VIEW_HEADER } from '../core/generation-lock.js';

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

<!-- AGENTS.md holds the workspace context and is read by every other agent
     tool. Claude Code does not read it, so this file imports it: @-imports are
     expanded into context at launch, so nothing is duplicated and nothing costs
     an extra read. Put Claude-only instructions below, not above. -->

## Claude Code

- Prefer \`/plan\` before a change that spans more than one repository in this workspace.
- Record durable findings with \`nexusflow knowledge add\` rather than in chat, so the next session inherits them.
`;

  try {
    await writeWorkspaceFile(workspacePath, ctx.feature.id, 'CLAUDE.md', content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to write CLAUDE.md: ${message}`);
  }
}
