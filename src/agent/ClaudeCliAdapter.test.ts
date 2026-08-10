import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeCliAdapter } from './ClaudeCliAdapter.js';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

class FakeChild extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  pid: number | undefined;
}

class TestClaudeCliAdapter extends ClaudeCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];

  protected spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

describe('ClaudeCliAdapter', () => {
  it('does not retry a failed explicit resume as a new session', async () => {
    const adapter = new TestClaudeCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));

    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: true });
    await adapter.send('Continue from the saved context');

    expect(adapter.processes).toHaveLength(1);
    expect(adapter.processes[0].args).toEqual(['-p', '--resume', SESSION_ID]);

    adapter.processes[0].child.emit('close', 1);

    expect(adapter.processes).toHaveLength(1);
    expect(errors).toEqual(['claude CLI exited with code 1']);
  });
});
