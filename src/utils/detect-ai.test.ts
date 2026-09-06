import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execa } from 'execa';
import { detectAIAssistants } from './detect-ai.js';

vi.mock('execa');

describe('detectAIAssistants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect claude and antigravity when commands exit with 0', async () => {
    vi.mocked(execa).mockImplementation((command: any, args?: any, options?: any): any => {
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
      { name: 'copilot', displayName: 'GitHub Copilot', detected: false },
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
      { name: 'copilot', displayName: 'GitHub Copilot', detected: false },
      { name: 'cursor', displayName: 'Cursor', detected: false },
    ]);
  });

  it('gives copilot a launch command only when the copilot CLI is present', async () => {
    vi.mocked(execa).mockImplementation((command: any): any => {
      if (command === 'copilot') return Promise.resolve({ exitCode: 0 } as any);
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectAIAssistants();

    const copilot = result.find((r) => r.name === 'copilot');
    expect(copilot).toEqual({ name: 'copilot', displayName: 'GitHub Copilot', detected: true, command: 'copilot' });
  });

  it('launches Cursor via cursor-agent, not the GUI cursor binary', async () => {
    vi.mocked(execa).mockImplementation((command: any): any => {
      // Only the GUI binary exists; the terminal agent CLI does not.
      if (command === 'cursor') return Promise.resolve({ exitCode: 0 } as any);
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectAIAssistants();

    const cursor = result.find((r) => r.name === 'cursor');
    // Detected (offered as an option) but not launchable as a terminal session.
    expect(cursor).toEqual({ name: 'cursor', displayName: 'Cursor', detected: true });
  });

  it('sets cursor command to cursor-agent when that CLI is present', async () => {
    vi.mocked(execa).mockImplementation((command: any): any => {
      if (command === 'cursor' || command === 'cursor-agent') {
        return Promise.resolve({ exitCode: 0 } as any);
      }
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectAIAssistants();

    const cursor = result.find((r) => r.name === 'cursor');
    expect(cursor).toEqual({ name: 'cursor', displayName: 'Cursor', detected: true, command: 'cursor-agent' });
  });
});
