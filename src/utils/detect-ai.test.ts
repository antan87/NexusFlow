import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { execa } from 'execa';
import { detectAIAssistants } from './detect-ai.js';

vi.mock('execa');

/** Compare by name: the picker's order follows manifest declaration order, which is a
 * product choice rather than a contract. */
const byName = (entries: Array<{ name: string }>) => [...entries].sort((a, b) => a.name.localeCompare(b.name));

describe('detectAIAssistants', () => {
  // grok is detected from XAI_API_KEY, so these expectations describe a machine
  // with no credential. Export one and the suite fails for the wrong reason.
  let savedXaiKey: string | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    savedXaiKey = process.env.XAI_API_KEY;
    delete process.env.XAI_API_KEY;
  });
  afterEach(() => {
    if (savedXaiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = savedXaiKey;
  });

  it('should detect claude and antigravity when commands exit with 0', async () => {
    vi.mocked(execa).mockImplementation((command: any, args?: any, options?: any): any => {
      if (command === 'claude' || command === 'agy') {
        return Promise.resolve({ exitCode: 0 } as any);
      }
      return Promise.resolve({ exitCode: 1 } as any);
    });

    const result = await detectAIAssistants();

    expect(byName(result)).toEqual(byName([
      { name: 'claude', displayName: 'Claude Code', detected: true, command: 'claude' },
      { name: 'antigravity', displayName: 'Antigravity', detected: true, command: 'agy' },
      { name: 'codex', displayName: 'OpenAI Codex', detected: false },
      { name: 'copilot', displayName: 'GitHub Copilot', detected: false },
      { name: 'cursor', displayName: 'Cursor', detected: false },
      // pi is a full assistant as of M2; whether it is detected is still the
      // `pi` binary being on PATH, because that is how a terminal session runs.
      { name: 'pi', displayName: 'Pi', detected: false },
      // Credential-only: offered, but with no binary to launch and detected
      // from its env var rather than from PATH.
      { name: 'grok', displayName: 'Grok (xAI)', detected: false },
    ]));
  });

  it('should handle failures gracefully and set detected to false', async () => {
    vi.mocked(execa).mockRejectedValue(new Error('Spawn error'));

    const result = await detectAIAssistants();

    expect(byName(result)).toEqual(byName([
      { name: 'claude', displayName: 'Claude Code', detected: false },
      { name: 'antigravity', displayName: 'Antigravity', detected: false },
      { name: 'codex', displayName: 'OpenAI Codex', detected: false },
      { name: 'copilot', displayName: 'GitHub Copilot', detected: false },
      { name: 'cursor', displayName: 'Cursor', detected: false },
      // pi is a full assistant as of M2; whether it is detected is still the
      // `pi` binary being on PATH, because that is how a terminal session runs.
      { name: 'pi', displayName: 'Pi', detected: false },
      // Credential-only: offered, but with no binary to launch and detected
      // from its env var rather than from PATH.
      { name: 'grok', displayName: 'Grok (xAI)', detected: false },
    ]));
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

describe('grok detection', () => {
  it('is detected from the CLI binary, not from a credential', async () => {
    // The grok CLI signs in interactively on first launch, so gating detection on
    // XAI_API_KEY would hide the harness from anyone not yet signed in.
    const { detectAIAssistants } = await import('./detect-ai.js');
    const saved = process.env.XAI_API_KEY;
    try {
      delete process.env.XAI_API_KEY;
      // execa is mocked suite-wide, so presence has to be declared here.
      vi.mocked(execa).mockImplementation((command: any) =>
        Promise.resolve({ exitCode: command === 'grok' ? 0 : 1 } as any),
      );
      const found = (await detectAIAssistants()).find((entry) => entry.name === 'grok');
      expect(found).toMatchObject({ name: 'grok', displayName: 'Grok (xAI)' });
      expect(found?.detected).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = saved;
    }
  });
});
