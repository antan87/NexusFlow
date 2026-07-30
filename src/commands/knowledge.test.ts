import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { checkEntryLength, knowledgeAddCommand } from './knowledge.js';
import * as knowledge from '../core/knowledge.js';
import { MAX_ENTRY_CHARS } from '../core/knowledge.js';
import * as resolve from '../utils/resolve-workspace.js';

vi.mock('../core/knowledge.js', async (importOriginal) => {
  // Keep MAX_ENTRY_CHARS real — the point is that the command and the core
  // writers agree on one limit.
  const actual = await importOriginal<typeof import('../core/knowledge.js')>();
  return {
    ...actual,
    addWorkspaceKnowledge: vi.fn(),
    addBaseKnowledge: vi.fn(),
  };
});
vi.mock('../utils/resolve-workspace.js');

/** A message of exactly `length` characters. */
function messageOf(length: number): string {
  return 'x'.repeat(length);
}

describe('knowledge entry length cap', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('checkEntryLength', () => {
    it('accepts an entry at the limit', () => {
      expect(checkEntryLength(messageOf(MAX_ENTRY_CHARS))).toBe(true);
    });

    it('rejects an entry one character over', () => {
      expect(checkEntryLength(messageOf(MAX_ENTRY_CHARS + 1))).toBe(false);
    });

    it('measures the collapsed length, so padding cannot smuggle length in', () => {
      expect(checkEntryLength(`   ${messageOf(MAX_ENTRY_CHARS)}   `)).toBe(true);
    });

    it('reports the actual length and the limit, so the fix is obvious', () => {
      checkEntryLength(messageOf(1200));

      const reported = vi.mocked(console.error).mock.calls.flat().join(' ');
      expect(reported).toContain('1200');
      expect(reported).toContain(String(MAX_ENTRY_CHARS));
    });

    it('says what to do instead of just refusing', () => {
      checkEntryLength(messageOf(1200));

      const advice = vi.mocked(console.log).mock.calls.flat().join(' ');
      expect(advice).toMatch(/separate entries/i);
    });
  });

  describe('knowledgeAddCommand', () => {
    it('writes nothing when the entry is too long', async () => {
      await knowledgeAddCommand('/ws', { type: 'decision', message: messageOf(1200) });

      expect(knowledge.addWorkspaceKnowledge).not.toHaveBeenCalled();
      expect(knowledge.addBaseKnowledge).not.toHaveBeenCalled();
    });

    it('rejects before prompting for a workspace, so it fails fast', async () => {
      await knowledgeAddCommand(undefined, { type: 'decision', message: messageOf(1200) });

      expect(resolve.resolveWorkspaceInteractive).not.toHaveBeenCalled();
    });

    it('records an entry within the limit', async () => {
      vi.mocked(resolve.resolveWorkspaceInteractive).mockResolvedValue('/ws');
      vi.mocked(knowledge.addWorkspaceKnowledge).mockResolvedValue({
        location: '/ws/nexusflow-knowledge.md',
        section: 'Architecture Decisions',
        createdFile: false,
      });

      await knowledgeAddCommand('/ws', {
        type: 'decision',
        message: 'Generate only what an agent cannot grep — derived facts go stale.',
      });

      expect(knowledge.addWorkspaceKnowledge).toHaveBeenCalledOnce();
    });
  });
});
