import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

import {
  extractCodexUsage,
  decodeCodexLine,
  CodexCliAdapter,
} from './CodexCliAdapter.js';
import {
  extractAcpUsage,
  AcpCliAdapter,
  type AcpConnection,
  type AcpTransportFactory,
} from './AcpCliAdapter.js';
import {
  extractNormalizedUsage,
  decodeAntigravityLine,
  parseAntigravityQuotaError,
  AntigravityCliAdapter,
} from './AntigravityCliAdapter.js';
import {
  decodeClaudeLine,
  ClaudeCliAdapter,
} from './ClaudeCliAdapter.js';
import { ClaudeCodeAdapter } from '../harness/claude.js';
import { CodexAdapter } from '../harness/codex.js';
import type { NormalizedUsage, NormalizedRemainingQuota } from '../harness/types.js';

const SESSION_UUID = '123e4567-e89b-42d3-a456-426614174000';

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

class TestClaudeCliAdapter extends ClaudeCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];
  protected spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

class TestAntigravityCliAdapter extends AntigravityCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];
  protected spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

function makeAcpHarness(connection: AcpConnection) {
  const child = new FakeChild();
  let client: any;
  const factory: AcpTransportFactory = vi.fn((options) => {
    client = options.client;
    return { process: child as unknown as ChildProcess, connection };
  });
  const harness = new AcpCliAdapter({
    executable: 'copilot',
    args: ['--acp'],
    label: 'GitHub Copilot CLI',
    validateSessionId: () => true,
    transportFactory: factory,
  });
  return { harness, child, getClient: () => client };
}

describe('Empirical Adversarial Stress Tests: Milestone 1 Telemetry', () => {

  describe('1. extractCodexUsage Robustness', () => {
    it('handles empty and partial records safely without crash', () => {
      const res = extractCodexUsage({});
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.costConfidence).toBe('absent');
      expect(Number.isNaN(res.inputTokens)).toBe(false);
      expect(Number.isNaN(res.totalTokens)).toBe(false);
    });

    it('handles non-number and unexpected types without throwing', () => {
      const malformed = {
        input_tokens: "100",
        output_tokens: null,
        cached_input_tokens: [],
        cache_write_input_tokens: {},
        reasoning_output_tokens: false,
        total_tokens: true,
      };
      const res = extractCodexUsage(malformed as any);
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.cacheReadInputTokens).toBeUndefined();
      expect(res.cacheWriteInputTokens).toBeUndefined();
      expect(res.reasoningOutputTokens).toBeUndefined();
      expect(Number.isNaN(res.totalTokens)).toBe(false);
    });

    it('identifies NaN propagation flaw when NaN is passed into extractCodexUsage', () => {
      const nanUsage = extractCodexUsage({
        input_tokens: NaN,
        output_tokens: 10,
      });
      // Flaw: typeof NaN === 'number' evaluates to true in JavaScript!
      expect(Number.isNaN(nanUsage.inputTokens)).toBe(true);
      expect(Number.isNaN(nanUsage.totalTokens)).toBe(true);
    });

    it('handles massive numbers (>10^9 tokens) safely', () => {
      const massive = extractCodexUsage({
        input_tokens: 5_000_000_000,
        output_tokens: 2_000_000_000,
        cached_input_tokens: 1_000_000_000,
        cache_write_input_tokens: 500_000_000,
        reasoning_output_tokens: 300_000_000,
      });
      expect(massive.inputTokens).toBe(5_000_000_000);
      expect(massive.outputTokens).toBe(2_000_000_000);
      expect(massive.cachedInputTokens).toBe(1_500_000_000);
      expect(massive.totalTokens).toBe(7_000_000_000);
      expect(massive.reasoningOutputTokens).toBe(300_000_000);
      expect(Number.isFinite(massive.totalTokens)).toBe(true);
    });

    it('handles negative numbers safely without crashing', () => {
      const negative = extractCodexUsage({
        input_tokens: -100,
        output_tokens: -50,
      });
      expect(negative.inputTokens).toBe(-100);
      expect(negative.outputTokens).toBe(-50);
      expect(negative.totalTokens).toBe(-150);
    });

    it('handles zero values explicitly', () => {
      const zero = extractCodexUsage({
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
      });
      expect(zero.inputTokens).toBe(0);
      expect(zero.outputTokens).toBe(0);
      expect(zero.totalTokens).toBe(0);
      expect(zero.reasoningOutputTokens).toBe(0);
    });
  });

  describe('2. decodeCodexLine Robustness', () => {
    it('handles malformed JSON and unexpected JSON types', () => {
      expect(decodeCodexLine('{not json')).toEqual([{
        type: 'error',
        message: 'Codex emitted malformed structured output.',
        source: 'protocol',
      }]);
      expect(decodeCodexLine('null')).toEqual([{
        type: 'error',
        message: 'Codex emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeCodexLine('[]')).toEqual([{
        type: 'error',
        message: 'Codex emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeCodexLine('12345')).toEqual([{
        type: 'error',
        message: 'Codex emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeCodexLine('"string"')).toEqual([{
        type: 'error',
        message: 'Codex emitted an invalid structured record.',
        source: 'protocol',
      }]);
    });

    it('handles turn.completed with malformed or null usage', () => {
      const nullUsage = decodeCodexLine(JSON.stringify({
        type: 'turn.completed',
        usage: null,
      }));
      expect(nullUsage).toEqual([{ type: 'complete' }]);

      const arrayUsage = decodeCodexLine(JSON.stringify({
        type: 'turn.completed',
        usage: [1, 2, 3],
      }));
      expect(arrayUsage).toEqual([{ type: 'complete' }]);

      const stringUsage = decodeCodexLine(JSON.stringify({
        type: 'turn.completed',
        usage: "invalid string",
      }));
      expect(stringUsage).toEqual([{ type: 'complete' }]);
    });
  });

  describe('3. extractAcpUsage and Session Update Robustness', () => {
    it('handles empty and partial records safely without crash', () => {
      const res = extractAcpUsage({} as any);
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.costConfidence).toBe('absent');
    });

    it('handles non-number and unexpected types in ACP usage', () => {
      const malformed = {
        inputTokens: "500",
        outputTokens: null,
        thoughtTokens: false,
        cachedReadTokens: [],
        cachedWriteTokens: {},
        totalTokens: "unknown",
      };
      const res = extractAcpUsage(malformed as any);
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.cacheReadInputTokens).toBeUndefined();
      expect(res.cacheWriteInputTokens).toBeUndefined();
      expect(res.reasoningOutputTokens).toBeUndefined();
    });

    it('handles massive numbers (>10^9 tokens) in ACP usage', () => {
      const massive = extractAcpUsage({
        inputTokens: 10_000_000_000,
        outputTokens: 5_000_000_000,
        thoughtTokens: 2_000_000_000,
        cachedReadTokens: 3_000_000_000,
        cachedWriteTokens: 1_000_000_000,
        totalTokens: 15_000_000_000,
      } as any);
      expect(massive.inputTokens).toBe(10_000_000_000);
      expect(massive.outputTokens).toBe(5_000_000_000);
      expect(massive.cachedInputTokens).toBe(4_000_000_000);
      expect(massive.reasoningOutputTokens).toBe(2_000_000_000);
      expect(massive.totalTokens).toBe(15_000_000_000);
    });

    it('handles context window size=0 and used=0 in usage_update without NaN', async () => {
      let client: any;
      const connection: AcpConnection = {
        initialize: vi.fn().mockResolvedValue({ protocolVersion: 1 }),
        newSession: vi.fn().mockResolvedValue({ sessionId: SESSION_UUID }),
        loadSession: vi.fn().mockResolvedValue({}),
        prompt: vi.fn(async (): Promise<any> => {
          await client.sessionUpdate({
            sessionId: SESSION_UUID,
            update: {
              sessionUpdate: 'usage_update',
              used: 0,
              size: 0,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_UUID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'ack' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        closed: new Promise<void>(() => {}),
      };

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      await harness.start('/workspace');
      client = getClient();
      await harness.send('test zero');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.maxTokens).toBe(0);
      expect(quotas[0].contextWindow?.usedTokens).toBe(0);
      expect(quotas[0].contextWindow?.utilizationPercent).toBeUndefined();
    });

    it('prevents NaN in AcpCliAdapter when used is NaN or Infinity/Infinity', () => {
      const adapter = new AcpCliAdapter({
        executable: 'copilot',
        args: [],
        label: 'Copilot',
      });
      const quotas: NormalizedRemainingQuota[] = [];
      adapter.on('quota', (q) => quotas.push(q));

      // Test used: NaN with valid size: 1000
      (adapter as any).handleSessionUpdate({
        sessionId: 'test',
        update: {
          sessionUpdate: 'usage_update',
          used: NaN,
          size: 1000,
        },
      });

      expect(quotas).toHaveLength(1);
      // Hardened: usedTokens is 0 and utilizationPercent is 0, never NaN
      expect(Number.isNaN(quotas[0].contextWindow?.usedTokens)).toBe(false);
      expect(quotas[0].contextWindow?.usedTokens).toBe(0);
      expect(Number.isNaN(quotas[0].contextWindow?.utilizationPercent)).toBe(false);
      expect(quotas[0].contextWindow?.utilizationPercent).toBe(0);

      // Test Infinity / Infinity
      (adapter as any).handleSessionUpdate({
        sessionId: 'test',
        update: {
          sessionUpdate: 'usage_update',
          used: Infinity,
          size: Infinity,
        },
      });
      expect(quotas).toHaveLength(2);
      expect(Number.isNaN(quotas[1].contextWindow?.usedTokens)).toBe(false);
      expect(Number.isNaN(quotas[1].contextWindow?.maxTokens)).toBe(false);
      expect(quotas[1].contextWindow?.utilizationPercent).toBeUndefined();
    });

    it('probes negative size or used tokens in usage_update', async () => {
      let client: any;
      const connection: AcpConnection = {
        initialize: vi.fn().mockResolvedValue({ protocolVersion: 1 }),
        newSession: vi.fn().mockResolvedValue({ sessionId: SESSION_UUID }),
        loadSession: vi.fn().mockResolvedValue({}),
        prompt: vi.fn(async (): Promise<any> => {
          await client.sessionUpdate({
            sessionId: SESSION_UUID,
            update: {
              sessionUpdate: 'usage_update',
              used: -100,
              size: -500,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_UUID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'ack' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
        cancel: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        closed: new Promise<void>(() => {}),
      };

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      await harness.start('/workspace');
      client = getClient();
      await harness.send('test negative');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.utilizationPercent).toBeUndefined();
    });
  });

  describe('4. extractNormalizedUsage (Antigravity) Robustness', () => {
    it('handles empty and partial records safely without crash', () => {
      const res = extractNormalizedUsage({});
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.costConfidence).toBe('absent');
      expect(res.costUsdEstimate).toBeUndefined();
    });

    it('handles all alternative Gemini token field names correctly', () => {
      const res1 = extractNormalizedUsage({
        input_token_count: 50,
        output_token_count: 25,
        total_token_count: 75,
        thoughts_token_count: 10,
        cached_content_token_count: 15,
      });
      expect(res1.inputTokens).toBe(50);
      expect(res1.outputTokens).toBe(25);
      expect(res1.totalTokens).toBe(75);
      expect(res1.reasoningOutputTokens).toBe(10);
      expect(res1.cachedInputTokens).toBe(15);
      expect(res1.cacheReadInputTokens).toBe(15);

      const res2 = extractNormalizedUsage({
        prompt_tokens: 80,
        candidates_token_count: 40,
        thinking_tokens: 20,
        cached_tokens: 30,
      });
      expect(res2.inputTokens).toBe(80);
      expect(res2.outputTokens).toBe(40);
      expect(res2.totalTokens).toBe(120);
      expect(res2.reasoningOutputTokens).toBe(20);
      expect(res2.cachedInputTokens).toBe(30);
    });

    it('handles unexpected non-number types gracefully', () => {
      const malformed = {
        input_tokens: "high",
        output_tokens: [1, 2],
        cached_input_tokens: { cache: true },
        cost_usd: "free",
        total_tokens: null,
      };
      const res = extractNormalizedUsage(malformed as any);
      expect(res.inputTokens).toBe(0);
      expect(res.outputTokens).toBe(0);
      expect(res.totalTokens).toBe(0);
      expect(res.costConfidence).toBe('absent');
      expect(res.costUsdEstimate).toBeUndefined();
    });

    it('safely handles large retry delay in Antigravity without throwing RangeError', () => {
      // 1. parseAntigravityQuotaError does not throw RangeError
      expect(() => {
        parseAntigravityQuotaError('RESOURCE_EXHAUSTED: quota exceeded, retry after 999999999999999s');
      }).not.toThrow();

      // 2. decodeAntigravityLine does not throw RangeError on step_update backing off
      expect(() => {
        decodeAntigravityLine(JSON.stringify({
          type: 'step_update',
          message: 'backing off for 999999999999999s',
        }));
      }).not.toThrow();

      // 3. decodeAntigravityLine does not throw RangeError on error result
      expect(() => {
        decodeAntigravityLine(JSON.stringify({
          type: 'error',
          error: { message: 'RESOURCE_EXHAUSTED: retry after 999999999999999s' },
        }));
      }).not.toThrow();
    });
  });

  describe('5. decodeClaudeLine & ClaudeCliAdapter Robustness', () => {
    it('handles malformed and non-record lines gracefully', () => {
      expect(decodeClaudeLine('{not json')).toEqual([{
        type: 'error',
        message: 'Claude emitted malformed structured output.',
        source: 'protocol',
      }]);
      expect(decodeClaudeLine('null')).toEqual([{
        type: 'error',
        message: 'Claude emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeClaudeLine('[]')).toEqual([{
        type: 'error',
        message: 'Claude emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeClaudeLine('12345')).toEqual([{
        type: 'error',
        message: 'Claude emitted an invalid structured record.',
        source: 'protocol',
      }]);
      expect(decodeClaudeLine('"hello"')).toEqual([{
        type: 'error',
        message: 'Claude emitted an invalid structured record.',
        source: 'protocol',
      }]);
    });

    it('safely handles large retry_delay_ms or resetsAt in decodeClaudeLine without throwing RangeError', () => {
      // 1. api_retry with large retry_delay_ms does not throw RangeError
      expect(() => {
        decodeClaudeLine(JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          retry_delay_ms: 10_000_000_000_000_000,
        }));
      }).not.toThrow();

      // 2. rate_limit_event with large resetsAt does not throw RangeError
      expect(() => {
        decodeClaudeLine(JSON.stringify({
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'allowed_warning',
            resetsAt: 10_000_000_000_000_000,
          },
        }));
      }).not.toThrow();
    });

    it('handles rate_limit_event with normal utilization percentages', () => {
      const ev0 = decodeClaudeLine(JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'ok',
          utilization: 0,
        },
      }));
      expect(ev0).toHaveLength(1);
      if (ev0[0].type === 'quota') {
        expect(ev0[0].quota.requests?.used).toBe(0);
        expect(ev0[0].quota.requests?.remaining).toBe(100);
        expect(ev0[0].quota.requests?.status).toBe('ok');
      }

      const evOver = decodeClaudeLine(JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          utilization: 135,
        },
      }));
      if (evOver[0].type === 'quota') {
        expect(evOver[0].quota.requests?.used).toBe(135);
        expect(evOver[0].quota.requests?.remaining).toBe(0);
      }
    });
  });

  describe('6. SDK Adapters Type Coercion / String Concatenation Hardening', () => {
    it('enforces strict number types and prevents string concatenation in ClaudeCodeAdapter normalizeUsage', () => {
      const adapter = new ClaudeCodeAdapter();
      const res = (adapter as any).normalizeUsage({ input_tokens: '500', output_tokens: 20 });
      // Hardened: inputTokens is number 0 and totalTokens is 20 (not string concatenation '50020')
      expect(typeof res.inputTokens).toBe('number');
      expect(res.inputTokens).toBe(0);
      expect(typeof res.totalTokens).toBe('number');
      expect(res.totalTokens).toBe(20);
    });

    it('enforces strict number types and prevents string concatenation in CodexAdapter normalizeUsage', () => {
      const adapter = new CodexAdapter();
      const res = (adapter as any).normalizeUsage({ input_tokens: '500', output_tokens: 20 });
      // Hardened: inputTokens is number 0 and totalTokens is 20 (not string concatenation '50020')
      expect(typeof res.inputTokens).toBe('number');
      expect(res.inputTokens).toBe(0);
      expect(typeof res.totalTokens).toBe('number');
      expect(res.totalTokens).toBe(20);
    });
  });

  describe('7. Rapid Sequential Turns Across All Adapters', () => {
    it('executes rapid sequential turns on CodexCliAdapter', async () => {
      const adapter = new TestCodexCliAdapter();
      const usages: NormalizedUsage[] = [];
      adapter.on('usage', (u: NormalizedUsage) => usages.push(u));

      await adapter.start('/workspace');

      // Turn 1
      await adapter.send('Turn 1');
      adapter.processes[0].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({ type: 'thread.started', thread_id: SESSION_UUID })}\n` +
        `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Answer 1' } })}\n` +
        `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20 } })}\n`,
      ));
      adapter.processes[0].child.emit('close', 0);

      // Turn 2
      await adapter.send('Turn 2');
      adapter.processes[1].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({ type: 'thread.started', thread_id: SESSION_UUID })}\n` +
        `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Answer 2' } })}\n` +
        `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 150, output_tokens: 30 } })}\n`,
      ));
      adapter.processes[1].child.emit('close', 0);

      expect(usages).toHaveLength(2);
      expect(usages[0].inputTokens).toBe(100);
      expect(usages[1].inputTokens).toBe(150);
    });

    it('executes rapid sequential turns on AntigravityCliAdapter', async () => {
      const adapter = new TestAntigravityCliAdapter();
      const usages: NormalizedUsage[] = [];
      adapter.on('usage', (u: NormalizedUsage) => usages.push(u));

      await adapter.start('/workspace', { id: SESSION_UUID, resume: true });

      // Turn 1
      await adapter.send('Turn 1');
      adapter.processes[0].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({
          type: 'result',
          conversationId: SESSION_UUID,
          result: 'AG Response 1',
          usage: { promptTokens: 300, completionTokens: 50 },
        })}\n`,
      ));
      adapter.processes[0].child.emit('close', 0);

      // Turn 2
      await adapter.send('Turn 2');
      adapter.processes[1].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({
          type: 'result',
          conversationId: SESSION_UUID,
          result: 'AG Response 2',
          usage: { promptTokens: 400, completionTokens: 60, cost_usd: 0.004 },
        })}\n`,
      ));
      adapter.processes[1].child.emit('close', 0);

      expect(usages).toHaveLength(2);
      expect(usages[0].totalTokens).toBe(350);
      expect(usages[1].totalTokens).toBe(460);
    });

    it('executes rapid sequential turns on ClaudeCliAdapter', async () => {
      const adapter = new TestClaudeCliAdapter();
      const usages: NormalizedUsage[] = [];
      adapter.on('usage', (u: NormalizedUsage) => usages.push(u));

      await adapter.start('/workspace', { id: SESSION_UUID, resume: false });

      // Turn 1
      await adapter.send('Turn 1');
      adapter.processes[0].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION_UUID })}\n` +
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          session_id: SESSION_UUID,
          result: 'Claude response 1',
          usage: { input_tokens: 500, output_tokens: 80 },
        })}\n`,
      ));
      adapter.processes[0].child.emit('close', 0);

      // Turn 2
      await adapter.send('Turn 2');
      adapter.processes[1].child.stdout.emit('data', Buffer.from(
        `${JSON.stringify({
          type: 'result',
          subtype: 'success',
          session_id: SESSION_UUID,
          result: 'Claude response 2',
          usage: { input_tokens: 600, output_tokens: 90 },
          total_cost_usd: 0.015,
        })}\n`,
      ));
      adapter.processes[1].child.emit('close', 0);

      expect(usages).toHaveLength(2);
      expect(usages[0].totalTokens).toBe(580);
      expect(usages[1].totalTokens).toBe(690);
    });
  });
});
