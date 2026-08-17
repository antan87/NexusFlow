import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  AntigravityCliAdapter,
  buildAntigravityTurnArgs,
} from './AntigravityCliAdapter.js';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';

class FakeChild extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  pid: number | undefined;
}

class TestAntigravityCliAdapter extends AntigravityCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];

  protected spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

describe('buildAntigravityTurnArgs', () => {
  it('builds first turn arguments without session', () => {
    expect(buildAntigravityTurnArgs(true, 'hello world')).toEqual([
      '--mode',
      'plan',
      '-p',
      'hello world',
    ]);
  });

  it('builds subsequent turn arguments without session', () => {
    expect(buildAntigravityTurnArgs(false, 'next prompt')).toEqual([
      '-c',
      '--mode',
      'plan',
      '-p',
      'next prompt',
    ]);
  });

  it('does not treat a caller-provided ID as a new Antigravity conversation', () => {
    expect(buildAntigravityTurnArgs(true, 'hello world', { id: SESSION_ID, resume: false })).toEqual([
      '--mode',
      'plan',
      '-p',
      'hello world',
    ]);
  });

  it('builds resumed session arguments', () => {
    expect(buildAntigravityTurnArgs(true, 'resumed prompt', { id: SESSION_ID, resume: true })).toEqual([
      '--conversation',
      SESSION_ID,
      '--mode',
      'plan',
      '-p',
      'resumed prompt',
    ]);
  });

  it('applies workspace-write execution profile with session', () => {
    expect(
      buildAntigravityTurnArgs(
        true,
        'edit prompt',
        { id: SESSION_ID, resume: true },
        'workspace-write',
      ),
    ).toEqual([
      '--conversation',
      SESSION_ID,
      '--mode',
      'accept-edits',
      '-p',
      'edit prompt',
    ]);
  });

  it('applies workspace-write execution profile without session', () => {
    expect(
      buildAntigravityTurnArgs(
        true,
        'edit prompt',
        undefined,
        'workspace-write',
      ),
    ).toEqual([
      '--mode',
      'accept-edits',
      '-p',
      'edit prompt',
    ]);

    expect(
      buildAntigravityTurnArgs(
        false,
        'edit prompt 2',
        undefined,
        'workspace-write',
      ),
    ).toEqual([
      '-c',
      '--mode',
      'accept-edits',
      '-p',
      'edit prompt 2',
    ]);
  });
});

describe('AntigravityCliAdapter lifecycle', () => {
  it('resumes an existing provider-assigned session', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace', { id: SESSION_ID, resume: true });
    await adapter.send('first message', 'workspace-write');

    // Plain-text print mode does not expose the id of a newly created
    // conversation. The requested resume id remains frontend-owned.
    expect(sessionEvents).toHaveLength(0);
    expect(adapter.processes).toHaveLength(1);
    expect(adapter.processes[0].args).toEqual([
      '--conversation',
      SESSION_ID,
      '--mode',
      'accept-edits',
      '-p',
      'first message',
    ]);
  });

  it('starts a new conversation when a non-resume identity is supplied', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace', { id: SESSION_ID, resume: false });
    await adapter.send('first message');

    expect(sessionEvents).toHaveLength(0);
    expect(adapter.processes[0].args).toEqual(['--mode', 'plan', '-p', 'first message']);
  });

  it('does not emit session event if no session is provided', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace');
    await adapter.send('first message');

    expect(sessionEvents).toHaveLength(0);
    expect(adapter.processes[0].args).toEqual(['--mode', 'plan', '-p', 'first message']);

    // Complete the first turn so the adapter is ready for the second turn
    adapter.processes[0].child.emit('close', 0);

    // Second turn uses -c
    await adapter.send('second message');
    expect(adapter.processes[1].args).toEqual(['-c', '--mode', 'plan', '-p', 'second message']);
  });
});
