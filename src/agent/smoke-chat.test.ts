import { describe, it, expect, vi } from 'vitest';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import { CodexSdkAdapter } from './CodexSdkAdapter.js';
import { formatModelRejectionError } from './models.js';
import type { HarnessAdapter, SessionHandle, HarnessEvent, StartSpec } from '../harness/types.js';

describe('Cross-Engine Chat Smoke Test Suite', () => {
  it('Claude SDK: full chat loop, model override propagation, approval-gating, and usage frames', async () => {
    let capturedSpec: StartSpec | null = null;
    let approvalResponded: { id: string; decision: any } | null = null;

    async function* makeEvents(): AsyncIterable<HarnessEvent> {
      yield { type: 'session_started', sessionId: '11111111-1111-1111-1111-111111111111' };
      yield { type: 'text_delta', text: 'Inspecting workspace auth endpoints...\n' };
      // Trigger approval required for mutating lifecycle tool
      yield {
        type: 'approval_required',
        requestId: 'req-1',
        tool: 'mcp__nexusflow__create_workspace',
        input: { name: 'unauthorized-subworkspace' },
      };
      // Finish turn with usage
      yield {
        type: 'turn_completed',
        usage: {
          inputTokens: 1200,
          outputTokens: 350,
          cachedInputTokens: 500,
          totalTokens: 1550,
          costUsdEstimate: 0.012,
        },
      };
    }

    const fakeClaudeHarness: HarnessAdapter = {
      async start(spec: StartSpec): Promise<SessionHandle> {
        capturedSpec = spec;
        return {
          sessionId: async () => '11111111-1111-1111-1111-111111111111',
          events: makeEvents(),
          send: vi.fn(async () => {}),
          respondToApproval: vi.fn(async (requestId, decision) => {
            approvalResponded = { id: requestId, decision };
          }),
          interrupt: vi.fn(async () => {}),
          dispose: vi.fn(async () => {}),
        };
      },
      resume: vi.fn(),
    };

    const adapter = new ClaudeSdkAdapter(
      undefined,
      fakeClaudeHarness,
    );

    const streamChunks: string[] = [];
    const systemNotes: string[] = [];
    let capturedUsage: any = null;
    let capturedSessionId: string | null = null;

    adapter.on('data', (chunk) => streamChunks.push(chunk));
    adapter.on('system', (msg) => systemNotes.push(msg));
    adapter.on('usage', (u) => { capturedUsage = u; });
    adapter.on('session', (s) => { capturedSessionId = s; });

    adapter.start('/mock/workspace', {
      id: '11111111-1111-1111-1111-111111111111',
      resume: false,
      model: 'claude-3-7-sonnet-latest',
    });
    adapter.send('Kickoff workspace task', 'workspace-write');

    await vi.waitFor(() => {
      expect(capturedSessionId).toBe('11111111-1111-1111-1111-111111111111');
      expect(streamChunks.join('')).toContain('Inspecting workspace auth endpoints');
      expect(capturedSpec?.model).toBe('claude-3-7-sonnet-latest');
      expect(approvalResponded).not.toBeNull();
      expect(approvalResponded?.decision.behavior).toBe('deny');
      expect(approvalResponded?.decision.message).toContain('requires approval and is unavailable in embedded chat');
      expect(systemNotes.some((n) => n.includes('Denied') && n.includes('create_workspace'))).toBe(true);
      expect(capturedUsage).toEqual({
        inputTokens: 1200,
        outputTokens: 350,
        cachedInputTokens: 500,
        totalTokens: 1550,
        costUsdEstimate: 0.012,
      });
    });

    adapter.stop();
  });

  it('Codex SDK: full chat loop, per-stream model honoring, and usage frames', async () => {
    let capturedSpec: StartSpec | null = null;

    async function* makeEvents(): AsyncIterable<HarnessEvent> {
      yield { type: 'session_started', sessionId: '22222222-2222-2222-2222-222222222222' };
      yield { type: 'text_delta', text: 'Executing diagnosed test fixes on Codex...\n' };
      yield {
        type: 'turn_completed',
        usage: {
          inputTokens: 2400,
          outputTokens: 800,
          cachedInputTokens: 1200,
          totalTokens: 3200,
        },
      };
    }

    const fakeCodexHarness: HarnessAdapter = {
      async start(spec: StartSpec): Promise<SessionHandle> {
        capturedSpec = spec;
        return {
          sessionId: async () => '22222222-2222-2222-2222-222222222222',
          events: makeEvents(),
          send: vi.fn(async () => {}),
          respondToApproval: vi.fn(async () => {}),
          interrupt: vi.fn(async () => {}),
          dispose: vi.fn(async () => {}),
        };
      },
      resume: vi.fn(),
    };

    const adapter = new CodexSdkAdapter(
      fakeCodexHarness,
    );

    const streamChunks: string[] = [];
    let capturedUsage: any = null;
    let capturedSessionId: string | null = null;

    adapter.on('data', (chunk) => streamChunks.push(chunk));
    adapter.on('usage', (u) => { capturedUsage = u; });
    adapter.on('session', (s) => { capturedSessionId = s; });

    adapter.start('/mock/workspace', {
      id: '22222222-2222-2222-2222-222222222222',
      resume: false,
      model: 'gpt-5-codex',
    });
    adapter.send('Run diagnosis', 'workspace-write');

    await vi.waitFor(() => {
      expect(capturedSessionId).toBe('22222222-2222-2222-2222-222222222222');
      expect(streamChunks.join('')).toContain('Executing diagnosed test fixes on Codex');
      expect(capturedSpec?.model).toBe('gpt-5-codex');
      expect(capturedUsage).toEqual({
        inputTokens: 2400,
        outputTokens: 800,
        cachedInputTokens: 1200,
        totalTokens: 3200,
      });
    });

    adapter.stop();
  });

  it('Error Frame & Rejection Handling: surfaces model name and actionable guidance when engine rejects model', async () => {
    const invalidModelHarness: HarnessAdapter = {
      async start(spec: StartSpec): Promise<SessionHandle> {
        throw new Error(formatModelRejectionError('codex-cli', spec.model || 'unknown', 'model_not_found'));
      },
      resume: vi.fn(),
    };

    const adapter = new CodexSdkAdapter(
      invalidModelHarness,
    );

    let emittedError: Error | null = null;
    adapter.on('error', (err) => { emittedError = err; });

    adapter.start('/mock/workspace', {
      id: '33333333-3333-3333-3333-333333333333',
      resume: false,
      model: 'invalid-model-x',
    });
    adapter.send('Hello', 'workspace-write');

    await vi.waitFor(() => {
      expect(emittedError).not.toBeNull();
      expect(emittedError?.message).toContain("Model 'invalid-model-x' was rejected by codex-cli");
      expect(emittedError?.message).toContain('Please select a valid model in chat settings or use the default model.');
    });

    adapter.stop();
  });
});
