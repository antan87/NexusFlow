import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  AntigravityCliAdapter,
  AntigravityJsonlDecoder,
  buildAntigravityTurnArgs,
  decodeAntigravityLine,
  extractNormalizedUsage,
  findAntigravitySessionIdForWorkspace,
} from './AntigravityCliAdapter.js';
import type { NormalizedUsage } from '../harness/types.js';

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
    expect(buildAntigravityTurnArgs(true, 'hello')).toEqual([
      '--output-format',
      'stream-json',
      '--mode',
      'plan',
      '-p',
      'hello',
    ]);
  });

  it('builds subsequent turn arguments without session', () => {
    expect(buildAntigravityTurnArgs(false, 'next turn')).toEqual([
      '--output-format',
      'stream-json',
      '-c',
      '--mode',
      'plan',
      '-p',
      'next turn',
    ]);
  });

  it('does not treat a caller-provided ID as a resumed Antigravity conversation when resume is false', () => {
    expect(buildAntigravityTurnArgs(true, 'hello', { id: SESSION_ID, resume: false })).toEqual([
      '--output-format',
      'stream-json',
      '--mode',
      'plan',
      '-p',
      'hello',
    ]);
  });

  it('builds resumed session arguments', () => {
    expect(buildAntigravityTurnArgs(true, 'hello', { id: SESSION_ID, resume: true })).toEqual([
      '--output-format',
      'stream-json',
      '--conversation',
      SESSION_ID,
      '--mode',
      'plan',
      '-p',
      'hello',
    ]);
  });

  it('applies workspace-write execution profile with --dangerously-skip-permissions', () => {
    expect(
      buildAntigravityTurnArgs(
        true,
        'apply edit',
        { id: SESSION_ID, resume: true },
        'workspace-write',
      ),
    ).toEqual([
      '--output-format',
      'stream-json',
      '--conversation',
      SESSION_ID,
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '-p',
      'apply edit',
    ]);
  });

  it('applies workspace-write execution profile without session', () => {
    expect(
      buildAntigravityTurnArgs(
        true,
        'write file',
        undefined,
        'workspace-write',
      ),
    ).toEqual([
      '--output-format',
      'stream-json',
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '-p',
      'write file',
    ]);

    expect(
      buildAntigravityTurnArgs(
        false,
        'write next',
        undefined,
        'workspace-write',
      ),
    ).toEqual([
      '--output-format',
      'stream-json',
      '-c',
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '-p',
      'write next',
    ]);
  });

  it('passes --model when session.model is set', () => {
    expect(
      buildAntigravityTurnArgs(
        true,
        'run model',
        { id: SESSION_ID, resume: true, model: 'gemini-2.5-pro' },
        'workspace-write',
      ),
    ).toEqual([
      '--output-format',
      'stream-json',
      '--conversation',
      SESSION_ID,
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '--model',
      'gemini-2.5-pro',
      '-p',
      'run model',
    ]);
  });
});

describe('Antigravity stream-json decoding', () => {
  it('decodes chunked init, message, step_update, and result with usage', () => {
    const decoder = new AntigravityJsonlDecoder();
    const stream = [
      `${JSON.stringify({ type: 'init', conversationId: SESSION_ID })}\n`,
      `${JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Analyzing ' } },
      })}\n`,
      `${JSON.stringify({ type: 'step_update', message: 'Reading repository files...' })}\n`,
      `${JSON.stringify({ type: 'message', text: 'codebase' })}\n`,
      `${JSON.stringify({
        type: 'result',
        conversationId: SESSION_ID,
        result: 'Done',
        usage: {
          input_tokens: 1500,
          output_tokens: 250,
          cached_input_tokens: 300,
          cost_usd: 0.005,
        },
      })}\n`,
    ].join('');

    const chunk1 = stream.slice(0, 35);
    const chunk2 = stream.slice(35);

    expect(decoder.push(chunk1)).toEqual([]);
    const events = decoder.push(chunk2);

    expect(events).toEqual([
      { type: 'session', id: SESSION_ID },
      { type: 'message', text: 'Analyzing ' },
      { type: 'step_update', message: 'Reading repository files...' },
      { type: 'message', text: 'codebase' },
      { type: 'session', id: SESSION_ID },
      {
        type: 'result',
        text: 'Done',
        usage: {
          inputTokens: 1500,
          outputTokens: 250,
          cachedInputTokens: 300,
          costUsdEstimate: 0.005,
        },
      },
    ]);
  });

  it('flushes unterminated records and rejects malformed structured output', () => {
    const decoder = new AntigravityJsonlDecoder();
    decoder.push(JSON.stringify({ type: 'message', text: 'Trailing text' }));

    expect(decoder.finish()).toEqual([{ type: 'message', text: 'Trailing text' }]);
    expect(decodeAntigravityLine('{not json')).toEqual([{
      type: 'error',
      message: 'Antigravity emitted malformed structured output.',
      source: 'protocol',
    }]);
    expect(decodeAntigravityLine('[]')).toEqual([{
      type: 'error',
      message: 'Antigravity emitted an invalid structured record.',
      source: 'protocol',
    }]);
  });

  it('fails closed when a structured record exceeds the buffer limit', () => {
    const decoder = new AntigravityJsonlDecoder(32);
    expect(decoder.push(`{"type":"message","text":"${'a'.repeat(32)}`)).toEqual([{
      type: 'error',
      message: 'Antigravity structured output exceeded the supported record size.',
      source: 'protocol',
    }]);
    expect(decoder.finish()).toEqual([]);
  });

  it('correctly maps error events from provider and result failures', () => {
    expect(decodeAntigravityLine(JSON.stringify({
      type: 'error',
      error: { message: 'Quota exceeded for gemini-2.5-pro' },
    }))).toEqual([
      { type: 'error', message: 'Quota exceeded for gemini-2.5-pro', source: 'provider' },
    ]);

    expect(decodeAntigravityLine(JSON.stringify({
      type: 'result',
      subtype: 'error',
      errors: ['Permission was denied for tool execution'],
    }))).toEqual([
      { type: 'error', message: 'Permission was denied for tool execution', source: 'provider' },
    ]);
  });

  it('extracts and normalizes token usage from various schemas', () => {
    const usage1 = extractNormalizedUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cached_tokens: 25,
      total_cost_usd: 0.001,
    });
    expect(usage1).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cachedInputTokens: 25,
      costUsdEstimate: 0.001,
    });

    const usage2 = extractNormalizedUsage({
      input_token_count: 500,
      output_token_count: 80,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 50,
    });
    expect(usage2).toEqual({
      inputTokens: 500,
      outputTokens: 80,
      cachedInputTokens: 150,
    });
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

  it('delivers prompts via argv and resumes an existing provider-assigned session', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    await adapter.start('/workspace', { id: SESSION_ID, resume: true, model: 'gemini-2.5-flash' });
    await adapter.send('first message', 'workspace-write');

    expect(sessionEvents).toHaveLength(0);
    expect(adapter.processes).toHaveLength(1);
    expect(adapter.processes[0].args).toEqual([
      '--output-format',
      'stream-json',
      '--add-dir',
      '/workspace',
      '--conversation',
      SESSION_ID,
      '--mode',
      'accept-edits',
      '--dangerously-skip-permissions',
      '--model',
      'gemini-2.5-flash',
      '-p',
      'first message',
    ]);
  });

  it('streams message, system step updates, usage, and captures session from stream-json events', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    const dataChunks: string[] = [];
    const systemNotes: string[] = [];
    let usageResult: NormalizedUsage | undefined;

    adapter.on('session', (id) => sessionEvents.push(id));
    adapter.on('data', (text) => dataChunks.push(text));
    adapter.on('system', (msg) => systemNotes.push(msg));
    adapter.on('usage', (u) => { usageResult = u; });

    await adapter.start('/workspace');
    await adapter.send('generate unit tests');

    expect(adapter.processes[0].args).toEqual([
      '--output-format',
      'stream-json',
      '--add-dir',
      '/workspace',
      '--mode',
      'plan',
      '-p',
      'generate unit tests',
    ]);

    const child = adapter.processes[0].child;

    // Simulate stream-json events from agy
    child.stdout.emit('data', JSON.stringify({ type: 'init', conversationId: CAPTURED_SESSION_ID }) + '\n');
    expect(sessionEvents).toEqual([CAPTURED_SESSION_ID]);

    child.stdout.emit('data', JSON.stringify({ type: 'step_update', message: 'Analyzing project...' }) + '\n');
    expect(systemNotes).toEqual(['Analyzing project...']);

    child.stdout.emit('data', JSON.stringify({
      type: 'stream_event',
      event: { delta: { text: 'Here are the tests' } },
    }) + '\n');
    expect(dataChunks).toEqual(['Here are the tests']);

    child.stdout.emit('data', JSON.stringify({
      type: 'result',
      conversationId: CAPTURED_SESSION_ID,
      usage: { input_tokens: 200, output_tokens: 100 },
    }) + '\n');

    expect(usageResult).toEqual({
      inputTokens: 200,
      outputTokens: 100,
    });

    child.emit('close', 0);

    // Second turn should now automatically use --conversation <CAPTURED_SESSION_ID>
    await adapter.send('second message');
    expect(adapter.processes).toHaveLength(2);
    expect(adapter.processes[1].args).toEqual([
      '--output-format',
      'stream-json',
      '--add-dir',
      '/workspace',
      '--conversation',
      CAPTURED_SESSION_ID,
      '--mode',
      'plan',
      '-p',
      'second message',
    ]);
  });

  it('starts a new conversation, captures session identity from history file if omitted in stream, and pins turn 2', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const sessionEvents: string[] = [];
    adapter.on('session', (id) => sessionEvents.push(id));

    const workspaceDir = path.join(tmpHome, 'workspace');
    await adapter.start(workspaceDir);
    await adapter.send('first message');

    expect(adapter.processes[0].args).toEqual([
      '--output-format',
      'stream-json',
      '--add-dir',
      workspaceDir,
      '--mode',
      'plan',
      '-p',
      'first message',
    ]);

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
    adapter.processes[0].child.stdout.emit('data', JSON.stringify({
      type: 'result',
      result: 'First turn completed',
    }) + '\n');
    adapter.processes[0].child.emit('close', 0);

    // Should have captured and emitted the session ID
    expect(sessionEvents).toEqual([CAPTURED_SESSION_ID]);

    // Second turn must now use --conversation <CAPTURED_SESSION_ID>
    await adapter.send('second message');
    expect(adapter.processes).toHaveLength(2);
    expect(adapter.processes[1].args).toEqual([
      '--output-format',
      'stream-json',
      '--add-dir',
      workspaceDir,
      '--conversation',
      CAPTURED_SESSION_ID,
      '--mode',
      'plan',
      '-p',
      'second message',
    ]);
  });

  it('rejects conflicting session identities emitted by the provider', async () => {
    const adapter = new TestAntigravityCliAdapter();
    const errors: string[] = [];
    adapter.on('error', (err: Error) => errors.push(err.message));

    await adapter.start('/workspace', { id: SESSION_ID, resume: true });
    await adapter.send('message');

    // agy returns a conflicting session identity
    adapter.processes[0].child.stdout.emit('data', JSON.stringify({
      type: 'init',
      conversationId: '00000000-0000-0000-0000-000000000009',
    }) + '\n');
    adapter.processes[0].child.emit('close', 0);

    expect(errors).toEqual([
      'Antigravity returned a conflicting session identity. The unexpected identity was rejected; the acknowledged session remains resumable.',
    ]);
  });
});

