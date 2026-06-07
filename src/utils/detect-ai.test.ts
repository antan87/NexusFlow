import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import { detectAIAssistants } from './detect-ai.js';

vi.mock('execa');

describe('detectAIAssistants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect claude and antigravity when commands exit with 0', async () => {
    vi.mocked(execa).mockImplementation((command, args, options) => {
      if (command === 'claude' || command === 'agy') {
        return Promise.resolve({ exitCode: 0 } as any);
      }
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectAIAssistants();

    expect(result).toEqual([
      { name: 'claude', displayName: 'Claude Code', detected: true, command: 'claude' },
      { name: 'antigravity', displayName: 'Antigravity', detected: true, command: 'agy' },
      { name: 'codex', displayName: 'OpenAI Codex', detected: false },
      { name: 'copilot', displayName: 'GitHub Copilot', detected: true },
      { name: 'cursor', displayName: 'Cursor', detected: false },
    ]);
  });

  it('should handle failures gracefully and set detected to false', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('Spawn error'));

    const result = await detectAIAssistants();

    expect(result).toEqual([
      { name: 'claude', displayName: 'Claude Code', detected: false },
      { name: 'antigravity', displayName: 'Antigravity', detected: false },
      { name: 'codex', displayName: 'OpenAI Codex', detected: false },
      { name: 'copilot', displayName: 'GitHub Copilot', detected: true },
      { name: 'cursor', displayName: 'Cursor', detected: false },
    ]);
  });
});
