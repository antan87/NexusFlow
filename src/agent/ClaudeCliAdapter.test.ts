import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import {
  ClaudeCliAdapter,
  ClaudeJsonlDecoder,
  decodeClaudeLine,
} from './ClaudeCliAdapter.js';

const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000';
const OTHER_SESSION_ID = '123e4567-e89b-42d3-a456-426614174001';
const STREAM_ARGS = [
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
];

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

function initRecord(sessionId = SESSION_ID): string {
  return `${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })}\n`;
}

function successRecord(sessionId = SESSION_ID, result = 'Done'): string {
  return `${JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: sessionId,
    result,
  })}\n`;
}

describe('Claude stream-json decoding', () => {
  it('decodes chunked session, text delta, retry, and completion records', () => {
    const decoder = new ClaudeJsonlDecoder();
    const stream = [
      initRecord(),
      `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      })}\n`,
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5 })}\n`,
      successRecord(),
    ].join('');

    expect(decoder.push(stream.slice(0, 29))).toEqual([]);
    expect(decoder.push(stream.slice(29))).toEqual([
      { type: 'session', id: SESSION_ID },
      { type: 'message', text: 'Hello' },
      { type: 'system', message: 'Claude is retrying the request (attempt 2 of 5).' },
      { type: 'session', id: SESSION_ID },
      { type: 'complete', text: 'Done' },
    ]);
  });

  it('flushes an unterminated record and rejects malformed structured output', () => {
    const decoder = new ClaudeJsonlDecoder();
    decoder.push(JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Final' } },
    }));

    expect(decoder.finish()).toEqual([{ type: 'message', text: 'Final' }]);
    expect(decodeClaudeLine('{not json')).toEqual([{
      type: 'error',
      message: 'Claude emitted malformed structured output.',
      source: 'protocol',
    }]);
    expect(decodeClaudeLine('[]')).toEqual([{
      type: 'error',
      message: 'Claude emitted an invalid structured record.',
      source: 'protocol',
    }]);
  });

  it('fails closed when one structured record exceeds the buffer limit', () => {
    const decoder = new ClaudeJsonlDecoder(32);

    expect(decoder.push(`{"type":"unknown","padding":"${'x'.repeat(32)}`)).toEqual([{
      type: 'error',
      message: 'Claude structured output exceeded the supported record size.',
      source: 'protocol',
    }]);
    expect(decoder.push(`"}\n${successRecord()}`)).toEqual([]);
    expect(decoder.finish()).toEqual([]);
  });

  it('maps structured failures without exposing arbitrary object fields', () => {
    expect(decodeClaudeLine(JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      session_id: SESSION_ID,
      errors: ['Permission was denied'],
      secret: 'do-not-render',
    }))).toEqual([
      { type: 'session', id: SESSION_ID },
      { type: 'error', message: 'Permission was denied', source: 'provider' },
    ]);

    expect(decodeClaudeLine(JSON.stringify({
      type: 'result',
      subtype: 'attacker-controlled metadata',
      session_id: SESSION_ID,
    }))).toEqual([
      { type: 'session', id: SESSION_ID },
      { type: 'error', message: 'Claude could not complete the turn.', source: 'provider' },
    ]);
  });
});

describe('ClaudeCliAdapter acknowledged session lifecycle', () => {
  it('retries a failed new turn with --session-id until Claude acknowledges it', async () => {
    const adapter = new TestClaudeCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Try to start');
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Retry the start');

    expect(adapter.processes.map(process => process.args)).toEqual([
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID],
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID],
    ]);
    expect(errors).toEqual(['claude CLI exited with code 1']);
  });

  it('does not retry a failed explicit resume as a new session', async () => {
    const adapter = new TestClaudeCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));

    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: true });
    await adapter.send('Continue from the saved context');
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Retry the exact resume');

    expect(adapter.processes.map(process => process.args)).toEqual([
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', SESSION_ID],
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', SESSION_ID],
    ]);
    expect(errors).toEqual(['claude CLI exited with code 1']);
  });

  it('acknowledges the requested session, streams once, then resumes with the next profile', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const data: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('data', (text: string) => data.push(text));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Inspect first', 'review');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(initRecord()));
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } },
      })}\n${successRecord()}`,
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Now edit', 'workspace-write');

    expect(adapter.processes.map(process => process.args)).toEqual([
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID],
      ['-p', ...STREAM_ARGS, '--permission-mode', 'acceptEdits', '--resume', SESSION_ID],
    ]);
    expect(sessions).toEqual([SESSION_ID]);
    expect(data).toEqual(['Done']);
  });

  it('resumes the acknowledged session after a structured provider failure', async () => {
    const adapter = new TestClaudeCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start the session');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      initRecord() + `${JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        session_id: SESSION_ID,
        errors: ['Temporary provider failure'],
      })}\n`,
    ));
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Resume after failure');

    expect(errors).toEqual(['Temporary provider failure']);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', SESSION_ID,
    ]);
  });

  it('retains the acknowledged id when a later result returns a conflicting identity', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start the session');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      initRecord() + successRecord(OTHER_SESSION_ID),
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Resume the acknowledged session');

    expect(sessions).toEqual([SESSION_ID]);
    expect(errors).toEqual([
      'Claude returned a conflicting session identity. The unexpected identity was rejected; the acknowledged session remains resumable.',
    ]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', SESSION_ID,
    ]);
  });

  it('accepts canonicalized casing while retaining the requested session id', async () => {
    const adapter = new TestClaudeCliAdapter();
    const upperSessionId = SESSION_ID.toUpperCase();
    const sessions: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    await adapter.start('C:\\workspace', { id: upperSessionId, resume: false });

    await adapter.send('Start the session');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(initRecord() + successRecord()));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Resume the session');

    expect(sessions).toEqual([upperSessionId]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', upperSessionId,
    ]);
  });

  it('rejects a mismatched provider session and keeps the new session retryable', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      initRecord(OTHER_SESSION_ID) + successRecord(OTHER_SESSION_ID),
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Retry safely');

    expect(sessions).toEqual([]);
    expect(errors).toEqual([
      'Claude returned an unexpected session identity. The turn was not marked resumable.',
    ]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID,
    ]);
  });

  it('does not accept a later id after a malformed init record', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(
      `${JSON.stringify({ type: 'system', subtype: 'init' })}\n${successRecord()}`,
    ));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Retry safely');

    expect(sessions).toEqual([]);
    expect(errors).toEqual([
      'Claude started without a valid session identity. The turn was not marked resumable.',
    ]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID,
    ]);
  });

  it('keeps an acknowledged session resumable after later malformed output', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(`${initRecord()}{not json}\n`));
    adapter.processes[0].child.emit('close', 1);
    await adapter.send('Resume the acknowledged session');

    expect(sessions).toEqual([SESSION_ID]);
    expect(errors).toEqual([
      'Claude emitted malformed structured output. The acknowledged session remains resumable.',
    ]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', SESSION_ID,
    ]);
  });

  it('does not accept a valid result after malformed JSONL output', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    const errors: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Start safely');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(`{not json}\n${successRecord()}`));
    await adapter.send('Do not overlap the failed process');

    expect(errors).toEqual([]);
    expect(adapter.processes).toHaveLength(1);

    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Retry safely');

    expect(sessions).toEqual([]);
    expect(errors).toEqual([
      'Claude emitted malformed structured output. The turn was not marked resumable.',
    ]);
    expect(adapter.processes[1].args).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', SESSION_ID,
    ]);
  });

  it('keeps the legacy auto-assigned session continuation path working', async () => {
    const adapter = new TestClaudeCliAdapter();
    const sessions: string[] = [];
    adapter.on('session', (id: string) => sessions.push(id));
    await adapter.start('C:\\workspace');

    await adapter.send('Start legacy session');
    adapter.processes[0].child.stdout.emit('data', Buffer.from(initRecord() + successRecord()));
    adapter.processes[0].child.emit('close', 0);
    await adapter.send('Continue legacy session');

    expect(sessions).toEqual([SESSION_ID]);
    expect(adapter.processes.map(process => process.args)).toEqual([
      ['-p', ...STREAM_ARGS, '--permission-mode', 'plan'],
      ['-c', '-p', ...STREAM_ARGS, '--permission-mode', 'plan'],
    ]);
  });

  it('surfaces a successful process with no recognized structured result', async () => {
    const adapter = new TestClaudeCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (error: Error) => errors.push(error.message));
    await adapter.start('C:\\workspace', { id: SESSION_ID, resume: false });

    await adapter.send('Inspect');
    adapter.processes[0].child.stdout.emit('data', Buffer.from('{"type":"assistant"}\n'));
    adapter.processes[0].child.emit('close', 0);

    expect(errors).toEqual([
      expect.stringMatching(/without a recognized result/i),
    ]);
  });
});
