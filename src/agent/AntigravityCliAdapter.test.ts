import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  AntigravityCliAdapter,
  buildAntigravityTurnArgs,
  findAntigravitySessionIdForWorkspace,
} from './AntigravityCliAdapter.js';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const CAPTURED_SESSION_ID = '987fcdeb-51a2-43d7-b654-321098765432';

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

describe('findAntigravitySessionIdForWorkspace', () => {
  let tmpDir: string;
  let historyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-'));
    historyFile = path.join(tmpDir, 'history.jsonl');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null if history file does not exist', () => {
    expect(findAntigravitySessionIdForWorkspace('/my/workspace', Date.now(), historyFile)).toBeNull();
  });

  it('locates the newest session matching the workspace directory within timestamp window', () => {
    const now = Date.now();
    const ws = path.join(tmpDir, 'workspace');
    const lines = [
      JSON.stringify({
        display: 'old session',
        timestamp: now - 50000,
        workspace: ws,
        conversationId: '00000000-0000-0000-0000-000000000001',
      }),
      JSON.stringify({
        display: 'other workspace',
        timestamp: now,
        workspace: path.join(tmpDir, 'other'),
        conversationId: '00000000-0000-0000-0000-000000000002',
      }),
      JSON.stringify({
        display: 'new matching session',
        timestamp: now + 50,
        workspace: ws,
        conversationId: CAPTURED_SESSION_ID,
      }),
    ];
    fs.writeFileSync(historyFile, lines.join('\n'), 'utf-8');

    const result = findAntigravitySessionIdForWorkspace(ws, now, historyFile);
    expect(result).toBe(CAPTURED_SESSION_ID);
  });

  it('ignores invalid conversation IDs', () => {
    const now = Date.now();
    const ws = path.join(tmpDir, 'workspace');
    const lines = [
      JSON.stringify({
        display: 'bad id session',
        timestamp: now,
        workspace: ws,
        conversationId: 'not-a-uuid',
      }),
    ];
    fs.writeFileSync(historyFile, lines.join('\n'), 'utf-8');

    expect(findAntigravitySessionIdForWorkspace(ws, now, historyFile)).toBeNull();
  });
});

describe('AntigravityCliAdapter lifecycle', () => {
  let tmpHome: string;
  const originalAgHome = process.env.ANTIGRAVITY_HOME;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-home-'));
    process.env.ANTIGRAVITY_HOME = tmpHome;
  });

  afterEach(() => {
    if (originalAgHome !== undefined) {
      process.env.ANTIGRAVITY_HOME = originalAgHome;
    } else {
      delete process.env.ANTIGRAVITY_HOME;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('resumes an existing provider-assigned session', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace', { id: SESSION_ID, resume: true });
    await adapter.send('first message', 'workspace-write');

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

  it('starts a new conversation, captures session identity from history, and pins turn 2 to --conversation', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    const workspaceDir = path.join(tmpHome, 'workspace');
    await adapter.start(workspaceDir);
    await adapter.send('first message');

    expect(adapter.processes[0].args).toEqual(['--mode', 'plan', '-p', 'first message']);

    // Simulate agy writing to history.jsonl during turn 1
    const historyFile = path.join(tmpHome, 'history.jsonl');
    fs.writeFileSync(
      historyFile,
      JSON.stringify({
        display: 'first message',
        timestamp: Date.now(),
        workspace: workspaceDir,
        conversationId: CAPTURED_SESSION_ID,
      }),
      'utf-8',
    );

    // Complete turn 1
    adapter.processes[0].child.emit('close', 0);

    // Should have captured and emitted the session ID
    expect(sessionEvents).toEqual([CAPTURED_SESSION_ID]);

    // Second turn must now use --conversation <CAPTURED_SESSION_ID>
    await adapter.send('second message');
    expect(adapter.processes).toHaveLength(2);
    expect(adapter.processes[1].args).toEqual([
      '--conversation',
      CAPTURED_SESSION_ID,
      '--mode',
      'plan',
      '-p',
      'second message',
    ]);
  });

  it('gracefully falls back to -c on turn 2 if history is absent', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace');
    await adapter.send('first message');

    expect(sessionEvents).toHaveLength(0);
    expect(adapter.processes[0].args).toEqual(['--mode', 'plan', '-p', 'first message']);

    // Complete turn 1 without writing history
    adapter.processes[0].child.emit('close', 0);

    // Second turn uses -c
    await adapter.send('second message');
    expect(adapter.processes[1].args).toEqual(['-c', '--mode', 'plan', '-p', 'second message']);
  });
});
