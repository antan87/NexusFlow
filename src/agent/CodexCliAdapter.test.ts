import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  buildCodexTurnArgs,
  CodexCliAdapter,
  CodexJsonlDecoder,
  decodeCodexLine,
} from './CodexCliAdapter.js';

const ID = '0199a213-81c0-7800-8aa1-bbab2a035a53';
const OTHER_ID = '0199a213-81c0-7800-8aa1-bbab2a035a54';

function threadRecord(id = ID): string {
  return `${JSON.stringify({ type: 'thread.started', thread_id: id })}\n`;
}

function messageRecord(text = 'Done'): string {
  return `${JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text },
  })}\n`;
}

function completeRecord(): string {
  return `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1 } })}\n`;
}

function failureRecord(message = 'Permission denied'): string {
  return `${JSON.stringify({ type: 'turn.failed', error: { message } })}\n`;
}

class FakeChild extends EventEmitter {
  stdin = { write: vi.fn(), end: vi.fn() };
  stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  pid: number | undefined;
}

class TestCodexCliAdapter extends CodexCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];

  protected spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

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
  it('extracts a chunked thread id and completed assistant message', () => {
    const decoder = new CodexJsonlDecoder();
    const stream = threadRecord() + messageRecord() + completeRecord();

    expect(decoder.push(stream.slice(0, 17))).toEqual([]);
    expect(decoder.push(stream.slice(17))).toEqual([
      { type: 'session', id: ID },
      { type: 'message', text: 'Done' },
      { type: 'complete' },
    ]);
  });

  it('flushes a final record without a newline', () => {
    const decoder = new CodexJsonlDecoder();
    decoder.push(messageRecord('Final').trimEnd());

    expect(decoder.finish()).toEqual([{ type: 'message', text: 'Final' }]);
  });

  it('fails closed for malformed records and invalid thread identities', () => {
    expect(decodeCodexLine('{not json')).toEqual([{
      type: 'error',
      message: 'Codex emitted malformed structured output.',
      source: 'protocol',
    }]);
    expect(decodeCodexLine('[]')).toEqual([{
      type: 'error',
      message: 'Codex emitted an invalid structured record.',
      source: 'protocol',
    }]);
    expect(decodeCodexLine('{"type":"thread.started","thread_id":"bad; echo injected"}'))
      .toEqual([{
        type: 'error',
        message: 'Codex started without a valid thread identity.',
        source: 'protocol',
      }]);
  });

  it('caps one structured record and stays failed afterward', () => {
    const decoder = new CodexJsonlDecoder(32);

    expect(decoder.push(`{"type":"unknown","padding":"${'x'.repeat(32)}`)).toEqual([{
      type: 'error',
      message: 'Codex structured output exceeded the supported record size.',
      source: 'protocol',
    }]);
    expect(decoder.push(`"}\n${threadRecord()}`)).toEqual([]);
    expect(decoder.finish()).toEqual([]);
  });

  it('bounds provider error strings and never stringifies arbitrary metadata', () => {
    const longMessage = `Denied ${'x'.repeat(3_000)}`;
    const [bounded] = decodeCodexLine(failureRecord(longMessage));
    expect(bounded).toMatchObject({ type: 'error', source: 'provider' });
    expect(bounded.type === 'error' && bounded.message).toHaveLength(2_000);

    expect(decodeCodexLine(JSON.stringify({
      type: 'turn.failed',
      error: { metadata: { secret: 'do-not-render' } },
      message: { arbitrary: 'object' },
    }))).toEqual([{
      type: 'error',
      message: 'Codex could not complete the turn.',
      source: 'provider',
    }]);
  });

  it('ignores valid non-user-facing events', () => {
    expect(decodeCodexLine('{"type":"turn.started"}')).toEqual([]);
  });
});

describe('Codex acknowledged thread lifecycle', () => {
  it('uses the requested resume id even when input follows start immediately', async () => {
    const adapter = new TestCodexCliAdapter();

    const starting = adapter.start('C:\\workspace', { id: ID, resume: true });
    await adapter.send('Resume without waiting for transport setup');
    await starting;

    expect(adapter.processes).toHaveLength(1);
    expect(adapter.processes[0].args).toContain(ID);
    expect(adapter.processes[0].args.slice(0, 3)).toEqual(['exec', 'resume', '--json']);
  });

  it('acknowledges a new thread, returns its message, then resumes the exact id', async () => {
    const adapter = new TestCodexCliAdapter();
    const sessions: string[] = [];
    const data: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('data', (text: string) => data.push(text));
    await adapter.start('C:\\workspace');

    await adapter.send('Inspect', 'review');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      threadRecord() + messageRecord() + completeRecord(),
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Apply', 'workspace-write');

    expect(adapter.processes[0].child.stdout.setEncoding).toHaveBeenCalledWith('utf8');
    expect(adapter.processes.map(process => process.args)).toEqual([
      [
        'exec', '--json', '--color', 'never',
        '-c', 'sandbox_mode="read-only"',
        '-c', 'approval_policy="never"',
        '-',
      ],
      [
        'exec', 'resume', '--json',
        '-c', 'sandbox_mode="workspace-write"',
        '-c', 'approval_policy="never"',
        '-c', 'sandbox_workspace_write.network_access=false',
        ID, '-',
      ],
    ]);
    expect(sessions).toEqual([ID]);
    expect(data).toEqual(['Done']);
  });

  it('keeps a malformed pre-ack turn busy until settlement, then retries as new', async () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    const idle: number[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    adapter.on('idle', () => idle.push(1));
    await adapter.start('C:\\workspace');

    await adapter.send('Start');
    adapter.processes[0].child.stdout.emit('data', Buffer.from('{not json}\n'));
    await adapter.send('Must not overlap');

    expect(errors).toEqual([]);
    expect(idle).toEqual([]);
    expect(adapter.processes).toHaveLength(1);

    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Retry after settlement');

    expect(errors).toEqual([
      'Codex emitted malformed structured output. The turn was not marked resumable.',
    ]);
    expect(idle).toHaveLength(1);
    expect(adapter.processes[1].args.slice(0, 4)).toEqual(['exec', '--json', '--color', 'never']);
  });

  it('rejects successful output before a new thread is acknowledged', async () => {
    const adapter = new TestCodexCliAdapter();
    const data: string[] = [];
    const errors: string[] = [];
    adapter.on('data', (text: string) => data.push(text));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Start');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(messageRecord()));
    adapter.processes[0].child.emit('close', 0);

    expect(data).toEqual([]);
    expect(errors).toEqual([
      'Codex completed output without acknowledging a thread identity. The turn was not marked resumable.',
    ]);
  });

  it('accepts UUID case canonicalization and retains the exact requested resume id', async () => {
    const adapter = new TestCodexCliAdapter();
    const requestedId = ID.toUpperCase();
    const sessions: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    await adapter.start('C:\\workspace', { id: requestedId, resume: true });

    await adapter.send('Resume');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      threadRecord() + messageRecord() + completeRecord(),
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Continue');

    expect(sessions).toEqual([requestedId]);
    expect(adapter.processes[1].args).toContain(requestedId);
  });

  it('rejects a conflicting resume identity and keeps the requested id active', async () => {
    const adapter = new TestCodexCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: ID, resume: true });

    await adapter.send('Resume safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(threadRecord(OTHER_ID)));
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Retry the requested session');

    expect(sessions).toEqual([]);
    expect(errors).toEqual([
      'Codex returned a conflicting thread identity. The unexpected identity was rejected; the active session remains resumable.',
    ]);
    expect(adapter.processes[1].args).toContain(ID);
  });

  it('rejects a later identity change and resumes only the acknowledged id', async () => {
    const adapter = new TestCodexCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Start safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      threadRecord() + threadRecord(OTHER_ID) + messageRecord(),
    ));
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Resume safely');

    expect(sessions).toEqual([ID]);
    expect(errors).toEqual([
      'Codex returned a conflicting thread identity. The unexpected identity was rejected; the active session remains resumable.',
    ]);
    expect(adapter.processes[1].args).toContain(ID);
  });

  it('resumes an acknowledged thread after a structured provider failure', async () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Start');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(threadRecord() + failureRecord()));
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Resume');

    expect(errors).toEqual(['Permission denied']);
    expect(adapter.processes[1].args).toContain(ID);
  });

  it('reports a crash after assistant output but before turn.completed', async () => {
    const adapter = new TestCodexCliAdapter();
    const data: string[] = [];
    const errors: string[] = [];
    adapter.on('data', (text: string) => data.push(text));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Start');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(threadRecord() + messageRecord('Partial')));
    adapter.processes[0].child.emit('close', 1);

    expect(data).toEqual(['Partial']);
    expect(errors).toEqual([
      'Codex CLI ended before confirming turn completion. The active session remains resumable.',
    ]);
  });

  it('rejects turn.completed without a recognizable assistant response', async () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Start');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(threadRecord() + completeRecord()));
    adapter.processes[0].child.emit('close', 0);

    expect(errors).toEqual([
      'Codex completed without a recognizable assistant response. The active session remains resumable.',
    ]);
  });

  it('surfaces a successful process with no recognized structured response', async () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Inspect');
    adapter.processes[0].child.stdout.emit('data', Buffer.from('{"type":"turn.started"}\n'));
    adapter.processes[0].child.emit('close', 0);

    expect(errors).toEqual([expect.stringMatching(/without a recognized response/i)]);
  });

  it('leaves a nonzero no-output exit for the base stderr diagnostic', async () => {
    const adapter = new TestCodexCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace');

    await adapter.send('Inspect');
    adapter.processes[0].child.emit('close', 1);

    expect(errors).toEqual(['Codex CLI exited with code 1']);
  });
});
