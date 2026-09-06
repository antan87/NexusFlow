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
 * `detected` reports whether the assistant should be offered as an option;
 * `command` is set only when a CLI that can host an *interactive terminal
 * session* is available (it is the single source of truth for launching one).
 * Some assistants can be detected without being launchable this way — Copilot
 * is convention-based, and Cursor's `cursor` binary opens the GUI editor rather
 * than a terminal agent (its launchable CLI is `cursor-agent`).
 *
 * Detection rules:
 * - **Claude**: detected if `claude` *or* `agy` (Antigravity) is on PATH.
 * - **Antigravity**: detected if `agy` is on PATH.
 * - **Codex**: detected if `codex` is on PATH.
 * - **Copilot**: always offered (convention-based via
 *   `.github/copilot-instructions.md`); launchable only when the `copilot`
 *   CLI is on PATH.
 * - **Cursor**: detected if `cursor` is on PATH; launchable only when the
 *   `cursor-agent` CLI is on PATH.
 *
 * @returns An array of {@link DetectedAI} results, one per assistant.
 */
export async function detectAIAssistants(): Promise<DetectedAI[]> {
  // Run all probes concurrently.
  const [hasClaude, hasAntigravity, hasCodex, hasCopilot, hasCursor, hasCursorAgent] =
    await Promise.all([
      commandExists('claude'),
      commandExists('agy'),
      commandExists('codex'),
      commandExists('copilot'),
      commandExists('cursor'),
      commandExists('cursor-agent'),
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
      detected: hasCopilot,
      ...(hasCopilot ? { command: 'copilot' } : {}),
    },
    {
      name: 'cursor' as AIAssistant,
      displayName: 'Cursor',
      detected: hasCursor,
      // `cursor` opens the GUI editor; `cursor-agent` is the terminal session CLI.
      ...(hasCursorAgent ? { command: 'cursor-agent' } : {}),
    },
  ];

  return results;
}
