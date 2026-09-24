import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type * as acp from '@agentclientprotocol/sdk';

import {
  ClaudeCliAdapter,
  decodeClaudeLine,
} from './ClaudeCliAdapter.js';
import {
  AntigravityCliAdapter,
  decodeAntigravityLine,
  parseAntigravityQuotaError,
} from './AntigravityCliAdapter.js';
import {
  AcpCliAdapter,
  type AcpConnection,
  type AcpTransportFactory,
} from './AcpCliAdapter.js';
import type { NormalizedRemainingQuota, NormalizedUsage } from '../harness/types.js';

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

  protected override spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

class TestAntigravityCliAdapter extends AntigravityCliAdapter {
  readonly processes: Array<{ args: string[]; child: FakeChild }> = [];

  protected override spawnProcess(args: string[]): ChildProcess {
    const child = new FakeChild();
    this.processes.push({ args, child });
    return child as unknown as ChildProcess;
  }
}

function makeAcpConnection(overrides: Partial<AcpConnection> = {}): AcpConnection {
  return {
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    }),
    newSession: vi.fn().mockResolvedValue({ sessionId: SESSION_ID }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    closed: new Promise<void>(() => {}),
    ...overrides,
  };
}

function makeAcpHarness(connection: AcpConnection) {
  const child = new FakeChild();
  let client: acp.Client | undefined;
  const factory: AcpTransportFactory = vi.fn((options) => {
    client = options.client;
    return { process: child as unknown as ChildProcess, connection };
  });
  const harness = new AcpCliAdapter({
    executable: 'copilot',
    args: ['--acp'],
    label: 'GitHub Copilot CLI',
    validateSessionId: (id) => id === SESSION_ID,
    transportFactory: factory,
  });
  return { harness, child, factory, getClient: () => client! };
}

describe('Empirical Adversarial Challenge: Quota, Rate-Limit & Retry Handling', () => {

  describe('1. Claude Code api_retry handling', () => {
    it('accurately parses 429 status and retry delays into approaching_limit quota events', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 5000,
        error_status: 429,
      });

      const events = decodeClaudeLine(line);
      const quotaEvents = events.filter(e => e.type === 'quota');
      expect(quotaEvents).toHaveLength(1);

      const quota = (quotaEvents[0] as any).quota as NormalizedRemainingQuota;
      expect(quota.requests).toBeDefined();
      expect(quota.requests?.unit).toBe('requests');
      expect(quota.requests?.status).toBe('approaching_limit');
      expect(quota.requests?.resetInSeconds).toBe(5);
      expect(quota.requests?.resetsAt).toBeDefined();

      const resetTime = new Date(quota.requests!.resetsAt!).getTime();
      expect(resetTime).toBeGreaterThan(Date.now() + 4000);
      expect(resetTime).toBeLessThanOrEqual(Date.now() + 6000);

      expect(quota.warningMessage).toBe('Rate limit retry attempt 1 of 3');
      expect(quota.isEstimated).toBe(true);
    });

    it('handles fractional retry delays rounding up to ceiling seconds', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 2,
        max_retries: 4,
        retry_delay_ms: 1200,
        error_status: 429,
      });

      const events = decodeClaudeLine(line);
      const quota = (events.find(e => e.type === 'quota') as any)?.quota as NormalizedRemainingQuota;
      expect(quota.requests?.resetInSeconds).toBe(2);
    });

    it('handles rate_limit error_type when error_status code is omitted', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 2,
        error_type: 'rate_limit',
      });

      const events = decodeClaudeLine(line);
      const quota = (events.find(e => e.type === 'quota') as any)?.quota as NormalizedRemainingQuota;
      expect(quota).toBeDefined();
      expect(quota.requests?.status).toBe('approaching_limit');
      expect(quota.requests?.resetInSeconds).toBeUndefined();
      expect(quota.requests?.resetsAt).toBeUndefined();
    });

    it('emits quota events sequentially on multi-step retries and propagates latestQuota to complete turn', async () => {
      const adapter = new TestClaudeCliAdapter();
      const emittedQuotas: NormalizedRemainingQuota[] = [];
      let finalUsage: NormalizedUsage | undefined;

      adapter.on('quota', (q: NormalizedRemainingQuota) => emittedQuotas.push(q));
      adapter.on('usage', (u: NormalizedUsage) => { finalUsage = u; });

      await adapter.start('/workspace', { id: SESSION_ID, resume: false });
      await adapter.send('test multi retry');

      const stdout = adapter.processes[0].child.stdout;
      stdout.emit('data', Buffer.from(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION_ID }) + '\n' +
        JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 3,
          retry_delay_ms: 2000,
          error_status: 429,
        }) + '\n' +
        JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          attempt: 2,
          max_retries: 3,
          retry_delay_ms: 4000,
          error_status: 429,
        }) + '\n' +
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          session_id: SESSION_ID,
          result: 'Recovered after retry',
          usage: { input_tokens: 150, output_tokens: 50 },
        }) + '\n'
      ));
      adapter.processes[0].child.emit('close', 0);

      expect(emittedQuotas).toHaveLength(2);
      expect(emittedQuotas[0].requests?.resetInSeconds).toBe(2);
      expect(emittedQuotas[1].requests?.resetInSeconds).toBe(4);

      expect(finalUsage).toBeDefined();
      expect(finalUsage?.remainingQuota).toBeDefined();
      expect(finalUsage?.remainingQuota?.requests?.resetInSeconds).toBe(4);
    });

    it('emits quota exhaustion event with remaining 0 on terminal 429 error', async () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['429 Too Many Requests: Rate limit exceeded for organization'],
      });

      const events = decodeClaudeLine(line);
      const quota = (events.find(e => e.type === 'quota') as any)?.quota as NormalizedRemainingQuota;
      expect(quota).toBeDefined();
      expect(quota.requests?.unit).toBe('requests');
      expect(quota.requests?.remaining).toBe(0);
      expect(quota.requests?.status).toBe('exceeded');
      expect(quota.warningMessage).toContain('429 Too Many Requests');
    });

    it('emits credit exhaustion when provider reports credit requirement or overage', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Credit balance too low: credits required to continue'],
      });

      const events = decodeClaudeLine(line);
      const quota = (events.find(e => e.type === 'quota') as any)?.quota as NormalizedRemainingQuota;
      expect(quota).toBeDefined();
      expect(quota.creditsRemainingUsd).toBe(0);
      expect(quota.warningMessage).toContain('credits required');
    });
  });

  describe('2. Claude Code rate_limit_event utilization percentages & windows', () => {
    it('handles 0% utilization on five_hour window as ok status with remaining 100%', () => {
      const line = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          rateLimitType: 'five_hour',
          utilization: 0,
          resetsAt: 1727164800,
        },
      });

      const events = decodeClaudeLine(line);
      expect(events).toHaveLength(1);
      const quota = (events[0] as any).quota as NormalizedRemainingQuota;
      expect(quota.requests).toEqual({
        unit: 'percent',
        used: 0,
        limit: 100,
        remaining: 100,
        resetsAt: new Date(1727164800 * 1000).toISOString(),
        status: 'ok',
      });
      expect(quota.planType).toBe('plan-included');
      expect(quota.label).toBe('five_hour');
      expect(quota.warningMessage).toBeUndefined();
    });

    it('handles 85% utilization on five_hour window as approaching_limit status with remaining 15%', () => {
      const line = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          utilization: 85,
          resetsAt: 1727164800,
        },
      });

      const events = decodeClaudeLine(line);
      const quota = (events[0] as any).quota as NormalizedRemainingQuota;
      expect(quota.requests).toEqual({
        unit: 'percent',
        used: 85,
        limit: 100,
        remaining: 15,
        resetsAt: new Date(1727164800 * 1000).toISOString(),
        status: 'approaching_limit',
      });
      expect(quota.warningMessage).toBe('Rate limit status: allowed_warning');
    });

    it('handles 100% utilization on seven_day window as exceeded status with remaining 0%', () => {
      const line = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          rateLimitType: 'seven_day',
          utilization: 100,
          resetsAt: 1727164800000, // millisecond timestamp
        },
      });

      const events = decodeClaudeLine(line);
      const quota = (events[0] as any).quota as NormalizedRemainingQuota;
      expect(quota.requests).toEqual({
        unit: 'percent',
        used: 100,
        limit: 100,
        remaining: 0,
        resetsAt: new Date(1727164800000).toISOString(),
        status: 'exceeded',
      });
      expect(quota.label).toBe('seven_day');
      expect(quota.warningMessage).toBe('Rate limit status: rejected');
    });

    it('clamps remaining to 0 and avoids negative values on 120% over-utilization', () => {
      const line = JSON.stringify({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'rejected',
          rateLimitType: 'seven_day',
          utilization: 120,
          resetsAt: 1727164800,
        },
      });

      const events = decodeClaudeLine(line);
      const quota = (events[0] as any).quota as NormalizedRemainingQuota;
      expect(quota.requests?.used).toBe(120);
      expect(quota.requests?.limit).toBe(100);
      expect(quota.requests?.remaining).toBe(0);
      expect(quota.requests?.status).toBe('exceeded');
    });
  });

  describe('3. Antigravity RESOURCE_EXHAUSTED & Quota exceeded strings with seconds extraction', () => {
    it('extracts seconds from "retry after 20s" in RESOURCE_EXHAUSTED message', () => {
      const msg = 'Quota exceeded for gemini-2.5-pro: RESOURCE_EXHAUSTED. Please retry after 20s';
      const quota = parseAntigravityQuotaError(msg);

      expect(quota).not.toBeNull();
      expect(quota?.requests?.unit).toBe('requests');
      expect(quota?.requests?.remaining).toBe(0);
      expect(quota?.requests?.status).toBe('exceeded');
      expect(quota?.requests?.resetInSeconds).toBe(20);
      expect(quota?.requests?.resetsAt).toBeDefined();
      expect(quota?.isEstimated).toBe(false);
      expect(quota?.warningMessage).toBe(msg);
    });

    it('extracts seconds from "wait 45 seconds" with 429 status', () => {
      const msg = 'HTTP 429: Too Many Requests. Please wait 45 seconds before requesting again.';
      const quota = parseAntigravityQuotaError(msg);

      expect(quota).not.toBeNull();
      expect(quota?.requests?.status).toBe('exceeded');
      expect(quota?.requests?.resetInSeconds).toBe(45);
    });

    it('extracts seconds from "retry in 15s" in rate-limit error', () => {
      const msg = 'Rate limit reached for gemini-2.5-flash. Retry in 15s';
      const quota = parseAntigravityQuotaError(msg);

      expect(quota).not.toBeNull();
      expect(quota?.requests?.status).toBe('exceeded');
      expect(quota?.requests?.resetInSeconds).toBe(15);
    });

    it('handles daily quota exceeded without reset seconds gracefully', () => {
      const msg = 'Daily quota limit reached for organization. Upgrade billing or wait until midnight.';
      const quota = parseAntigravityQuotaError(msg);

      expect(quota).not.toBeNull();
      expect(quota?.requests?.status).toBe('exceeded');
      expect(quota?.requests?.remaining).toBe(0);
      expect(quota?.requests?.resetInSeconds).toBeUndefined();
      expect(quota?.requests?.resetsAt).toBeUndefined();
    });

    it('parses step_update backoff string into approaching_limit quota event with estimated flag', () => {
      const line = JSON.stringify({
        type: 'step_update',
        message: 'Rate limit encountered, backing off for 12s...',
      });

      const events = decodeAntigravityLine(line);
      const quotaEvent = events.find(e => e.type === 'quota');
      expect(quotaEvent).toBeDefined();

      const quota = (quotaEvent as any).quota as NormalizedRemainingQuota;
      expect(quota.requests?.unit).toBe('requests');
      expect(quota.requests?.status).toBe('approaching_limit');
      expect(quota.requests?.resetInSeconds).toBe(12);
      expect(quota.isEstimated).toBe(true);
    });

    it('extracts quota errors from Antigravity result error status', () => {
      const line = JSON.stringify({
        type: 'result',
        status: 'error',
        result: {
          status: 'ERROR',
          error: 'RESOURCE_EXHAUSTED: rate limit exceeded, retry after 30 seconds',
        },
      });

      const events = decodeAntigravityLine(line);
      const quotaEvent = events.find(e => e.type === 'quota');
      expect(quotaEvent).toBeDefined();

      const quota = (quotaEvent as any).quota as NormalizedRemainingQuota;
      expect(quota.requests?.status).toBe('exceeded');
      expect(quota.requests?.resetInSeconds).toBe(30);
    });
  });

  describe('4. Copilot ACP usage_update notifications with used and size', () => {
    it('calculates 25% utilization for used: 32000, size: 128000', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 32000,
              size: 128000,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Prompt finished' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check usage update');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow).toEqual({
        usedTokens: 32000,
        maxTokens: 128000,
        utilizationPercent: 25,
      });
    });

    it('calculates 0% utilization for used: 0, size: 200000', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 0,
              size: 200000,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Prompt finished' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check 0% usage');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.utilizationPercent).toBe(0);
      expect(quotas[0].contextWindow?.usedTokens).toBe(0);
      expect(quotas[0].contextWindow?.maxTokens).toBe(200000);
    });

    it('calculates 100% utilization when used equals size', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 128000,
              size: 128000,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Prompt finished' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check 100% usage');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.utilizationPercent).toBe(100);
    });

    it('handles over-capacity context window safely (>100%)', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 160000,
              size: 128000,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Prompt finished' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check over-capacity usage');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.usedTokens).toBe(160000);
      expect(quotas[0].contextWindow?.maxTokens).toBe(128000);
      expect(quotas[0].contextWindow?.utilizationPercent).toBe(125);
    });

    it('omits utilizationPercent and prevents NaN when size is 0', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 0,
              size: 0,
            } as any,
          });
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Prompt finished' },
            },
          });
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check zero size');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.usedTokens).toBe(0);
      expect(quotas[0].contextWindow?.maxTokens).toBe(0);
      expect(quotas[0].contextWindow?.utilizationPercent).toBeUndefined();
      expect(Number.isNaN(quotas[0].contextWindow?.utilizationPercent)).toBe(false);
    });

    it('emits quota even if the turn later fails with empty message response', async () => {
      let client: acp.Client;
      const connection = makeAcpConnection({
        prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
          await client.sessionUpdate({
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: 'usage_update',
              used: 5000,
              size: 50000,
            } as any,
          });
          // Note: No agent_message_chunk emitted!
          return { stopReason: 'end_turn' };
        }),
      });

      const { harness, getClient } = makeAcpHarness(connection);
      const quotas: NormalizedRemainingQuota[] = [];
      const errors: Error[] = [];
      harness.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));
      harness.on('error', (e: Error) => errors.push(e));

      const start = harness.start('/workspace');
      client = getClient();
      await start;
      await harness.send('check quota on empty turn');

      expect(quotas).toHaveLength(1);
      expect(quotas[0].contextWindow?.utilizationPercent).toBe(10);
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('without a recognizable response');
    });
  });

  describe('5. False Positive Isolation: Non-rate-limit errors do NOT trigger quota events', () => {
    describe('Claude non-rate-limit errors', () => {
      it('does NOT emit quota event on 500 error without retry_delay_ms', () => {
        const line = JSON.stringify({
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 3,
          error_status: 500,
        });

        const events = decodeClaudeLine(line);
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('system');
        expect(events.some(e => e.type === 'quota')).toBe(false);
      });

      it('does NOT emit quota event on execution failure (tool failure, permission, file not found)', () => {
        const errorsToTest = [
          'Permission was denied for tool execution',
          'ENOENT: no such file or directory, open /tmp/file.txt',
          'SyntaxError: Unexpected identifier in file.ts',
          'Connection reset by peer (ECONNRESET)',
          'Timeout waiting for subprocess response',
          'Authentication failed: invalid token provided',
          'Model claude-3-unknown does not exist',
        ];

        for (const errMsg of errorsToTest) {
          const line = JSON.stringify({
            type: 'result',
            subtype: 'error_during_execution',
            is_error: true,
            errors: [errMsg],
          });

          const events = decodeClaudeLine(line);
          const quotaEvents = events.filter(e => e.type === 'quota');
          expect(quotaEvents).toHaveLength(0);
          expect(events.some(e => e.type === 'error')).toBe(true);
        }
      });
    });

    describe('Antigravity non-rate-limit errors', () => {
      it('returns null from parseAntigravityQuotaError for non-rate-limit errors', () => {
        const errorsToTest = [
          'Workspace compilation failed with 3 errors',
          'Command failed: git status -s returned exit code 128',
          'Invalid arguments provided for tool: path must be a string',
          'Permission denied: cannot write to protected directory',
          'Connection timed out after 30000ms',
          'Syntax error in prompt input',
          'Unrecognized command flag --unknown-flag',
        ];

        for (const errMsg of errorsToTest) {
          const quota = parseAntigravityQuotaError(errMsg);
          expect(quota).toBeNull();
        }
      });

      it('does NOT emit quota event for non-backoff step updates', () => {
        const stepMessages = [
          'Analyzing project dependencies and structure...',
          'Reading source file src/index.ts (turn 1)...',
          'Searching repository for interface references...',
          'Waiting for user approval on command execution...',
          'Executing unit tests in isolated environment...',
        ];

        for (const msg of stepMessages) {
          const line = JSON.stringify({
            type: 'step_update',
            message: msg,
          });

          const events = decodeAntigravityLine(line);
          expect(events.some(e => e.type === 'quota')).toBe(false);
          expect(events.some(e => e.type === 'step_update')).toBe(true);
        }
      });

      it('does NOT emit quota event on result errors without rate limits', () => {
        const line = JSON.stringify({
          type: 'result',
          status: 'error',
          result: {
            status: 'ERROR',
            error: 'Process crashed with segmentation fault (core dumped)',
          },
        });

        const events = decodeAntigravityLine(line);
        expect(events.some(e => e.type === 'quota')).toBe(false);
        expect(events.some(e => e.type === 'error')).toBe(true);
      });
    });

    describe('Copilot ACP non-rate-limit events', () => {
      it('does NOT emit quota event on normal agent chunks or prompt completions', async () => {
        let client: acp.Client;
        const connection = makeAcpConnection({
          prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
            await client.sessionUpdate({
              sessionId: SESSION_ID,
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: { type: 'text', text: 'Thinking about the architecture...' },
              },
            });
            await client.sessionUpdate({
              sessionId: SESSION_ID,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'Here is the response.' },
              },
            });
            return {
              stopReason: 'end_turn',
              usage: {
                totalTokens: 100,
                inputTokens: 80,
                outputTokens: 20,
              },
            };
          }),
        });

        const { harness, getClient } = makeAcpHarness(connection);
        const quotas: NormalizedRemainingQuota[] = [];
        const data: string[] = [];
        const usages: NormalizedUsage[] = [];

        harness.on('quota', (q) => quotas.push(q));
        harness.on('data', (d) => data.push(d));
        harness.on('usage', (u) => usages.push(u));

        const start = harness.start('/workspace');
        client = getClient();
        await start;
        await harness.send('normal prompt');

        expect(quotas).toHaveLength(0);
        expect(data).toEqual(['Thinking about the architecture...', 'Here is the response.']);
        expect(usages).toHaveLength(1);
      });

      it('does NOT emit quota event on connection crashes or errors', async () => {
        const connection = makeAcpConnection({
          prompt: vi.fn().mockRejectedValue(new Error('Subprocess pipe broken: EPIPE')),
        });

        const { harness } = makeAcpHarness(connection);
        const quotas: NormalizedRemainingQuota[] = [];
        const errors: Error[] = [];

        harness.on('quota', (q) => quotas.push(q));
        harness.on('error', (e) => errors.push(e));

        await harness.start('/workspace');
        await harness.send('failing prompt');

        expect(quotas).toHaveLength(0);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain('Subprocess pipe broken');
      });
    });

    describe('Codex isolation', () => {
      it('never emits quota events on usage or turn failure', async () => {
        const { CodexCliAdapter } = await import('./CodexCliAdapter.js');
        const adapter = new (class extends CodexCliAdapter {
          readonly processes: Array<{ args: string[]; child: FakeChild }> = [];
          protected override spawnProcess(args: string[]): ChildProcess {
            const child = new FakeChild();
            this.processes.push({ args, child });
            return child as unknown as ChildProcess;
          }
        })();

        const quotas: any[] = [];
        const usages: any[] = [];
        const errors: any[] = [];
        adapter.on('quota', (q: any) => quotas.push(q));
        adapter.on('usage', (u: any) => usages.push(u));
        adapter.on('error', (e: any) => errors.push(e));

        await adapter.start('/workspace', { id: SESSION_ID, resume: false });
        await adapter.send('prompt codex');

        adapter.processes[0].child.stdout.emit('data', Buffer.from(
          JSON.stringify({ type: 'thread.started', thread_id: SESSION_ID }) + '\n' +
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Assistant message' } }) + '\n' +
          JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 25 } }) + '\n'
        ));
        adapter.processes[0].child.emit('close', 0);

        expect(errors).toHaveLength(0);
        expect(quotas).toHaveLength(0);
        expect(usages).toHaveLength(1);
        expect(usages[0].inputTokens).toBe(50);
        expect(usages[0].remainingQuota).toBeUndefined();
      });
    });
  });

  describe('6. SDK Harness & ClaudeCodeAdapter Quota Flow', () => {
    it('ClaudeCodeAdapter maps api_retry and rate_limit_event to quota_updated and attaches to turn_completed', async () => {
      const { ClaudeCodeAdapter } = await import('../harness/claude.js');
      const messages: any[] = [
        { type: 'system', subtype: 'init', session_id: SESSION_ID },
        {
          type: 'system',
          subtype: 'api_retry',
          attempt: 1,
          max_retries: 3,
          retry_delay_ms: 3000,
          error_status: 429,
        },
        {
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'allowed_warning',
            rateLimitType: 'five_hour',
            utilization: 80,
            resetsAt: 1727164800,
          },
        },
        {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 100, output_tokens: 30 },
          total_cost_usd: 0.002,
        },
      ];

      async function* fakeQuery() {
        for (const msg of messages) {
          yield msg;
        }
      }

      const adapter = new ClaudeCodeAdapter(undefined, fakeQuery as any);
      const handle = await adapter.start({
        prompt: 'test sdk quota',
        workspace: { workspaceId: 'ws-1', rootPath: '/workspace' },
        env: { ANTHROPIC_API_KEY: 'test-key' },
      });

      const events: any[] = [];
      for await (const event of handle.events) {
        events.push(event);
        if (event.type === 'turn_completed') break;
      }
      await handle.dispose();

      const quotaUpdatedEvents = events.filter(e => e.type === 'quota_updated');
      expect(quotaUpdatedEvents).toHaveLength(2);

      // First quota_updated is from api_retry
      expect(quotaUpdatedEvents[0].quota.requests.resetInSeconds).toBe(3);
      expect(quotaUpdatedEvents[0].quota.requests.status).toBe('approaching_limit');

      // Second quota_updated is from rate_limit_event
      expect(quotaUpdatedEvents[1].quota.requests.unit).toBe('percent');
      expect(quotaUpdatedEvents[1].quota.requests.used).toBe(80);
      expect(quotaUpdatedEvents[1].quota.requests.remaining).toBe(20);

      // turn_completed has remainingQuota attached
      const turnCompleted = events.find(e => e.type === 'turn_completed');
      expect(turnCompleted).toBeDefined();
      expect(turnCompleted.usage.remainingQuota).toEqual(quotaUpdatedEvents[1].quota);
    });

    it('ClaudeSdkAdapter receives quota_updated from harness handle and re-emits quota event', async () => {
      const { ClaudeSdkAdapter } = await import('./ClaudeSdkAdapter.js');
      const { Pushable } = await import('../harness/pushable.js');

      const pushable = new Pushable<any>();
      const fakeHandle = {
        vendor: 'claude-code' as const,
        sessionId: () => Promise.resolve(SESSION_ID),
        events: pushable,
        send: vi.fn(),
        respondToApproval: vi.fn(),
        interrupt: vi.fn(),
        dispose: vi.fn(),
      };

      const fakeHarnessAdapter = {
        vendor: 'claude-code' as const,
        start: vi.fn().mockResolvedValue(fakeHandle),
        resume: vi.fn().mockResolvedValue(fakeHandle),
        authStatus: vi.fn().mockResolvedValue({ configured: true, method: 'api-key' }),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const sdkAdapter = new ClaudeSdkAdapter(undefined, fakeHarnessAdapter as any);
      const quotas: NormalizedRemainingQuota[] = [];
      sdkAdapter.on('quota', (q: NormalizedRemainingQuota) => quotas.push(q));

      await sdkAdapter.start('/workspace');
      await sdkAdapter.send('start sdk session');

      const sampleQuota: NormalizedRemainingQuota = {
        requests: {
          unit: 'percent',
          used: 90,
          limit: 100,
          remaining: 10,
          status: 'approaching_limit',
        },
        planType: 'plan-included',
        label: 'five_hour',
      };

      pushable.push({ type: 'quota_updated', quota: sampleQuota });
      pushable.push({
        type: 'turn_completed',
        usage: { inputTokens: 50, outputTokens: 10, remainingQuota: sampleQuota },
      });
      pushable.end();

      // Give event loop time to consume async iterable
      await vi.waitFor(() => expect(quotas).toHaveLength(1));
      expect(quotas[0]).toEqual(sampleQuota);
    });
  });

  describe('7. Edge Cases & Boundary Analysis', () => {
    it('documents behavior when api_retry has 500 status with retry_delay_ms', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 3,
        error_status: 500,
        retry_delay_ms: 2000,
      });

      const events = decodeClaudeLine(line);
      const quotaEvents = events.filter(e => e.type === 'quota');
      // Empirical verification: Because retry_delay_ms is present, ClaudeCliAdapter emits a quota event
      // with approaching_limit status and resetInSeconds.
      expect(quotaEvents).toHaveLength(1);
      expect((quotaEvents[0] as any).quota.requests.resetInSeconds).toBe(2);
      expect((quotaEvents[0] as any).quota.warningMessage).toBe('Rate limit retry attempt 1 of 3');
    });

    it('extracts Antigravity quota errors from varied error payload structures', () => {
      // 1. In value.error as string
      const ev1 = decodeAntigravityLine(JSON.stringify({
        type: 'error',
        error: 'RESOURCE_EXHAUSTED: retry after 10s',
      }));
      expect(ev1.find(e => e.type === 'quota')).toBeDefined();

      // 2. In value.error.message as string
      const ev2 = decodeAntigravityLine(JSON.stringify({
        type: 'error',
        error: { message: 'Quota exceeded: retry in 25s' },
      }));
      expect(ev2.find(e => e.type === 'quota')).toBeDefined();

      // 3. In value.errors as array
      const ev3 = decodeAntigravityLine(JSON.stringify({
        type: 'result',
        status: 'error',
        errors: ['HTTP 429 Too Many Requests: wait 15 seconds'],
      }));
      expect(ev3.find(e => e.type === 'quota')).toBeDefined();

      // 4. In value.details
      const ev4 = decodeAntigravityLine(JSON.stringify({
        type: 'error',
        details: 'RESOURCE_EXHAUSTED',
      }));
      expect(ev4.find(e => e.type === 'quota')).toBeDefined();
    });
  });
});

