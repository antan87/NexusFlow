/**
 * @module utils/detect-editors
 * Detects which code editors are available on the system.
 */

import { execa } from 'execa';

import type { DetectedEditor } from '../types.js';

/** Editor definitions we probe for. */
const EDITOR_CANDIDATES: ReadonlyArray<{ name: string; command: string; platforms?: NodeJS.Platform[] }> = [
  { name: 'VS Code', command: 'code' },
  { name: 'VS Code Insiders', command: 'code-insiders' },
  { name: 'Cursor', command: 'cursor' },
  { name: 'Antigravity', command: 'antigravity' },
  { name: 'PowerShell', command: 'powershell', platforms: ['win32'] },
  { name: 'Command Prompt', command: 'cmd', platforms: ['win32'] },
  { name: 'IntelliJ IDEA', command: 'idea' },
  { name: 'WebStorm', command: 'webstorm' },
  { name: 'PyCharm', command: 'charm' },
  { name: 'Sublime Text', command: 'subl' },
  { name: 'Zed', command: 'zed' },
  { name: 'Windsurf', command: 'windsurf' },
];

/**
 * Attempts to probe whether the editor or shell command exists on the system.
 */
async function commandExists(command: string): Promise<boolean> {
  if (process.platform === 'win32') {
    if (command === 'powershell' || command === 'cmd') {
      return true;
    }
  }
  try {
    const result = await execa(command, ['--version'], {
      reject: false,
      shell: process.platform === 'win32',
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Probes the system for known code editors and shells by checking whether their CLI
 * commands are available on PATH.
 *
 * @returns An array of {@link DetectedEditor} results, one per editor.
 */
export async function detectEditors(): Promise<DetectedEditor[]> {
  const currentPlatform = process.platform;
  const candidates = EDITOR_CANDIDATES.filter(
    (c) => !c.platforms || c.platforms.includes(currentPlatform)
  );

  const probes = candidates.map(async (editor) => {
    const detected = await commandExists(editor.command);
    return {
      name: editor.name,
      command: editor.command,
      detected,
    } satisfies DetectedEditor;
  });

  return Promise.all(probes);
}
