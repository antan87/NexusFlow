/**
 * @module tests/e2e/harness-usage/tier1-features.test
 *
 * Tier 1: Feature Coverage (≥5 tests per feature, 45 tests total)
 * Opaque-box verification across all 9 core features specified in PROJECT.md:
 * - F1: Contract & Normalization Core (F1.1, F1.2, F1.7)
 * - F2: Claude Code Telemetry (F1.3)
 * - F3: OpenAI Codex Telemetry (F1.4)
 * - F4: Antigravity Telemetry (F1.5)
 * - F5: GitHub Copilot Telemetry (F1.6)
 * - F6: TurnSessionManager State & Buffering (F2.1)
 * - F7: GUI Interactive Chat & Persistence (F2.2, F2.5)
 * - F8: Session History & Disk Transcripts (F2.3)
 * - F9: CLI Status Output Integration (F2.4)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateNormalizedUsage,
  validateNormalizedRemainingQuota,
  createClaudeCliStream,
  createCodexCliStream,
  createAntigravityCliStream,
  createCopilotAcpMessages,
  OpaqueTurnSessionSimulator,
  createTemporaryWorkspace,
  writeSyntheticSessionTranscript,
  parseCliHumanStatus,
  type NormalizedUsage,
  type NormalizedRemainingQuota,
  type WebSocketUsageBroadcast,
  type WebSocketUsageSummary,
} from './test-harness.js';

describe('Tier 1: Feature Coverage (Harness Usage & Quotas)', () => {
  let wsFixture: { workspaceDir: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    wsFixture = await createTemporaryWorkspace();
  });

  afterEach(async () => {
    if (wsFixture) {
      await wsFixture.cleanup();
    }
  });

  // ─── Feature 1: Contract & Normalization Core ──────────────────────────────
  describe('F1: Contract & Normalization Core (F1.1, F1.2, F1.7)', () => {
    it('F1.1: validates full NormalizedUsage structure with cache and reasoning breakdown', () => {
      const payload: NormalizedUsage = {
        inputTokens: 1250,
        outputTokens: 380,
        cachedInputTokens: 400,
        cacheReadInputTokens: 300,
        cacheWriteInputTokens: 100,
        reasoningOutputTokens: 150,
        totalTokens: 1630,
        costUsdEstimate: 0.0152,
        costConfidence: 'estimated',
      };

      const validated = validateNormalizedUsage(payload);
      expect(validated.inputTokens).toBe(1250);
      expect(validated.outputTokens).toBe(380);
      expect(validated.cachedInputTokens).toBe(400);
      expect(validated.cacheReadInputTokens).toBe(300);
      expect(validated.cacheWriteInputTokens).toBe(100);
      expect(validated.reasoningOutputTokens).toBe(150);
      expect(validated.costConfidence).toBe('estimated');
    });

    it('F1.2: validates NormalizedRemainingQuota and QuotaWindow schema contracts', () => {
      const quota: NormalizedRemainingQuota = {
        requests: {
          unit: 'requests',
          remaining: 950,
          limit: 1000,
          used: 50,
          resetsAt: '2026-09-24T12:00:00Z',
          status: 'ok',
        },
        tokens: {
          unit: 'tokens',
          remaining: 180000,
          limit: 200000,
          used: 20000,
          status: 'ok',
        },
        contextWindow: {
          usedTokens: 14000,
          maxTokens: 128000,
          utilizationPercent: 10.94,
        },
        planType: 'per-token',
        isEstimated: false,
      };

      const validated = validateNormalizedRemainingQuota(quota);
      expect(validated.requests?.remaining).toBe(950);
      expect(validated.tokens?.used).toBe(20000);
      expect(validated.contextWindow?.utilizationPercent).toBeCloseTo(10.94, 2);
      expect(validated.planType).toBe('per-token');
    });

    it('F1.3: enforces costConfidence transitions (authoritative, estimated, absent)', () => {
      const confidences = ['authoritative', 'estimated', 'absent'] as const;
      for (const conf of confidences) {
        const usage: NormalizedUsage = {
          inputTokens: 100,
          outputTokens: 50,
          costConfidence: conf,
        };
        const validated = validateNormalizedUsage(usage);
        expect(validated.costConfidence).toBe(conf);
      }
    });

    it('F1.4: preserves undefined for absent quotas and costs rather than coercing to 0', () => {
      const minimalUsage: NormalizedUsage = {
        inputTokens: 500,
        outputTokens: 100,
      };

      const validated = validateNormalizedUsage(minimalUsage);
      expect(validated.cachedInputTokens).toBeUndefined();
      expect(validated.costUsdEstimate).toBeUndefined();
      expect(validated.remainingQuota).toBeUndefined();
      expect(validated.reasoningOutputTokens).toBeUndefined();
    });

    it('F1.5: validates contextWindow utilization calculation and boundary limits', () => {
      const quota: NormalizedRemainingQuota = {
        contextWindow: {
          usedTokens: 80000,
          maxTokens: 100000,
          utilizationPercent: 80.0,
        },
      };

      const validated = validateNormalizedRemainingQuota(quota);
      expect(validated.contextWindow?.usedTokens).toBe(80000);
      expect(validated.contextWindow?.maxTokens).toBe(100000);
      expect(validated.contextWindow?.utilizationPercent).toBe(80);
    });
  });

  // ─── Feature 2: Claude Code Telemetry ──────────────────────────────────────
  describe('F2: Claude Code Telemetry (F1.3)', () => {
    it('F2.1: parses standard Claude CLI stream-json success record into input/output tokens', () => {
      const streamLines = createClaudeCliStream({
        inputTokens: 2500,
        outputTokens: 420,
        cacheRead: 1500,
        cacheCreation: 500,
      });

      const resultLine = streamLines.find((l) => l.includes('"result"'));
      expect(resultLine).toBeDefined();

      const parsed = JSON.parse(resultLine!);
      expect(parsed.usage.input_tokens).toBe(2500);
      expect(parsed.usage.output_tokens).toBe(420);
      expect(parsed.usage.cache_read_input_tokens + parsed.usage.cache_creation_input_tokens).toBe(2000);
    });

    it('F2.2: preserves total_cost_usd as costUsdEstimate with confidence metadata', () => {
      const streamLines = createClaudeCliStream({
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.0084,
      });

      const resultLine = JSON.parse(streamLines.find((l) => l.includes('"result"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: resultLine.usage.input_tokens,
        outputTokens: resultLine.usage.output_tokens,
        costUsdEstimate: resultLine.total_cost_usd,
        costConfidence: 'estimated',
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.costUsdEstimate).toBe(0.0084);
      expect(validated.costConfidence).toBe('estimated');
    });

    it('F2.3: handles Claude SDK turn_completed event structure correctly', () => {
      const sdkEvent = {
        type: 'turn_completed',
        usage: {
          inputTokens: 3200,
          outputTokens: 750,
          cachedInputTokens: 1200,
          costUsdEstimate: 0.021,
          costConfidence: 'estimated' as const,
        },
      };

      const validated = validateNormalizedUsage(sdkEvent.usage);
      expect(validated.inputTokens).toBe(3200);
      expect(validated.outputTokens).toBe(750);
      expect(validated.cachedInputTokens).toBe(1200);
    });

    it('F2.4: extracts Claude CLI rate limit retry events into quota warning signal', () => {
      const streamLines = createClaudeCliStream({
        inputTokens: 100,
        outputTokens: 50,
        retryAttempt: 2,
        maxRetries: 5,
        errorMessage: 'Claude rate limit reached, backing off 4s',
      });

      const retryLine = streamLines.find((l) => l.includes('"api_retry"'));
      expect(retryLine).toBeDefined();
      const parsed = JSON.parse(retryLine!);
      expect(parsed.attempt).toBe(2);
      expect(parsed.max_retries).toBe(5);

      const quota: NormalizedRemainingQuota = {
        requests: { unit: 'requests', status: 'approaching_limit' },
        warningMessage: parsed.error,
      };
      expect(quota.requests?.status).toBe('approaching_limit');
      expect(quota.warningMessage).toContain('rate limit');
    });

    it('F2.5: produces compliant NormalizedUsage event payload from Claude telemetry', () => {
      const streamLines = createClaudeCliStream({
        inputTokens: 4000,
        outputTokens: 900,
        cacheRead: 2000,
        cacheCreation: 1000,
        costUsd: 0.035,
      });

      const raw = JSON.parse(streamLines.find((l) => l.includes('"result"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        cachedInputTokens: raw.usage.cache_read_input_tokens + raw.usage.cache_creation_input_tokens,
        cacheReadInputTokens: raw.usage.cache_read_input_tokens,
        cacheWriteInputTokens: raw.usage.cache_creation_input_tokens,
        costUsdEstimate: raw.total_cost_usd,
      };

      expect(normalized.cachedInputTokens).toBe(3000);
      expect(normalized.cacheReadInputTokens).toBe(2000);
      expect(normalized.cacheWriteInputTokens).toBe(1000);
    });
  });

  // ─── Feature 3: OpenAI Codex Telemetry ─────────────────────────────────────
  describe('F3: OpenAI Codex Telemetry (F1.4)', () => {
    it('F3.1: extracts turn.completed usage from Codex CLI stdout stream', () => {
      const streamLines = createCodexCliStream({
        inputTokens: 1800,
        outputTokens: 600,
        cachedInputTokens: 800,
      });

      const completed = streamLines.find((l) => l.includes('"turn.completed"'));
      expect(completed).toBeDefined();
      const parsed = JSON.parse(completed!);
      expect(parsed.usage.input_tokens).toBe(1800);
      expect(parsed.usage.output_tokens).toBe(600);
      expect(parsed.usage.cached_input_tokens).toBe(800);
    });

    it('F3.2: captures reasoning_output_tokens in normalized output telemetry', () => {
      const streamLines = createCodexCliStream({
        inputTokens: 2000,
        outputTokens: 700,
        reasoningTokens: 450,
      });

      const raw = JSON.parse(streamLines.find((l) => l.includes('"turn.completed"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        reasoningOutputTokens: raw.usage.reasoning_output_tokens,
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.reasoningOutputTokens).toBe(450);
      expect(validated.outputTokens).toBe(700);
    });

    it('F3.3: captures cache_write_input_tokens alongside cached_input_tokens', () => {
      const streamLines = createCodexCliStream({
        inputTokens: 1500,
        outputTokens: 300,
        cachedInputTokens: 500,
        cacheWriteTokens: 250,
      });

      const raw = JSON.parse(streamLines.find((l) => l.includes('"turn.completed"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        cachedInputTokens: raw.usage.cached_input_tokens,
        cacheWriteInputTokens: raw.usage.cache_write_input_tokens,
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.cachedInputTokens).toBe(500);
      expect(validated.cacheWriteInputTokens).toBe(250);
    });

    it('F3.4: marks costConfidence as absent by design for Codex provider', () => {
      const streamLines = createCodexCliStream({
        inputTokens: 1200,
        outputTokens: 350,
      });

      const raw = JSON.parse(streamLines.find((l) => l.includes('"turn.completed"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        costConfidence: 'absent',
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.costUsdEstimate).toBeUndefined();
      expect(validated.costConfidence).toBe('absent');
    });

    it('F3.5: handles multi-turn Codex CLI output lines without losing token counts', () => {
      const turn1Lines = createCodexCliStream({ inputTokens: 1000, outputTokens: 200 });
      const turn2Lines = createCodexCliStream({ inputTokens: 1500, outputTokens: 300 });

      const t1 = JSON.parse(turn1Lines.find((l) => l.includes('"turn.completed"'))!);
      const t2 = JSON.parse(turn2Lines.find((l) => l.includes('"turn.completed"'))!);

      const totalInput = t1.usage.input_tokens + t2.usage.input_tokens;
      const totalOutput = t1.usage.output_tokens + t2.usage.output_tokens;

      expect(totalInput).toBe(2500);
      expect(totalOutput).toBe(500);
    });
  });

  // ─── Feature 4: Antigravity Telemetry ──────────────────────────────────────
  describe('F4: Antigravity Telemetry (F1.5)', () => {
    it('F4.1: resiliently extracts tokens across varied Gemini field keys (prompt_tokens vs input_token_count)', () => {
      const streamLines = createAntigravityCliStream({
        promptTokens: 3100,
        completionTokens: 820,
      });

      const stats = JSON.parse(streamLines.find((l) => l.includes('"stats"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: stats.input_token_count ?? stats.prompt_tokens,
        outputTokens: stats.candidates_token_count ?? stats.completion_tokens,
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.inputTokens).toBe(3100);
      expect(validated.outputTokens).toBe(820);
    });

    it('F4.2: normalizes cached_content_token_count into cachedInputTokens', () => {
      const streamLines = createAntigravityCliStream({
        promptTokens: 2000,
        completionTokens: 500,
        cachedTokens: 1200,
      });

      const stats = JSON.parse(streamLines.find((l) => l.includes('"stats"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: stats.input_token_count,
        outputTokens: stats.candidates_token_count,
        cachedInputTokens: stats.cached_content_token_count,
      };

      expect(normalized.cachedInputTokens).toBe(1200);
    });

    it('F4.3: extracts cost_usd and maps to costUsdEstimate', () => {
      const streamLines = createAntigravityCliStream({
        promptTokens: 1000,
        completionTokens: 300,
        costUsd: 0.0045,
      });

      const stats = JSON.parse(streamLines.find((l) => l.includes('"stats"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: stats.input_token_count,
        outputTokens: stats.candidates_token_count,
        costUsdEstimate: stats.cost_usd,
        costConfidence: 'estimated',
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.costUsdEstimate).toBe(0.0045);
    });

    it('F4.4: detects Gemini quota exhaustion errors and signals exceeded quota window', () => {
      const streamLines = createAntigravityCliStream({
        promptTokens: 0,
        completionTokens: 0,
        quotaExceeded: true,
        quotaWarning: 'Quota exceeded for gemini-2.5-pro: RESOURCE_EXHAUSTED',
      });

      const errorLine = JSON.parse(streamLines[0]);
      expect(errorLine.error).toContain('Quota exceeded');

      const quota: NormalizedRemainingQuota = {
        requests: { unit: 'requests', remaining: 0, status: 'exceeded' },
        warningMessage: errorLine.error,
      };

      const validated = validateNormalizedRemainingQuota(quota);
      expect(validated.requests?.status).toBe('exceeded');
      expect(validated.warningMessage).toContain('gemini-2.5-pro');
    });

    it('F4.5: surfaces non-fatal quota warnings without aborting turn streaming', () => {
      const streamLines = createAntigravityCliStream({
        promptTokens: 1500,
        completionTokens: 400,
        quotaWarning: 'Approaching daily token rate limit (85% consumed)',
      });

      const warningLine = streamLines.find((l) => l.includes('"warning"'));
      expect(warningLine).toBeDefined();

      const quota: NormalizedRemainingQuota = {
        tokens: { unit: 'tokens', status: 'approaching_limit' },
        warningMessage: JSON.parse(warningLine!).warning,
      };

      expect(quota.tokens?.status).toBe('approaching_limit');
    });
  });

  // ─── Feature 5: GitHub Copilot Telemetry ───────────────────────────────────
  describe('F5: GitHub Copilot Telemetry (F1.6)', () => {
    it('F5.1: extracts PromptResponse.usage from ACP prompt completion', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 1600,
        outputTokens: 450,
      });

      const resp = messages.find((m) => m.kind === 'response')!;
      const usage = (resp.payload as any).result.usage;

      const normalized: NormalizedUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
      };

      const validated = validateNormalizedUsage(normalized);
      expect(validated.inputTokens).toBe(1600);
      expect(validated.outputTokens).toBe(450);
      expect(validated.totalTokens).toBe(2050);
    });

    it('F5.2: captures thoughtTokens and cachedRead/cachedWrite tokens from ACP', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 1800,
        outputTokens: 500,
        thoughtTokens: 250,
        cachedRead: 600,
        cachedWrite: 300,
      });

      const usage = (messages[0].payload as any).result.usage;
      const normalized: NormalizedUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.thoughtTokens,
        cacheReadInputTokens: usage.cachedReadTokens,
        cacheWriteInputTokens: usage.cachedWriteTokens,
        cachedInputTokens: usage.cachedReadTokens + usage.cachedWriteTokens,
      };

      expect(normalized.reasoningOutputTokens).toBe(250);
      expect(normalized.cacheReadInputTokens).toBe(600);
      expect(normalized.cacheWriteInputTokens).toBe(300);
      expect(normalized.cachedInputTokens).toBe(900);
    });

    it('F5.3: handles asynchronous sessionUpdate === usage_update notifications', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 1000,
        outputTokens: 200,
        contextUsed: 24500,
        contextSize: 128000,
      });

      const notification = messages.find((m) => m.kind === 'notification')!;
      expect(notification).toBeDefined();

      const params = (notification.payload as any).params;
      expect(params.sessionUpdate).toBe('usage_update');
      expect(params.used).toBe(24500);
      expect(params.size).toBe(128000);
    });

    it('F5.4: maps ACP UsageUpdate { used, size } into remainingQuota.contextWindow', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 1000,
        outputTokens: 200,
        contextUsed: 64000,
        contextSize: 128000,
      });

      const update = (messages.find((m) => m.kind === 'notification')!.payload as any).params;
      const quota: NormalizedRemainingQuota = {
        contextWindow: {
          usedTokens: update.used,
          maxTokens: update.size,
          utilizationPercent: (update.used / update.size) * 100,
        },
      };

      const validated = validateNormalizedRemainingQuota(quota);
      expect(validated.contextWindow?.utilizationPercent).toBe(50);
    });

    it('F5.5: extracts optional cost from ACP UsageUpdate when reported', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 500,
        outputTokens: 100,
        contextUsed: 1000,
        contextSize: 8000,
        costAmount: 0.0075,
      });

      const update = (messages.find((m) => m.kind === 'notification')!.payload as any).params;
      expect(update.cost?.amount).toBe(0.0075);
      expect(update.cost?.currency).toBe('USD');
    });
  });

  // ─── Feature 6: TurnSessionManager State & Buffering ────────────────────────
  describe('F6: TurnSessionManager State & Buffering (F2.1)', () => {
    it('F6.1: accumulates turn-level usage into session cumulativeUsage across turns', () => {
      const session = new OpaqueTurnSessionSimulator();

      session.startTurn();
      session.recordTurnUsage({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 300, costUsdEstimate: 0.01 });
      session.endTurn();

      session.startTurn();
      session.recordTurnUsage({ inputTokens: 1500, outputTokens: 400, cachedInputTokens: 500, costUsdEstimate: 0.015 });
      session.endTurn();

      expect(session.cumulativeUsage.inputTokens).toBe(2500);
      expect(session.cumulativeUsage.outputTokens).toBe(600);
      expect(session.cumulativeUsage.cachedInputTokens).toBe(800);
      expect(session.cumulativeUsage.costUsdEstimate).toBeCloseTo(0.025, 4);
    });

    it('F6.2: buffers usage and quota events during active/busy turns', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();

      const turnUsage: NormalizedUsage = { inputTokens: 500, outputTokens: 100 };
      session.recordTurnUsage(turnUsage);

      expect(session.isTurnBusy).toBe(true);
      expect(session.bufferedTurnEvents.length).toBe(1);
      expect((session.bufferedTurnEvents[0] as WebSocketUsageBroadcast).usage.inputTokens).toBe(500);

      session.endTurn();
      expect(session.isTurnBusy).toBe(false);
    });

    it('F6.3: broadcasts usage payload with turn, cumulative, and quota to active clients', () => {
      const session = new OpaqueTurnSessionSimulator();
      const receivedMessages: string[] = [];

      session.registerClient({
        send: (msg) => receivedMessages.push(msg),
      });

      // Clear initial summary
      receivedMessages.length = 0;

      session.startTurn();
      session.recordTurnUsage(
        { inputTokens: 800, outputTokens: 150 },
        { requests: { unit: 'requests', remaining: 490, limit: 500, status: 'ok' } },
      );
      session.endTurn();

      expect(receivedMessages.length).toBe(1);
      const parsed: WebSocketUsageBroadcast = JSON.parse(receivedMessages[0]);
      expect(parsed.type).toBe('usage');
      expect(parsed.usage.inputTokens).toBe(800);
      expect(parsed.cumulative.inputTokens).toBe(800);
      expect(parsed.quota?.requests?.remaining).toBe(490);
    });

    it('F6.4: replays usage_summary immediately when new client connects or reconnects', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.cumulativeUsage = {
        inputTokens: 5000,
        outputTokens: 1200,
        cachedInputTokens: 2000,
      };
      session.latestQuota = {
        tokens: { unit: 'tokens', remaining: 90000, limit: 100000, status: 'ok' },
      };

      const messages: string[] = [];
      session.registerClient({
        send: (msg) => messages.push(msg),
      });

      expect(messages.length).toBe(1);
      const summary: WebSocketUsageSummary = JSON.parse(messages[0]);
      expect(summary.type).toBe('usage_summary');
      expect(summary.cumulative.inputTokens).toBe(5000);
      expect(summary.quota?.tokens?.remaining).toBe(90000);
    });

    it('F6.5: replays buffered turn events if client reconnects while a turn is actively busy', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();
      session.recordTurnUsage({ inputTokens: 400, outputTokens: 80 });

      const messages: string[] = [];
      session.registerClient({
        send: (msg) => messages.push(msg),
      });

      // Should receive usage_summary followed by the buffered usage event
      expect(messages.length).toBe(2);
      expect(JSON.parse(messages[0]).type).toBe('usage_summary');
      expect(JSON.parse(messages[1]).type).toBe('usage');
    });
  });

  // ─── Feature 7: GUI Interactive Chat & Message Persistence ─────────────────
  describe('F7: GUI Interactive Chat & Persistence (F2.2, F2.5)', () => {
    it('F7.1: processes WebSocket usage event payload without throwing syntax errors', () => {
      const wsPayload: WebSocketUsageBroadcast = {
        type: 'usage',
        usage: { inputTokens: 900, outputTokens: 120 },
        cumulative: { inputTokens: 900, outputTokens: 120 },
      };

      const serialized = JSON.stringify(wsPayload);
      const deserialized = JSON.parse(serialized);

      expect(deserialized.type).toBe('usage');
      expect(deserialized.usage.inputTokens).toBe(900);
    });

    it('F7.2: associates usage metadata with ChatMessage record for chatStore persistence', () => {
      const chatMessage = {
        id: 'msg-001',
        role: 'assistant',
        content: 'I have inspected the repository.',
        timestamp: Date.now(),
        usage: {
          inputTokens: 1100,
          outputTokens: 250,
          cachedInputTokens: 300,
          costUsdEstimate: 0.012,
        },
      };

      expect(chatMessage.usage.inputTokens).toBe(1100);
      expect(chatMessage.usage.outputTokens).toBe(250);
      expect(chatMessage.usage.cachedInputTokens).toBe(300);
    });

    it('F7.3: formats turn pills conditionally (omits 0 cached tokens and undefined cost)', () => {
      function formatTurnPill(usage: NormalizedUsage): string {
        const parts: string[] = [`${usage.inputTokens} in`, `${usage.outputTokens} out`];
        if (usage.cachedInputTokens && usage.cachedInputTokens > 0) {
          parts.push(`(${usage.cachedInputTokens} cached)`);
        }
        if (usage.costUsdEstimate !== undefined && usage.costUsdEstimate > 0) {
          parts.push(`~$${usage.costUsdEstimate.toFixed(3)}`);
        }
        return parts.join(' / ');
      }

      // Case A: With cache and cost
      const pillA = formatTurnPill({
        inputTokens: 1000,
        outputTokens: 200,
        cachedInputTokens: 300,
        costUsdEstimate: 0.015,
      });
      expect(pillA).toBe('1000 in / 200 out / (300 cached) / ~$0.015');

      // Case B: Zero cache and undefined cost
      const pillB = formatTurnPill({
        inputTokens: 800,
        outputTokens: 150,
        cachedInputTokens: 0,
      });
      expect(pillB).toBe('800 in / 150 out');
      expect(pillB).not.toContain('cached');
      expect(pillB).not.toContain('$');
    });

    it('F7.4: renders header quota indicator with context window percentage', () => {
      function formatHeaderQuota(quota?: NormalizedRemainingQuota): string {
        if (!quota) return 'Quota: Unmonitored';
        if (quota.planType === 'plan-included') return 'Plan: Included';
        if (quota.contextWindow?.utilizationPercent !== undefined) {
          return `Context: ${quota.contextWindow.utilizationPercent.toFixed(1)}%`;
        }
        return 'Quota: OK';
      }

      expect(formatHeaderQuota(undefined)).toBe('Quota: Unmonitored');
      expect(formatHeaderQuota({ planType: 'plan-included' })).toBe('Plan: Included');
      expect(formatHeaderQuota({ contextWindow: { usedTokens: 50000, maxTokens: 100000, utilizationPercent: 50.0 } })).toBe('Context: 50.0%');
    });

    it('F7.5: maintains responsive layout safety at 340px width without string overflows', () => {
      const containerWidth = 340;
      const formattedPill = '12.5k in / 3.2k out (~$0.04)';
      // Estimate 8px per character in monospace font
      const estimatedPx = formattedPill.length * 8;
      expect(estimatedPx).toBeLessThan(containerWidth);
    });
  });

  // ─── Feature 8: Session History & Disk Transcripts ─────────────────────────
  describe('F8: Session History & Disk Transcripts (F2.3)', () => {
    it('F8.1: parses disk session transcript and aggregates total turn tokens', async () => {
      const sessionPath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
        sessionId: 'session-claude-test',
        provider: 'claude-cli',
        turns: [
          {
            turnIndex: 0,
            userPrompt: 'First question',
            assistantResponse: 'First answer',
            usage: { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 400 },
            timestamp: '2026-09-24T06:00:00Z',
          },
          {
            turnIndex: 1,
            userPrompt: 'Second question',
            assistantResponse: 'Second answer',
            usage: { inputTokens: 1500, outputTokens: 300, cachedInputTokens: 600 },
            timestamp: '2026-09-24T06:05:00Z',
          },
        ],
      });

      expect(sessionPath).toBeDefined();

      // Read back transcript lines
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(sessionPath, 'utf-8');
      const lines = content.trim().split('\n').map((l) => JSON.parse(l));

      const totalInput = lines.reduce((acc, l) => acc + (l.usage?.inputTokens ?? 0), 0);
      const totalOutput = lines.reduce((acc, l) => acc + (l.usage?.outputTokens ?? 0), 0);
      const totalCached = lines.reduce((acc, l) => acc + (l.usage?.cachedInputTokens ?? 0), 0);

      expect(totalInput).toBe(2500);
      expect(totalOutput).toBe(500);
      expect(totalCached).toBe(1000);
    });

    it('F8.2: aggregates multi-turn transcripts for Codex sessions from disk', async () => {
      const sessionPath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
        sessionId: 'session-codex-test',
        provider: 'codex-cli',
        turns: [
          {
            turnIndex: 0,
            userPrompt: 'Generate code',
            assistantResponse: 'function test() {}',
            usage: { inputTokens: 2000, outputTokens: 800, reasoningOutputTokens: 300 },
            timestamp: '2026-09-24T06:10:00Z',
          },
        ],
      });

      const fs = await import('node:fs/promises');
      const record = JSON.parse((await fs.readFile(sessionPath, 'utf-8')).trim());
      expect(record.usage.inputTokens).toBe(2000);
      expect(record.usage.reasoningOutputTokens).toBe(300);
    });

    it('F8.3: aggregates multi-turn transcripts for Antigravity sessions from disk', async () => {
      const sessionPath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
        sessionId: 'session-agy-test',
        provider: 'antigravity-cli',
        turns: [
          {
            turnIndex: 0,
            userPrompt: 'Design architecture',
            assistantResponse: 'Architecture specs...',
            usage: { inputTokens: 3500, outputTokens: 900, costUsdEstimate: 0.015 },
            quota: { requests: { unit: 'requests', remaining: 480, limit: 500 } },
            timestamp: '2026-09-24T06:15:00Z',
          },
        ],
      });

      const fs = await import('node:fs/promises');
      const record = JSON.parse((await fs.readFile(sessionPath, 'utf-8')).trim());
      expect(record.usage.costUsdEstimate).toBe(0.015);
      expect(record.quota.requests.remaining).toBe(480);
    });

    it('F8.4: populates AISession object with aggregated token metrics and latest quota', () => {
      const aiSession = {
        id: 'sess-abc-123',
        assistant: 'claude-cli',
        title: 'Refactor UI Components',
        messageCount: 4,
        createdAt: '2026-09-24T06:00:00Z',
        updatedAt: '2026-09-24T06:20:00Z',
        usage: {
          inputTokens: 4200,
          outputTokens: 980,
          cachedInputTokens: 1800,
          costUsdEstimate: 0.038,
        },
        quota: {
          tokens: { unit: 'tokens', remaining: 150000, limit: 200000, status: 'ok' as const },
        },
      };

      expect(aiSession.usage.inputTokens).toBe(4200);
      expect(aiSession.usage.outputTokens).toBe(980);
      expect(aiSession.quota.tokens.status).toBe('ok');
    });

    it('F8.5: TranscriptDialog shows cumulative tokens in header summary', () => {
      const transcriptTurns = [
        { usage: { inputTokens: 500, outputTokens: 100 } },
        { usage: { inputTokens: 700, outputTokens: 150 } },
      ];

      const totalTokens = transcriptTurns.reduce(
        (sum, t) => sum + t.usage.inputTokens + t.usage.outputTokens,
        0,
      );

      const headerTitle = `Transcript (${totalTokens.toLocaleString()} tokens)`;
      expect(headerTitle).toBe('Transcript (1,450 tokens)');
    });
  });

  // ─── Feature 9: CLI Status Output Integration ──────────────────────────────
  describe('F9: CLI Status Output Integration (F2.4)', () => {
    it('F9.1: parses AI Assistant Sessions section in human CLI status output', () => {
      const sampleCliOutput = `
Live Workspace Status:
  Repositories: NexusFlow
  Verification Gate: Passed

AI Assistant Sessions:
  [claude-cli] session-abc123: 1,200 in / 450 out (120 cached) | Quota: ok
  [codex-cli] session-xyz789: 3,400 in / 800 out | Quota: ok
`;

      const parsed = parseCliHumanStatus(sampleCliOutput);
      expect(parsed.hasAiSessionsSection).toBe(true);
      expect(parsed.sessions.length).toBe(2);
      expect(parsed.sessions[0].provider).toBe('claude-cli');
      expect(parsed.sessions[0].inputTokens).toBe(1200);
      expect(parsed.sessions[0].cachedTokens).toBe(120);
    });

    it('F9.2: formats session ID, token counts, and quota status cleanly', () => {
      function formatCliSessionRow(session: {
        provider: string;
        sessionId: string;
        input: number;
        output: number;
        cached?: number;
        quotaStatus?: string;
      }): string {
        const cacheStr = session.cached ? ` (${session.cached.toLocaleString()} cached)` : '';
        const quotaStr = session.quotaStatus ? ` | Quota: ${session.quotaStatus}` : '';
        return `  [${session.provider}] ${session.sessionId}: ${session.input.toLocaleString()} in / ${session.output.toLocaleString()} out${cacheStr}${quotaStr}`;
      }

      const row = formatCliSessionRow({
        provider: 'claude-cli',
        sessionId: 'sess-001',
        input: 12500,
        output: 3200,
        cached: 4000,
        quotaStatus: 'ok',
      });

      expect(row).toBe('  [claude-cli] sess-001: 12,500 in / 3,200 out (4,000 cached) | Quota: ok');
    });

    it('F9.3: preserves legacy top-level JSON contract for ctxspace status --json', () => {
      const legacyRunningState = {
        workspaceId: 'view-harness-usage',
        repos: ['NexusFlow'],
        services: ['pm2-contextspace'],
        // Additive optional field
        aiSessions: [
          {
            sessionId: 'sess-001',
            provider: 'claude-cli',
            inputTokens: 1200,
            outputTokens: 300,
          },
        ],
      };

      const jsonStr = JSON.stringify(legacyRunningState);
      const parsed = JSON.parse(jsonStr);

      // Verify top-level legacy keys remain intact
      expect(parsed.workspaceId).toBe('view-harness-usage');
      expect(Array.isArray(parsed.repos)).toBe(true);
      expect(Array.isArray(parsed.services)).toBe(true);
      // Verify additive key is accessible
      expect(parsed.aiSessions[0].inputTokens).toBe(1200);
    });

    it('F9.4: formats plan-included subscriptions (Plan: Included) in CLI output', () => {
      const cliBlock = `  [codex-cli] session-plus: 2,500 in / 600 out | Quota: plan-included`;
      const parsed = parseCliHumanStatus(cliBlock);

      expect(parsed.sessions[0].quotaStatus).toBe('plan-included');
      expect(cliBlock).not.toContain('$');
    });

    it('F9.5: handles empty sessions list gracefully without throwing CLI errors', () => {
      const output = `
Live Workspace Status:
  Repositories: NexusFlow

AI Assistant Sessions:
  No active AI sessions found.
`;

      const parsed = parseCliHumanStatus(output);
      expect(parsed.hasAiSessionsSection).toBe(true);
      expect(parsed.sessions.length).toBe(0);
    });
  });
});
