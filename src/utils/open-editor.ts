/**
 * @module utils/open-editor
 * Launches an editor at a workspace, handling two Windows-specific pitfalls:
 * - `shell: true` (required because `code`/`cursor` are `.cmd` shims) does not
 *   escape arguments, so a path containing spaces must be quoted.
 * - VS Code / Cursor discover the worktrees only via the generated
 *   `<name>.code-workspace` file (the root `.gitignore` hides the repo dirs),
 *   so open that file rather than the bare folder when it exists.
 */

import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Editors that understand a `.code-workspace` file. */
const WORKSPACE_FILE_EDITORS = new Set(['code', 'code-insiders', 'cursor', 'antigravity', 'windsurf']);

/**
 * Resolves what to actually open: the generated `.code-workspace` file for
 * VS Code-family editors when it exists, otherwise the workspace folder.
 */
export async function resolveEditorTarget(
  editorCommand: string,
  workspacePath: string,
): Promise<string> {
  if (WORKSPACE_FILE_EDITORS.has(editorCommand)) {
    const name = path.basename(workspacePath);
    const workspaceFile = path.join(workspacePath, `${name}.code-workspace`);
    try {
      await fs.access(workspaceFile);
      return workspaceFile;
    } catch {
      // No .code-workspace file — fall back to the folder.
    }
  }
  return workspacePath;
}

/**
 * Opens the workspace in the given editor. Throws if the editor cannot be
 * spawned so callers can surface a manual-open hint.
 */
export async function openInEditor(editorCommand: string, workspacePath: string): Promise<void> {
  const target = await resolveEditorTarget(editorCommand, workspacePath);
  const useShell = process.platform === 'win32';
  // With `shell: true` execa does not escape arguments; quote so spaces survive.
  const arg = useShell ? `"${target}"` : target;
  await execa(editorCommand, [arg], { stdio: 'ignore', shell: useShell });
}
