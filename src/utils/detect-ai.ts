/**
 * @module utils/detect-ai
 * Detects which AI coding assistants are available on the system.
 */

import { execa } from 'execa';

import type { AIAssistant, DetectedAI } from '../types.js';

/**
 * Attempts to run `<command> --version` and returns `true` if the process
 * exits successfully (exit code 0).
 */
async function commandExists(command: string): Promise<boolean> {
  try {
    const result = await execa(command, ['--version'], {
      reject: false,
      shell: process.platform === 'win32',
    });
    return result.exitCode === 0;
  } catch {
    // The command could not be spawned at all (not in PATH).
    return false;
  }
}

/**
 * Probes the system for known AI coding assistants and returns their status.
 *
 * Detection rules:
 * - **Claude**: detected if `claude` *or* `antigravity` is on PATH.
 *   When Antigravity is found it is labelled as `'claude'` because it
 *   generates `CLAUDE.md` context files.
 * - **Codex**: detected if `codex` is on PATH.
 * - **Copilot**: always shown as an option (convention-based via
 *   `.github/copilot-instructions.md`).
 * - **Cursor**: detected if `cursor` is on PATH.
 *
 * @returns An array of {@link DetectedAI} results, one per assistant.
 */
export async function detectAIAssistants(): Promise<DetectedAI[]> {
  // Run all probes concurrently.
  const [hasClaude, hasAntigravity, hasCodex, hasCursor] = await Promise.all([
    commandExists('claude'),
    commandExists('agy'),
    commandExists('codex'),
    commandExists('cursor'),
  ]);

  const results: DetectedAI[] = [
    {
      name: 'claude' as AIAssistant,
      displayName: 'Claude Code',
      detected: hasClaude,
      ...(hasClaude ? { command: 'claude' } : {}),
    },
    {
      name: 'antigravity' as AIAssistant,
      displayName: 'Antigravity',
      detected: hasAntigravity,
      ...(hasAntigravity ? { command: 'agy' } : {}),
    },
    {
      name: 'codex' as AIAssistant,
      displayName: 'OpenAI Codex',
      detected: hasCodex,
      ...(hasCodex ? { command: 'codex' } : {}),
    },
    {
      name: 'copilot' as AIAssistant,
      displayName: 'GitHub Copilot',
      // Copilot is convention-based; always available as an option.
      detected: true,
    },
    {
      name: 'cursor' as AIAssistant,
      displayName: 'Cursor',
      detected: hasCursor,
      ...(hasCursor ? { command: 'cursor' } : {}),
    },
  ];

  return results;
}
