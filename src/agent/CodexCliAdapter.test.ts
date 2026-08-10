import { describe, expect, it } from 'vitest';

import { buildCodexTurnArgs, CodexJsonlDecoder, decodeCodexLine } from './CodexCliAdapter.js';
import { CodexCliAdapter } from './CodexCliAdapter.js';

const ID = '0199a213-81c0-7800-8aa1-bbab2a035a53';

describe('buildCodexTurnArgs', () => {
  it('starts a JSONL exec turn in a read-only sandbox by default', () => {
    expect(buildCodexTurnArgs(undefined, 'review')).toEqual([
      'exec', '--json', '--color', 'never',
      '-c', 'sandbox_mode="read-only"',
      '-c', 'approval_policy="never"',
      '-',
    ]);
  });

  it('resumes the exact Codex thread id', () => {
    expect(buildCodexTurnArgs(ID, 'review')).toEqual([
      'exec', 'resume', '--json',
      '-c', 'sandbox_mode="read-only"',
      '-c', 'approval_policy="never"',
      ID, '-',
    ]);
  });

  it('uses workspace-write with network and approval escalation disabled', () => {
    expect(buildCodexTurnArgs(undefined, 'workspace-write')).toEqual([
      'exec', '--json', '--color', 'never',
      '-c', 'sandbox_mode="workspace-write"',
      '-c', 'approval_policy="never"',
      '-c', 'sandbox_workspace_write.network_access=false',
      '-',
    ]);
    expect(buildCodexTurnArgs(ID, 'workspace-write')).toEqual([
      'exec', 'resume', '--json',
      '-c', 'sandbox_mode="workspace-write"',
      '-c', 'approval_policy="never"',
      '-c', 'sandbox_workspace_write.network_access=false',
      ID, '-',
    ]);
  });
});

describe('Codex JSONL decoding', () => {
  it('extracts the provider-assigned thread id and completed assistant message', () => {
    const decoder = new CodexJsonlDecoder();
    const first = `{"type":"thread.started","thread_id":"${ID}"}\n`;
    const second = '{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n';

    expect(decoder.push(first.slice(0, 17))).toEqual([]);
    expect(decoder.push(first.slice(17) + second)).toEqual([
      { type: 'session', id: ID },
      { type: 'message', text: 'Done' },
    ]);
  });

  it('flushes a final record without a newline', () => {
    const decoder = new CodexJsonlDecoder();
    decoder.push('{"type":"item.completed","item":{"type":"agent_message","text":"Final"}}');
    expect(decoder.finish()).toEqual([{ type: 'message', text: 'Final' }]);
  });

  it('maps structured failures and ignores malformed or non-user-facing events', () => {
    expect(decodeCodexLine('{"type":"turn.failed","error":{"message":"permission denied"}}'))
      .toEqual([{ type: 'error', message: 'permission denied' }]);
    expect(decodeCodexLine('{not json')).toEqual([]);
    expect(decodeCodexLine('{"type":"turn.started"}')).toEqual([]);
    expect(decodeCodexLine('{"type":"thread.started","thread_id":"bad; echo injected"}')).toEqual([]);
  });
});

class TestCodexCliAdapter extends CodexCliAdapter {
  feed(text: string): boolean {
    return this.handleStdout(text);
  }

  finish(exitCode: number | null): boolean {
    return this.finishStdout(exitCode);
  }
}

describe('Codex turn completion', () => {
  it('surfaces a successful process that produced no recognized response', () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));

    expect(adapter.feed('{not valid json}\n')).toBe(false);
    expect(adapter.finish(0)).toBe(true);
    expect(errors).toEqual([
      expect.stringMatching(/without a recognized response/i),
    ]);
  });

  it('leaves a nonzero no-output exit for the base stderr diagnostic', () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));

    expect(adapter.finish(1)).toBe(false);
    expect(errors).toEqual([]);
  });

  it('does not add a compatibility error after a recognized message', () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));

    expect(adapter.feed('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n')).toBe(true);
    expect(adapter.finish(0)).toBe(false);
    expect(errors).toEqual([]);
  });
});
