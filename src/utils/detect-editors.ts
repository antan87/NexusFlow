/**
 * @module utils/detect-editors
 * Detects which code editors are available on the system.
 */

import { execa } from 'execa';

import type { DetectedEditor } from '../types.js';

/** Editor definitions we probe for. */
const EDITOR_CANDIDATES: ReadonlyArray<{ name: string; command: string }> = [
  { name: 'VS Code', command: 'code' },
  { name: 'VS Code Insiders', command: 'code-insiders' },
  { name: 'Cursor', command: 'cursor' },
  { name: 'Antigravity', command: 'agy' },
];

/**
 * Attempts to run `<command> --version` and returns `true` if the process
 * exits successfully (exit code 0).
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execa(command, ['--version'], { reject: false });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Probes the system for known code editors by checking whether their CLI
 * commands are available on PATH.
 *
 * Currently checks for:
 * - **VS Code** (`code`)
 * - **VS Code Insiders** (`code-insiders`)
 * - **Cursor** (`cursor`)
 * - **Antigravity** (`antigravity`)
 *
 * @returns An array of {@link DetectedEditor} results, one per editor.
 */
export async function detectEditors(): Promise<DetectedEditor[]> {
  const probes = EDITOR_CANDIDATES.map(async (editor) => {
    const detected = await commandExists(editor.command);
    return {
      name: editor.name,
      command: editor.command,
      detected,
    } satisfies DetectedEditor;
  });

  return Promise.all(probes);
}
