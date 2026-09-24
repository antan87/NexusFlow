/**
 * @module tests/e2e/harness-usage/tier5-telemetry-adversarial.test
 *
 * Tier 5: Adversarial Coverage Hardening — Telemetry & Sessions
 *
 * White-box empirical verification across the entire harness telemetry and session stack:
 * - Suite 1: Claude Harness & Adapters (ClaudeCodeAdapter, ClaudeCliAdapter, ClaudeSdkAdapter)
 * - Suite 2: Codex Harness & Adapters (CodexAdapter, CodexCliAdapter, CodexSdkAdapter)
 * - Suite 3: Antigravity Telemetry & CLI Adapter (AntigravityCliAdapter, JSONL, history recovery)
 * - Suite 4: ACP & Copilot Telemetry (AcpCliAdapter, CopilotAcpAdapter, context window math, permissions)
 * - Suite 5: TurnSessionManager Multi-Harness Accumulation & Session Lifecycle (watchdog, gates, replay)
 * - Suite 6: JSONL Decoder Chunk Fragmentation & 8MB Oversized Boundary Protections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as acp from '@agentclientprotocol/sdk';

// ── Target Production Modules ──────────────────────────────────────────────────
import {
  ClaudeCliAdapter,
  ClaudeJsonlDecoder,
  decodeClaudeLine,
  safeToIsoString as claudeSafeToIsoString,
} from '../../../src/agent/ClaudeCliAdapter.js';
import { ClaudeSdkAdapter } from '../../../src/agent/ClaudeSdkAdapter.js';

import {
  CodexCliAdapter,
  CodexJsonlDecoder,
  extractCodexUsage,
} from '../../../src/agent/CodexCliAdapter.js';

import {
  AntigravityCliAdapter,
  AntigravityJsonlDecoder,
  decodeAntigravityLine,
  extractNormalizedUsage,
  findAntigravitySessionIdForWorkspace,
} from '../../../src/agent/AntigravityCliAdapter.js';

import {
  AcpCliAdapter,
  extractAcpUsage,
  decideReadOnlyPermission,
  type AcpConnection,
  type AcpTransportFactory,
} from '../../../src/agent/AcpCliAdapter.js';
import { buildCopilotAcpArgs } from '../../../src/agent/CopilotAcpAdapter.js';

import {
  TurnSessionManager,
  type TurnClient,
} from '../../../src/agent/TurnSessionManager.js';
import type { ProviderAdapter, AgentHarness } from '../../../src/agent/ProviderRegistry.js';
import type { NormalizedUsage, NormalizedRemainingQuota, HarnessEvent } from '../../../src/harness/types.js';
import type { SessionHandle } from '../../../src/harness/interface.js';

// ── Test Doubles & Harness Helpers ─────────────────────────────────────────────

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';

class MockSubprocess extends EventEmitter {
  public stdin = { write: vi.fn(), end: vi.fn() };
  public stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  public stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  public killed = false;
  public exitCode: number | null = null;
  public pid = 12345;
}

class TestableClaudeCliAdapter extends ClaudeCliAdapter {
  public spawned: MockSubprocess[] = [];
  protected override spawnProcess(args: string[]): ChildProcess {
    const child = new MockSubprocess();
    this.spawned.push(child);
    return child as unknown as ChildProcess;
  }
}

class TestableCodexCliAdapter extends CodexCliAdapter {
  public spawned: MockSubprocess[] = [];
  protected override spawnProcess(args: string[]): ChildProcess {
    const child = new MockSubprocess();
    this.spawned.push(child);
    return child as unknown as ChildProcess;
  }
}

function createMockAcpConnection(overrides: Partial<AcpConnection> = {}): {
  connection: AcpConnection;
  closedPromise: { resolve: () => void; reject: (err: any) => void };
} {
  let resolveClosed!: () => void;
  let rejectClosed!: (err: any) => void;
  const closedPromise = new Promise<void>((res, rej) => {
    resolveClosed = res;
    rejectClosed = rej;
  });

  const connection: AcpConnection = {
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    }),
    newSession: vi.fn().mockResolvedValue({ sessionId: VALID_UUID_A }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockImplementation(async () => {
      resolveClosed();
    }),
    closed: closedPromise,
    ...overrides,
  };

  return { connection, closedPromise: { resolve: resolveClosed, reject: rejectClosed } };
}

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 1: Claude Harness & Adapters — Adversarial Stream & Lifecycle Hardening
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 1 — Claude Harness & Adapters Adversarial Verification', () => {

  describe('1.1 safeToIsoString Boundary & Out-of-Bounds Resilience', () => {
    it('handles NaN, Infinities, and out-of-range epoch timestamps without throwing RangeError', () => {
      expect(claudeSafeToIsoString(undefined)).toBeUndefined();
      expect(claudeSafeToIsoString(NaN)).toBeUndefined();
      expect(claudeSafeToIsoString(Infinity)).toBeUndefined();
      expect(claudeSafeToIsoString(-Infinity)).toBeUndefined();
      expect(claudeSafeToIsoString(9e15)).toBeUndefined(); // exceeds 8.64e15 max Date limit
      expect(claudeSafeToIsoString(-9e15)).toBeUndefined();

      // Valid boundary timestamps
      expect(claudeSafeToIsoString(0)).toBe('1970-01-01T00:00:00.000Z');
      const sample = 1774350000000;
      expect(claudeSafeToIsoString(sample)).toBe(new Date(sample).toISOString());
    });
  });

  describe('1.2 ClaudeCliAdapter Rate Limit, Quota Exhaustion & Error Merging', () => {
    it('merges simultaneous rate-limit (429) and credit exhaustion signals into a unified quota event', () => {
      const line = JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        errors: [
          'HTTP 429: API rate-limit exceeded for tier',
          'Insufficient credit balance: credits required to continue session',
        ],
      });

      const events = decodeClaudeLine(line);
      const quotaEvt = events.find((e) => e.type === 'quota');
      const errEvt = events.find((e) => e.type === 'error');

      expect(quotaEvt).toBeDefined();
      if (quotaEvt?.type === 'quota') {
        expect(quotaEvt.quota.requests?.status).toBe('exceeded');
        expect(quotaEvt.quota.requests?.remaining).toBe(0);
        expect(quotaEvt.quota.creditsRemainingUsd).toBe(0);
        expect(quotaEvt.quota.warningMessage).toContain('429');
      }

      expect(errEvt).toBeDefined();
      if (errEvt?.type === 'error') {
        expect(errEvt.source).toBe('provider');
        expect(errEvt.message).toContain('credit balance');
      }
    });

    it('preserves client-assigned UUID casing when Claude returns different case', async () => {
      const adapter = new TestableClaudeCliAdapter();
      const requestedId = '123e4567-e89b-12d3-a456-426614174000';
      await adapter.start('/ws/claude-casing', { id: requestedId, resume: true });

      const emittedSessions: string[] = [];
      adapter.on('session', (id) => emittedSessions.push(id));

      const sendPromise = adapter.send('Check casing');
      const child = adapter.spawned[0];

      // Claude CLI emits uppercase UUID
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: requestedId.toUpperCase(),
      }) + '\n'));

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Casing acknowledged.' } },
      }) + '\n'));

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Casing acknowledged.',
        usage: { input_tokens: 50, output_tokens: 10 },
      }) + '\n'));

      child.emit('close', 0);
      await sendPromise;

      expect(emittedSessions).toEqual([requestedId]); // preserved exact client casing
    });

    it('fails turn with non-resumable error if complete arrives before session acknowledgement', async () => {
      const adapter = new TestableClaudeCliAdapter();
      await adapter.start('/ws/claude-unack');

      let turnError: Error | null = null;
      adapter.on('error', (err) => { turnError = err; });

      const sendPromise = adapter.send('Test unack');
      const child = adapter.spawned[0];

      // Claude completes without emitting init
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Done without init',
      }) + '\n'));

      child.emit('close', 0);
      await sendPromise;

      expect(turnError).not.toBeNull();
      expect(turnError!.message).toContain('Claude completed without acknowledging the requested session');
      expect(turnError!.message).toContain('The turn was not marked resumable');
    });
  });

  describe('1.3 ClaudeSdkAdapter Tool Authorization Gating & Interactive Approvals', () => {
    function createMockSdkHandle(events: HarnessEvent[]) {
      const approvals: Array<{ requestId: string; decision: any }> = [];
      const handle: SessionHandle = {
        vendor: 'claude-code',
        sessionId: () => Promise.resolve(VALID_UUID_A),
        events: (async function* () {
          for (const ev of events) yield ev;
        })(),
        send: vi.fn(),
        interrupt: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn().mockResolvedValue(undefined),
        respondToApproval: vi.fn((requestId, decision) => {
          approvals.push({ requestId, decision });
        }),
      };
      return { handle, approvals };
    }

    it('denies mutating lifecycle tools (isolate_repo, finish_workspace) even in workspace-write profile', async () => {
      const { handle, approvals } = createMockSdkHandle([
        { type: 'approval_required', requestId: 'req-iso', tool: 'mcp__nexusflow__isolate_repo', input: {} },
        { type: 'approval_required', requestId: 'req-fin', tool: 'nexusflow__finish_workspace', input: {} },
      ]);

      const mockAdapter = {
        vendor: 'claude-code' as const,
        authStatus: vi.fn().mockResolvedValue({ configured: true, method: 'api-key' as const }),
        start: vi.fn().mockResolvedValue(handle),
        resume: vi.fn().mockResolvedValue(handle),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);
      const systemMessages: string[] = [];
      adapter.on('system', (msg) => systemMessages.push(msg));

      await adapter.start('/ws/claude-lifecycle');
      await adapter.send('Execute isolation and finish', 'workspace-write');

      await vi.waitFor(() => {
        expect(approvals).toHaveLength(2);
      });

      expect(approvals[0].decision.behavior).toBe('deny');
      expect(approvals[0].decision.message).toContain("Workspace lifecycle tool 'isolate_repo' requires approval");
      expect(approvals[1].decision.behavior).toBe('deny');
      expect(approvals[1].decision.message).toContain("Workspace lifecycle tool 'finish_workspace' requires approval");
      expect(systemMessages.some((m) => m.includes('workspace lifecycle changes require dashboard or CLI'))).toBe(true);
    });

    it('forwards interactive approval requests to UI listener and applies respondToApproval decision', async () => {
      const { handle, approvals } = createMockSdkHandle([
        {
          type: 'approval_required',
          requestId: 'req-user-gate',
          tool: 'Bash',
          input: { command: 'git reset --hard' },
          description: 'Hard reset repository',
        } as any,
      ]);

      const mockAdapter = {
        vendor: 'claude-code' as const,
        authStatus: vi.fn().mockResolvedValue({ configured: true, method: 'api-key' as const }),
        start: vi.fn().mockResolvedValue(handle),
        resume: vi.fn().mockResolvedValue(handle),
        listSessions: vi.fn().mockResolvedValue([]),
      };

      const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);
      let capturedRequest: any = null;

      adapter.on('approval_request', (req) => {
        capturedRequest = req;
        // User approves via UI
        adapter.respondToApproval(req.requestId, 'allow');
      });

      await adapter.start('/ws/claude-interactive');
      await adapter.send('Reset repo', 'workspace-write');

      await vi.waitFor(() => {
        expect(capturedRequest).not.toBeNull();
        expect(approvals).toHaveLength(1);
      });

      expect(capturedRequest.tool).toBe('Bash');
      expect(capturedRequest.input.command).toBe('git reset --hard');
      expect(approvals[0]).toEqual({
        requestId: 'req-user-gate',
        decision: { behavior: 'allow' },
      });
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 2: Codex Harness & Adapters — Queue Serialization & Item Mapping
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 2 — Codex Harness & Adapters Adversarial Verification', () => {

  describe('2.1 Codex Usage Normalization Cache Math & Type Armor', () => {
    it('accurately resolves cacheRead + cacheWrite sum vs single cacheRead in extractCodexUsage', () => {
      // Both read and write present
      const resBoth = extractCodexUsage({
        input_tokens: 1000,
        output_tokens: 200,
        cached_input_tokens: 300,
        cache_write_input_tokens: 150,
      });
      expect(resBoth.cachedInputTokens).toBe(450);
      expect(resBoth.cacheReadInputTokens).toBe(300);
      expect(resBoth.cacheWriteInputTokens).toBe(150);

      // Only cache write present
      const resWriteOnly = extractCodexUsage({
        input_tokens: 500,
        output_tokens: 100,
        cache_write_input_tokens: 250,
      });
      expect(resWriteOnly.cachedInputTokens).toBe(250);
      expect(resWriteOnly.cacheWriteInputTokens).toBe(250);

      // Both zero
      const resZero = extractCodexUsage({
        input_tokens: 100,
        output_tokens: 50,
        cached_input_tokens: 0,
        cache_write_input_tokens: 0,
      });
      expect(resZero.cachedInputTokens).toBe(0);

      // Reasoning output tokens
      const resReasoning = extractCodexUsage({
        input_tokens: 800,
        output_tokens: 400,
        reasoning_output_tokens: 350,
      });
      expect(resReasoning.reasoningOutputTokens).toBe(350);
      expect(resReasoning.totalTokens).toBe(1200);
      expect(resReasoning.costConfidence).toBe('absent');
    });
  });

  describe('2.2 CodexCliAdapter Unhandled Event Sequences & Failure Modes', () => {
    it('fails turn if turn.completed arrives before any assistant message', async () => {
      const adapter = new TestableCodexCliAdapter();
      await adapter.start('/ws/codex-nomsg');

      let turnError: Error | null = null;
      adapter.on('error', (err) => { turnError = err; });

      const sendPromise = adapter.send('Summarize code');
      const child = adapter.spawned[0];

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'thread.started',
        thread_id: VALID_UUID_A,
      }) + '\n'));

      // No agent_message emitted, straight to turn.completed
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'turn.completed',
        usage: { input_tokens: 100, output_tokens: 0 },
      }) + '\n'));

      child.emit('close', 0);
      await sendPromise;

      expect(turnError).not.toBeNull();
      expect(turnError!.message).toContain('Codex completed without a recognizable assistant response');
      expect(turnError!.message).toContain('The active session remains resumable');
    });

    it('fails turn with conflicting thread identity if different UUID arrives after start', async () => {
      const adapter = new TestableCodexCliAdapter();
      await adapter.start('/ws/codex-conflict', { id: VALID_UUID_A, resume: true });

      let turnError: Error | null = null;
      adapter.on('error', (err) => { turnError = err; });

      const sendPromise = adapter.send('Resume turn');
      const child = adapter.spawned[0];

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'thread.started',
        thread_id: VALID_UUID_B, // Mismatched thread ID!
      }) + '\n'));

      child.emit('close', 0);
      await sendPromise;

      expect(turnError).not.toBeNull();
      expect(turnError!.message).toContain('Codex returned a conflicting thread identity');
      expect(turnError!.message).toContain('the active session remains resumable');
    });

    it('fails turn if process exits code 0 after partial message without turn.completed', async () => {
      const adapter = new TestableCodexCliAdapter();
      await adapter.start('/ws/codex-trunc');

      let turnError: Error | null = null;
      adapter.on('error', (err) => { turnError = err; });

      const sendPromise = adapter.send('Generate code');
      const child = adapter.spawned[0];

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'thread.started',
        thread_id: VALID_UUID_A,
      }) + '\n'));

      child.stdout.emit('data', Buffer.from(JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: 'function calculate() {' },
      }) + '\n'));

      // Process dies unexpectedly before turn.completed
      child.emit('close', 0);
      await sendPromise;

      expect(turnError).not.toBeNull();
      expect(turnError!.message).toContain('Codex CLI ended before confirming turn completion');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 3: Antigravity Telemetry & CLI Adapter — Resilient Parsing & Recovery
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 3 — Antigravity Telemetry & CLI Adapter Adversarial Verification', () => {

  describe('3.1 Resilient Token Aliasing & Multi-Format Parsing', () => {
    it('extracts tokens across all Gemini variants (prompt_tokens, completion_tokens, candidates_token_count, thinking_tokens)', () => {
      const raw1 = {
        prompt_tokens: 1500,
        completion_tokens: 300,
        cached_content_token_count: 500,
        thoughts_token_count: 120,
        cost_usd: 0.0045,
      };
      const u1 = extractNormalizedUsage(raw1);
      expect(u1.inputTokens).toBe(1500);
      expect(u1.outputTokens).toBe(300);
      expect(u1.cachedInputTokens).toBe(500);
      expect(u1.reasoningOutputTokens).toBe(120);
      expect(u1.costUsdEstimate).toBe(0.0045);
      expect(u1.costConfidence).toBe('estimated');

      const raw2 = {
        input_token_count: 2200,
        candidates_token_count: 850,
        thinking_tokens: 400,
        total_token_count: 3050,
      };
      const u2 = extractNormalizedUsage(raw2);
      expect(u2.inputTokens).toBe(2200);
      expect(u2.outputTokens).toBe(850);
      expect(u2.reasoningOutputTokens).toBe(400);
      expect(u2.totalTokens).toBe(3050);
      expect(u2.costConfidence).toBe('absent');
    });

    it('parses step_update backoff string into approaching_limit quota with valid resetsAt ISO string', () => {
      const line = JSON.stringify({
        event: 'step_update',
        step_update: {
          description: 'Gemini API rate-limit encountered, backing off for 35 seconds before retry...',
        },
      });

      const events = decodeAntigravityLine(line);
      const quotaEvt = events.find((e) => e.type === 'quota');

      expect(quotaEvt).toBeDefined();
      if (quotaEvt?.type === 'quota') {
        expect(quotaEvt.quota.requests?.status).toBe('approaching_limit');
        expect(quotaEvt.quota.requests?.resetInSeconds).toBe(35);
        expect(quotaEvt.quota.requests?.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(quotaEvt.quota.isEstimated).toBe(true);
      }
    });

    it('extracts quota exhaustion error from Antigravity result error status with retry delay', () => {
      const line = JSON.stringify({
        event: 'result',
        is_error: true,
        result: {
          status: 'ERROR',
          error: 'RESOURCE_EXHAUSTED: Quota exceeded for gemini-2.5-pro: retry after 25s',
        },
      });

      const events = decodeAntigravityLine(line);
      const quotaEvt = events.find((e) => e.type === 'quota');
      const errEvt = events.find((e) => e.type === 'error');

      expect(quotaEvt).toBeDefined();
      if (quotaEvt?.type === 'quota') {
        expect(quotaEvt.quota.requests?.status).toBe('exceeded');
        expect(quotaEvt.quota.requests?.remaining).toBe(0);
        expect(quotaEvt.quota.requests?.resetInSeconds).toBe(25);
      }
      expect(errEvt).toBeDefined();
      expect(errEvt?.message).toContain('RESOURCE_EXHAUSTED');
    });
  });

  describe('3.2 Antigravity Disk Transcript Discovery & Fallback Recovery', () => {
    let tmpDir: string;
    let historyFile: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ag-hist-'));
      historyFile = path.join(tmpDir, 'history.jsonl');
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    it('recovers unannounced session identity from history.jsonl when CLI stdout omits init', () => {
      const targetCwd = '/home/user/my-project';
      const now = Date.now();

      const record1 = {
        conversationId: VALID_UUID_A,
        workspace: targetCwd,
        timestamp: now - 2000,
      };
      const recordOlder = {
        conversationId: VALID_UUID_B,
        workspace: '/different/workspace',
        timestamp: now - 50000,
      };

      fs.writeFileSync(historyFile, `${JSON.stringify(recordOlder)}\n${JSON.stringify(record1)}\n`);

      const recovered = findAntigravitySessionIdForWorkspace(targetCwd, now - 1000, historyFile);
      expect(recovered).toBe(VALID_UUID_A);

      // Out of time range (>10s before start) returns null
      const tooOld = findAntigravitySessionIdForWorkspace(targetCwd, now + 50000, historyFile);
      expect(tooOld).toBeNull();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 4: ACP & Copilot Telemetry — Context Window Math, Permissions & Lifecycle
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 4 — ACP & Copilot Telemetry Adversarial Verification', () => {

  describe('4.1 extractAcpUsage Boundary & NaN Resilience', () => {
    it('handles non-finite values (NaN, Infinity, -Infinity) and calculates cached sum safely', () => {
      const u = extractAcpUsage({
        inputTokens: NaN as any,
        outputTokens: Infinity as any,
        cachedReadTokens: 400,
        cachedWriteTokens: 100,
        thoughtTokens: 250,
      } as any);

      expect(u.inputTokens).toBe(0); // NaN fallback to 0
      expect(u.outputTokens).toBe(0); // Infinity fallback to 0
      expect(u.cachedInputTokens).toBe(500); // 400 + 100
      expect(u.cacheReadInputTokens).toBe(400);
      expect(u.cacheWriteInputTokens).toBe(100);
      expect(u.reasoningOutputTokens).toBe(250);
      expect(u.costConfidence).toBe('absent');
    });
  });

  describe('4.2 ACP Context Window Usage Updates & Zero Size Protection', () => {
    it('omits utilizationPercent when context window size is 0 to prevent 0/0 = NaN', async () => {
      const { connection } = createMockAcpConnection();
      let capturedClient: acp.Client | undefined;

      const harness = new AcpCliAdapter({
        executable: 'copilot',
        args: ['--acp'],
        label: 'GitHub Copilot CLI',
        transportFactory: (opts) => {
          capturedClient = opts.client;
          return {
            process: new MockSubprocess() as unknown as ChildProcess,
            connection,
          };
        },
      });

      const emittedQuotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q) => emittedQuotas.push(q));

      await harness.start('/ws/copilot-zero');

      // Dispatch usage_update notification with size: 0
      await capturedClient!.sessionUpdate({
        sessionId: VALID_UUID_A,
        update: {
          sessionUpdate: 'usage_update',
          used: 0,
          size: 0,
        } as any,
      });

      expect(emittedQuotas).toHaveLength(1);
      expect(emittedQuotas[0].contextWindow?.usedTokens).toBe(0);
      expect(emittedQuotas[0].contextWindow?.maxTokens).toBe(0);
      expect(emittedQuotas[0].contextWindow?.utilizationPercent).toBeUndefined(); // NO NaN!
    });

    it('calculates over-100% utilization cleanly when context window is exceeded', async () => {
      const { connection } = createMockAcpConnection();
      let capturedClient: acp.Client | undefined;

      const harness = new AcpCliAdapter({
        executable: 'copilot',
        args: ['--acp'],
        label: 'GitHub Copilot CLI',
        transportFactory: (opts) => {
          capturedClient = opts.client;
          return {
            process: new MockSubprocess() as unknown as ChildProcess,
            connection,
          };
        },
      });

      const emittedQuotas: NormalizedRemainingQuota[] = [];
      harness.on('quota', (q) => emittedQuotas.push(q));

      await harness.start('/ws/copilot-over');

      await capturedClient!.sessionUpdate({
        sessionId: VALID_UUID_A,
        update: {
          sessionUpdate: 'usage_update',
          used: 150_000,
          size: 100_000,
        } as any,
      });

      expect(emittedQuotas).toHaveLength(1);
      expect(emittedQuotas[0].contextWindow?.utilizationPercent).toBe(150);
    });
  });

  describe('4.3 ACP Permission Gating & Subprocess Error Tail Capture', () => {
    it('decideReadOnlyPermission fails closed by selecting reject_once/reject_always', () => {
      const decisionReject = decideReadOnlyPermission({
        sessionId: VALID_UUID_A,
        toolCall: { kind: 'execute' } as any,
        options: [
          { optionId: 'opt-allow', kind: 'allow_once', title: 'Allow' },
          { optionId: 'opt-reject', kind: 'reject_once', title: 'Reject' },
        ],
      });
      expect(decisionReject).toEqual({
        outcome: { outcome: 'selected', optionId: 'opt-reject' },
      });

      // If no reject options offered, returns cancelled
      const decisionCancel = decideReadOnlyPermission({
        sessionId: VALID_UUID_A,
        toolCall: { kind: 'read' } as any,
        options: [{ optionId: 'opt-allow', kind: 'allow_once', title: 'Allow' }],
      });
      expect(decisionCancel).toEqual({ outcome: { outcome: 'cancelled' } });
    });

    it('captures stderr tail and attaches to error event when ACP subprocess crashes', async () => {
      const child = new MockSubprocess();
      const { connection } = createMockAcpConnection();

      const harness = new AcpCliAdapter({
        executable: 'copilot',
        args: ['--acp'],
        label: 'GitHub Copilot CLI',
        transportFactory: () => ({
          process: child as unknown as ChildProcess,
          connection,
        }),
      });

      let capturedError: Error | null = null;
      harness.on('error', (err) => { capturedError = err; });

      await harness.start('/ws/copilot-crash');

      // Subprocess outputs error to stderr and dies
      child.stderr.emit('data', Buffer.from('fatal: authentication token expired\n'));
      child.emit('close', 1);

      expect(capturedError).not.toBeNull();
      expect(capturedError!.message).toContain('ACP process exited with code 1');
      expect(capturedError!.message).toContain('authentication token expired');
    });

    it('buildCopilotAcpArgs produces restricted tool flags', () => {
      const args = buildCopilotAcpArgs();
      expect(args).toContain('--acp');
      expect(args).toContain('--stdio');
      expect(args).toContain('--available-tools=view,glob,grep');
      expect(args).toContain('--no-ask-user');
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 5: TurnSessionManager — Multi-Harness Accumulation & Session Lifecycle
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 5 — TurnSessionManager Multi-Harness & Lifecycle Verification', () => {
  let manager: TurnSessionManager;
  let mockAgent: MockAgentHarness;
  let mockProvider: ProviderAdapter;

  class MockAgentHarness extends EventEmitter implements AgentHarness {
    public lastPrompt = '';
    public lastProfile?: any;
    async start(_cwd: string) {}
    async send(data: string, profile?: any) {
      this.lastPrompt = data;
      this.lastProfile = profile;
    }
    stop() {}
  }

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TurnSessionManager();
    mockAgent = new MockAgentHarness();
    mockProvider = {
      id: 'test-provider',
      name: 'Test Provider',
      capabilities: { transport: 'sdk', sessionIdentity: 'provider-assigned', workspaceAccess: 'workspace-write' },
      executionProfiles: [
        { id: 'workspace-write', label: 'Write', description: 'Write' },
        { id: 'review', label: 'Review', description: 'Review' },
      ],
      isConfigured: () => true,
      getStatusMessage: () => 'Ready',
      createInstance: () => mockAgent,
    };
  });

  afterEach(() => {
    manager.clear();
    vi.useRealTimers();
  });

  describe('5.1 Cross-Provider Telemetry Accumulation Under Mixed Streams', () => {
    it('accurately accumulates tokens, cache breakdown, reasoning, and costs across 4 distinct provider turns', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/multi-accum',
        command: 'test-provider',
        client,
        provider: mockProvider,
      });

      // Turn 1: Claude-style (cache write/read + estimated cost)
      manager.dispatchInput('/ws/multi-accum', { input: 'Turn 1: Claude', executionProfile: 'workspace-write' });
      mockAgent.emit('usage', {
        inputTokens: 1000,
        outputTokens: 250,
        cachedInputTokens: 300,
        cacheReadInputTokens: 200,
        cacheWriteInputTokens: 100,
        costUsdEstimate: 0.015,
        costConfidence: 'estimated',
      });
      mockAgent.emit('idle');

      // Turn 2: Codex-style (reasoning tokens + absent cost)
      manager.dispatchInput('/ws/multi-accum', { input: 'Turn 2: Codex', executionProfile: 'workspace-write' });
      mockAgent.emit('usage', {
        inputTokens: 800,
        outputTokens: 300,
        cachedInputTokens: 200,
        reasoningOutputTokens: 250,
        costConfidence: 'absent',
      });
      mockAgent.emit('idle');

      // Turn 3: Antigravity-style (Gemini tokens + cost)
      manager.dispatchInput('/ws/multi-accum', { input: 'Turn 3: Antigravity', executionProfile: 'workspace-write' });
      mockAgent.emit('usage', {
        inputTokens: 1500,
        outputTokens: 400,
        cachedInputTokens: 400,
        costUsdEstimate: 0.005,
        costConfidence: 'estimated',
      });
      mockAgent.emit('idle');

      // Turn 4: Copilot-style (context window quota + thought tokens)
      manager.dispatchInput('/ws/multi-accum', { input: 'Turn 4: Copilot', executionProfile: 'workspace-write' });
      mockAgent.emit('quota', {
        contextWindow: { usedTokens: 50000, maxTokens: 128000, utilizationPercent: 39.06 },
      });
      mockAgent.emit('usage', {
        inputTokens: 1200,
        outputTokens: 350,
        reasoningOutputTokens: 150,
      });
      mockAgent.emit('idle');

      const cumulative = session.cumulativeUsage;
      expect(cumulative.inputTokens).toBe(1000 + 800 + 1500 + 1200); // 4,500
      expect(cumulative.outputTokens).toBe(250 + 300 + 400 + 350);   // 1,300
      expect(cumulative.totalTokens).toBe(4500 + 1300);              // 5,800
      expect(cumulative.cachedInputTokens).toBe(300 + 200 + 400);    // 900
      expect(cumulative.cacheReadInputTokens).toBe(200);
      expect(cumulative.cacheWriteInputTokens).toBe(100);
      expect(cumulative.reasoningOutputTokens).toBe(250 + 150);       // 400
      expect(cumulative.costUsdEstimate).toBeCloseTo(0.015 + 0.005, 5); // 0.020
      expect(cumulative.costConfidence).toBe('estimated');
      expect(session.latestQuota?.contextWindow?.usedTokens).toBe(50000);
    });
  });

  describe('5.2 Headless Turn Watchdog & Graceful Disconnect/Reconnect Lifecycle', () => {
    it('switches from 10-minute headless watchdog to 2-minute idle countdown when running turn finishes after client detach', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/watchdog-lifecycle',
        command: 'test-provider',
        client,
        provider: mockProvider,
      });

      // Dispatch busy turn
      const disp = manager.dispatchInput('/ws/watchdog-lifecycle', { input: 'Long refactoring turn', executionProfile: 'workspace-write' });
      expect(disp.accepted).toBe(true);
      expect(session.isBusy).toBe(true);

      // Client unregisters while turn is busy
      manager.unregisterClient('/ws/watchdog-lifecycle', client);
      expect(session.clients.size).toBe(0);
      expect(session.disconnectTimer).not.toBeNull();

      // Fast-forward 5 minutes: turn is still running in headless mode, session NOT stopped
      vi.advanceTimersByTime(300_000);
      expect(manager.getSession('/ws/watchdog-lifecycle')).toBeDefined();

      // Turn finally finishes!
      mockAgent.emit('idle');
      expect(session.isBusy).toBe(false);

      // 10m watchdog should now have transitioned to 2m (120,000ms) idle countdown
      // Fast-forward 119 seconds: session still alive
      vi.advanceTimersByTime(119_000);
      expect(manager.getSession('/ws/watchdog-lifecycle')).toBeDefined();

      // Advance 2 more seconds (total 121s): idle timer expires, session cleanly disposed
      vi.advanceTimersByTime(2_000);
      expect(manager.getSession('/ws/watchdog-lifecycle')).toBeUndefined();
    });

    it('cancels idle countdown if client reconnects before 2 minutes expire', async () => {
      const client1: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/reconnect-grace',
        command: 'test-provider',
        client: client1,
        provider: mockProvider,
      });

      // Client1 disconnects while session is idle
      manager.unregisterClient('/ws/reconnect-grace', client1);
      expect(session.disconnectTimer).not.toBeNull();

      // Fast-forward 90 seconds (less than 120s grace period)
      vi.advanceTimersByTime(90_000);
      expect(manager.getSession('/ws/reconnect-grace')).toBeDefined();

      // Client2 connects: timer must be cancelled
      const client2: TurnClient = { send: vi.fn() };
      await manager.startSession({
        workspaceCwd: '/ws/reconnect-grace',
        command: 'test-provider',
        client: client2,
        provider: mockProvider,
      });

      expect(session.disconnectTimer).toBeNull();

      // Fast-forward another 2 minutes: session remains alive!
      vi.advanceTimersByTime(120_000);
      expect(manager.getSession('/ws/reconnect-grace')).toBeDefined();
    });
  });

  describe('5.3 Concurrency, Gate Rejection & In-Flight Start Deduplication', () => {
    it('returns rejected: true when prompt dispatched to an actively busy turn without corrupting gate', async () => {
      const client: TurnClient = { send: vi.fn() };
      await manager.startSession({
        workspaceCwd: '/ws/gate-reject',
        command: 'test-provider',
        client,
        provider: mockProvider,
      });

      const res1 = manager.dispatchInput('/ws/gate-reject', { input: 'Turn 1', executionProfile: 'workspace-write' });
      expect(res1.accepted).toBe(true);

      const res2 = manager.dispatchInput('/ws/gate-reject', { input: 'Turn 2 (concurrent)', executionProfile: 'workspace-write' });
      expect(res2.rejected).toBe(true);

      // Complete Turn 1
      mockAgent.emit('idle');

      // Now Turn 3 can proceed cleanly
      const res3 = manager.dispatchInput('/ws/gate-reject', { input: 'Turn 3', executionProfile: 'workspace-write' });
      expect(res3.accepted).toBe(true);
    });

    it('validates empty inputs and settles turn gate immediately without getting stuck', async () => {
      const client: TurnClient = { send: vi.fn() };
      await manager.startSession({
        workspaceCwd: '/ws/gate-invalid',
        command: 'test-provider',
        client,
        provider: mockProvider,
      });

      const emptyRes = manager.dispatchInput('/ws/gate-invalid', { input: '   ', executionProfile: 'workspace-write' });
      expect(emptyRes.error).toContain('non-empty input message is required');

      // Turn gate must be settled immediately, allowing next prompt
      const validRes = manager.dispatchInput('/ws/gate-invalid', { input: 'Valid prompt', executionProfile: 'workspace-write' });
      expect(validRes.accepted).toBe(true);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// SUITE 6: JSONL Decoder Chunk Fragmentation & 8MB Oversized Boundaries
// ───────────────────────────────────────────────────────────────────────────────

describe('Tier 5: Suite 6 — JSONL Stream Fragmentation & Oversized Record Protection', () => {

  it('ClaudeJsonlDecoder seamlessly reassembles a single JSON record fragmented across multiple 10-byte chunks', () => {
    const decoder = new ClaudeJsonlDecoder();
    const fullRecord = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Assembled response from fragmented packets.',
      usage: { input_tokens: 120, output_tokens: 45 },
    }) + '\n';

    const events: any[] = [];
    const chunkSize = 10;
    for (let i = 0; i < fullRecord.length; i += chunkSize) {
      const chunk = fullRecord.slice(i, i + chunkSize);
      events.push(...decoder.push(chunk));
    }
    events.push(...decoder.finish());

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('complete');
    expect(events[0].text).toBe('Assembled response from fragmented packets.');
  });

  it('CodexJsonlDecoder fails fail-closed when a record exceeds 8MB and ignores subsequent chunks', () => {
    const decoder = new CodexJsonlDecoder(1024); // Use small 1KB threshold for fast memory-safe testing
    const oversizedChunk = 'a'.repeat(2048);

    const events = decoder.push(oversizedChunk);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'error',
      message: 'Codex structured output exceeded the supported record size.',
      source: 'protocol',
    });

    // Subsequent pushes return empty array (decoder marked failed)
    const subsequent = decoder.push('{"type":"turn.completed"}\n');
    expect(subsequent).toHaveLength(0);
  });

  it('AntigravityJsonlDecoder handles multiple records concatenated in a single buffer chunk', () => {
    const decoder = new AntigravityJsonlDecoder();
    const multiRecord = [
      JSON.stringify({ event: 'init', conversation_id: VALID_UUID_A }),
      JSON.stringify({ event: 'message', text: 'Chunk 1' }),
      JSON.stringify({ event: 'message', text: 'Chunk 2' }),
      JSON.stringify({ event: 'result', result: 'Final result' }),
    ].join('\n') + '\n';

    const events = decoder.push(multiRecord);
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe('session');
    expect(events[1].text).toBe('Chunk 1');
    expect(events[2].text).toBe('Chunk 2');
    expect(events[3].type).toBe('result');
  });
});
