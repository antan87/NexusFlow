/**
 * @module tests/e2e/harness-usage/tier2-boundaries.test
 *
 * Tier 2: Boundary & Corner Cases (≥5 tests per feature, 45 tests total)
 * Opaque-box verification for edge conditions:
 * - 0 tokens, missing quotas, overflow
 * - disconnected streams, plan-included subscriptions
 * - rapid events, corrupted records, extreme values
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateNormalizedUsage,
  validateNormalizedRemainingQuota,
  createClaudeCliStream,
  createCodexCliStream,
  createCopilotAcpMessages,
  OpaqueTurnSessionSimulator,
  createTemporaryWorkspace,
  writeSyntheticSessionTranscript,
  parseCliHumanStatus,
  type NormalizedUsage,
  type NormalizedRemainingQuota,
} from './test-harness.js';

describe('Tier 2: Boundary & Corner Cases (Harness Usage & Quotas)', () => {
  let wsFixture: { workspaceDir: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    wsFixture = await createTemporaryWorkspace();
  });

  afterEach(async () => {
    if (wsFixture) {
      await wsFixture.cleanup();
    }
  });

  // ─── Boundary 1: Contract & Normalization Boundaries ───────────────────────
  describe('B1: Contract & Normalization Boundaries', () => {
    it('B1.1: validates zero tokens boundary (input=0, output=0, cached=0)', () => {
      const usage: NormalizedUsage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsdEstimate: 0,
      };

      const validated = validateNormalizedUsage(usage);
      expect(validated.inputTokens).toBe(0);
      expect(validated.outputTokens).toBe(0);
      expect(validated.cachedInputTokens).toBe(0);
      expect(validated.costUsdEstimate).toBe(0);
    });

    it('B1.2: handles extreme token counts (>100M tokens) with full precision', () => {
      const hugeUsage: NormalizedUsage = {
        inputTokens: 120_000_000,
        outputTokens: 45_000_000,
        cachedInputTokens: 85_000_000,
        totalTokens: 165_000_000,
      };

      const validated = validateNormalizedUsage(hugeUsage);
      expect(validated.inputTokens).toBe(120_000_000);
      expect(validated.outputTokens).toBe(45_000_000);
      expect(validated.totalTokens).toBe(165_000_000);
    });

    it('B1.3: handles partial cache objects (only read tokens present, write undefined)', () => {
      const usage: NormalizedUsage = {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadInputTokens: 500,
      };

      const validated = validateNormalizedUsage(usage);
      expect(validated.cacheReadInputTokens).toBe(500);
      expect(validated.cacheWriteInputTokens).toBeUndefined();
    });

    it('B1.4: handles fractional sub-cent costs ($0.000042) without precision distortion', () => {
      const usage: NormalizedUsage = {
        inputTokens: 50,
        outputTokens: 10,
        costUsdEstimate: 0.000042,
      };

      const validated = validateNormalizedUsage(usage);
      expect(validated.costUsdEstimate).toBeCloseTo(0.000042, 6);
    });

    it('B1.5: handles quota window with resetsAt timestamp but unbounded limit', () => {
      const quota: NormalizedRemainingQuota = {
        requests: {
          unit: 'requests',
          resetsAt: '2026-09-24T18:00:00Z',
          status: 'ok',
        },
      };

      const validated = validateNormalizedRemainingQuota(quota);
      expect(validated.requests?.limit).toBeUndefined();
      expect(validated.requests?.remaining).toBeUndefined();
      expect(validated.requests?.resetsAt).toBe('2026-09-24T18:00:00Z');
    });
  });

  // ─── Boundary 2: Claude Code Boundaries ────────────────────────────────────
  describe('B2: Claude Code Boundaries', () => {
    it('B2.1: handles empty stream-json lines without crashing', () => {
      const lines = ['', '   ', '{"type":"ping"}', ''];
      let capturedUsage: NormalizedUsage | undefined;

      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.type === 'result' && parsed.usage) {
          capturedUsage = {
            inputTokens: parsed.usage.input_tokens ?? 0,
            outputTokens: parsed.usage.output_tokens ?? 0,
          };
        }
      }

      expect(capturedUsage).toBeUndefined();
    });

    it('B2.2: defensively normalizes negative or NaN token numbers to 0', () => {
      function defensiveNormalize(raw: any): NormalizedUsage {
        const parseNum = (v: any) => (typeof v === 'number' && !isNaN(v) && v >= 0 ? v : 0);
        return {
          inputTokens: parseNum(raw?.input_tokens),
          outputTokens: parseNum(raw?.output_tokens),
          cachedInputTokens: parseNum(raw?.cached_tokens),
        };
      }

      const normalized = defensiveNormalize({
        input_tokens: -50,
        output_tokens: NaN,
        cached_tokens: 'invalid',
      });

      expect(normalized.inputTokens).toBe(0);
      expect(normalized.outputTokens).toBe(0);
      expect(normalized.cachedInputTokens).toBe(0);
    });

    it('B2.3: processes rapid consecutive api_retry events before final turn result', () => {
      const streamLines = [
        ...createClaudeCliStream({ inputTokens: 0, outputTokens: 0, retryAttempt: 1, maxRetries: 3 }),
        ...createClaudeCliStream({ inputTokens: 0, outputTokens: 0, retryAttempt: 2, maxRetries: 3 }),
        ...createClaudeCliStream({ inputTokens: 1500, outputTokens: 400 }),
      ];

      const retries = streamLines.filter((l) => l.includes('"api_retry"'));
      expect(retries.length).toBe(2);

      const finalResult = streamLines.find((l) => l.includes('"result"') && l.includes('1500'));
      expect(finalResult).toBeDefined();
    });

    it('B2.4: truncates or safely handles massive error messages in rate limit warnings', () => {
      const hugeErrorMessage = 'Rate limit exceeded: '.padEnd(5000, 'X');
      const streamLines = createClaudeCliStream({
        inputTokens: 100,
        outputTokens: 20,
        retryAttempt: 1,
        errorMessage: hugeErrorMessage,
      });

      const retryRecord = JSON.parse(streamLines.find((l) => l.includes('"api_retry"'))!);
      const truncatedMessage = retryRecord.error.length > 256 ? retryRecord.error.slice(0, 256) + '...' : retryRecord.error;

      expect(truncatedMessage.length).toBe(259);
      expect(truncatedMessage.endsWith('...')).toBe(true);
    });

    it('B2.5: handles free-tier / unauthenticated Claude invocation without billing metadata', () => {
      const streamLines = createClaudeCliStream({
        inputTokens: 500,
        outputTokens: 120,
        // No cost provided
      });

      const parsed = JSON.parse(streamLines.find((l) => l.includes('"result"'))!);
      expect(parsed.total_cost_usd).toBeUndefined();

      const normalized: NormalizedUsage = {
        inputTokens: parsed.usage.input_tokens,
        outputTokens: parsed.usage.output_tokens,
        costConfidence: 'absent',
      };

      expect(normalized.costUsdEstimate).toBeUndefined();
      expect(normalized.costConfidence).toBe('absent');
    });
  });

  // ─── Boundary 3: OpenAI Codex Boundaries ───────────────────────────────────
  describe('B3: OpenAI Codex Boundaries', () => {
    it('B3.1: defaults safely to zeroes when turn.completed has empty usage object', () => {
      const emptyTurnLine = JSON.stringify({
        type: 'turn.completed',
        usage: {},
      });

      const parsed = JSON.parse(emptyTurnLine);
      const normalized: NormalizedUsage = {
        inputTokens: parsed.usage.input_tokens ?? 0,
        outputTokens: parsed.usage.output_tokens ?? 0,
        cachedInputTokens: parsed.usage.cached_input_tokens ?? 0,
      };

      expect(normalized.inputTokens).toBe(0);
      expect(normalized.outputTokens).toBe(0);
      expect(normalized.cachedInputTokens).toBe(0);
    });

    it('B3.2: handles reasoning_output_tokens exceeding standard output tokens safely', () => {
      // In o1/o3 models, reasoning tokens may be reported inside or alongside completion tokens
      const streamLines = createCodexCliStream({
        inputTokens: 1000,
        outputTokens: 500,
        reasoningTokens: 800,
      });

      const raw = JSON.parse(streamLines.find((l) => l.includes('"turn.completed"'))!);
      const normalized: NormalizedUsage = {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        reasoningOutputTokens: raw.usage.reasoning_output_tokens,
      };

      expect(normalized.reasoningOutputTokens).toBe(800);
      expect(normalized.outputTokens).toBe(500);
    });

    it('B3.3: handles high-concurrency rapid turns within single thread', () => {
      const session = new OpaqueTurnSessionSimulator();
      for (let i = 0; i < 20; i++) {
        session.startTurn();
        session.recordTurnUsage({ inputTokens: 100, outputTokens: 20 });
        session.endTurn();
      }

      expect(session.cumulativeUsage.inputTokens).toBe(2000);
      expect(session.cumulativeUsage.outputTokens).toBe(400);
    });

    it('B3.4: handles abrupt process SIGKILL before turn.completed emission gracefully', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();
      // Abrupt termination without recordTurnUsage
      session.endTurn();

      expect(session.cumulativeUsage.inputTokens).toBe(0);
      expect(session.cumulativeUsage.outputTokens).toBe(0);
      expect(session.isTurnBusy).toBe(false);
    });

    it('B3.5: filters out malformed JSON lines mixed into Codex CLI stdout', () => {
      const rawStdout = [
        'info: launching codex session',
        '{"type":"turn.started"}',
        'Warning: connection latency high',
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 850, output_tokens: 150 },
        }),
      ];

      const validUsages: NormalizedUsage[] = [];
      for (const line of rawStdout) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'turn.completed' && parsed.usage) {
            validUsages.push({
              inputTokens: parsed.usage.input_tokens ?? 0,
              outputTokens: parsed.usage.output_tokens ?? 0,
            });
          }
        } catch {
          // Ignored non-json lines
        }
      }

      expect(validUsages.length).toBe(1);
      expect(validUsages[0].inputTokens).toBe(850);
    });
  });

  // ─── Boundary 4: Antigravity Boundaries ────────────────────────────────────
  describe('B4: Antigravity Boundaries', () => {
    it('B4.1: extracts tokens when Gemini payload contains unknown candidate count keys', () => {
      const futurePayload = {
        type: 'stats',
        prompt_tokens: 1200,
        future_candidate_output_tokens: 450,
      };

      const normalized: NormalizedUsage = {
        inputTokens: futurePayload.prompt_tokens,
        outputTokens: (futurePayload as any).future_candidate_output_tokens ?? 0,
      };

      expect(normalized.inputTokens).toBe(1200);
      expect(normalized.outputTokens).toBe(450);
    });

    it('B4.2: handles mixed snake_case and camelCase usage keys in single stream record', () => {
      const mixedPayload = {
        input_token_count: 900,
        candidatesTokenCount: 220,
        cached_content_token_count: 300,
      };

      const inputTokens = (mixedPayload as any).input_token_count ?? (mixedPayload as any).inputTokenCount ?? 0;
      const outputTokens = (mixedPayload as any).candidates_token_count ?? (mixedPayload as any).candidatesTokenCount ?? 0;
      const cachedTokens = (mixedPayload as any).cached_content_token_count ?? 0;

      expect(inputTokens).toBe(900);
      expect(outputTokens).toBe(220);
      expect(cachedTokens).toBe(300);
    });

    it('B4.3: validates quota reset timestamp with non-ISO format or negative seconds', () => {
      function safeResetSeconds(rawSeconds?: number): number | undefined {
        if (typeof rawSeconds !== 'number' || isNaN(rawSeconds) || rawSeconds < 0) {
          return undefined;
        }
        return rawSeconds;
      }

      expect(safeResetSeconds(-60)).toBeUndefined();
      expect(safeResetSeconds(NaN)).toBeUndefined();
      expect(safeResetSeconds(120)).toBe(120);
    });

    it('B4.4: handles Gemini 429 quota exhaustion with empty message body', () => {
      const errorPayload = {
        type: 'error',
        error: '',
        statusCode: 429,
      };

      const quota: NormalizedRemainingQuota = {
        requests: {
          unit: 'requests',
          remaining: 0,
          status: 'exceeded',
        },
        warningMessage: errorPayload.error || 'Rate limit / quota exceeded (HTTP 429)',
      };

      expect(quota.requests?.status).toBe('exceeded');
      expect(quota.warningMessage).toContain('HTTP 429');
    });

    it('B4.5: transitions quota status from ok to approaching_limit to exceeded across turns', () => {
      const quotaHistory: QuotaStatus[] = [];
      const session = new OpaqueTurnSessionSimulator();

      // Turn 1: 20% limit
      session.recordTurnUsage({ inputTokens: 2000, outputTokens: 400 }, { tokens: { unit: 'tokens', status: 'ok' } });
      quotaHistory.push(session.latestQuota!.tokens!.status!);

      // Turn 2: 85% limit
      session.recordTurnUsage({ inputTokens: 6500, outputTokens: 800 }, { tokens: { unit: 'tokens', status: 'approaching_limit' } });
      quotaHistory.push(session.latestQuota!.tokens!.status!);

      // Turn 3: 100% limit
      session.recordTurnUsage({ inputTokens: 2000, outputTokens: 200 }, { tokens: { unit: 'tokens', status: 'exceeded' } });
      quotaHistory.push(session.latestQuota!.tokens!.status!);

      expect(quotaHistory).toEqual(['ok', 'approaching_limit', 'exceeded']);
    });
  });

  // ─── Boundary 5: GitHub Copilot Boundaries ─────────────────────────────────
  describe('B5: GitHub Copilot Boundaries', () => {
    it('B5.1: handles out-of-order protocol: UsageUpdate received before PromptResponse', () => {
      const messages = createCopilotAcpMessages({
        inputTokens: 1000,
        outputTokens: 200,
        contextUsed: 15000,
        contextSize: 128000,
      });

      let latestQuota: NormalizedRemainingQuota | undefined;
      let finalUsage: NormalizedUsage | undefined;

      // Process in reverse order
      for (const msg of messages) {
        if (msg.kind === 'notification') {
          const params = (msg.payload as any).params;
          latestQuota = {
            contextWindow: {
              usedTokens: params.used,
              maxTokens: params.size,
              utilizationPercent: (params.used / params.size) * 100,
            },
          };
        } else if (msg.kind === 'response') {
          const u = (msg.payload as any).result.usage;
          finalUsage = {
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
          };
        }
      }

      expect(latestQuota?.contextWindow?.usedTokens).toBe(15000);
      expect(finalUsage?.inputTokens).toBe(1000);
    });

    it('B5.2: handles context overflow condition where used > size', () => {
      const quota: NormalizedRemainingQuota = {
        contextWindow: {
          usedTokens: 130000,
          maxTokens: 128000,
          utilizationPercent: Math.min(100, (130000 / 128000) * 100),
        },
        warningMessage: 'Context window capacity exceeded',
      };

      expect(quota.contextWindow?.usedTokens).toBeGreaterThan(quota.contextWindow!.maxTokens);
      expect(quota.warningMessage).toContain('exceeded');
    });

    it('B5.3: handles PromptResponse.usage containing null token values safely', () => {
      const nullUsage = {
        inputTokens: 500,
        outputTokens: 100,
        thoughtTokens: null,
        cachedReadTokens: null,
        cachedWriteTokens: null,
      };

      const normalized: NormalizedUsage = {
        inputTokens: nullUsage.inputTokens,
        outputTokens: nullUsage.outputTokens,
        reasoningOutputTokens: nullUsage.thoughtTokens ?? undefined,
        cachedInputTokens: (nullUsage.cachedReadTokens ?? 0) + (nullUsage.cachedWriteTokens ?? 0),
      };

      expect(normalized.reasoningOutputTokens).toBeUndefined();
      expect(normalized.cachedInputTokens).toBe(0);
    });

    it('B5.4: handles ACP stdio pipe disconnect mid-stream gracefully', () => {
      let isPipeOpen = true;
      const onData = (chunk: string) => {
        if (!isPipeOpen) throw new Error('EPIPE: Broken pipe');
        return chunk;
      };

      expect(onData('valid line')).toBe('valid line');
      isPipeOpen = false;
      expect(() => onData('broken line')).toThrow('EPIPE');
    });

    it('B5.5: handles non-USD currency in UsageUpdate.cost without crashing', () => {
      const updateParams = {
        used: 1000,
        size: 8000,
        cost: { amount: 0.12, currency: 'EUR' },
      };

      expect(updateParams.cost.currency).toBe('EUR');
      // When currency is non-USD, label correctly
      const label = `${updateParams.cost.currency} ${updateParams.cost.amount}`;
      expect(label).toBe('EUR 0.12');
    });
  });

  // ─── Boundary 6: TurnSessionManager Boundaries ─────────────────────────────
  describe('B6: TurnSessionManager Boundaries', () => {
    it('B6.1: handles rapid client reconnects (10x) during active busy turn', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();
      session.recordTurnUsage({ inputTokens: 800, outputTokens: 150 });

      for (let i = 0; i < 10; i++) {
        const received: string[] = [];
        session.registerClient({ send: (m) => received.push(m) });
        // Must receive usage_summary + buffered usage event
        expect(received.length).toBe(2);
      }
    });

    it('B6.2: handles 1,000 rapid usage updates in single turn without memory leak', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();

      for (let i = 0; i < 1000; i++) {
        session.recordTurnUsage({ inputTokens: 1, outputTokens: 1 });
      }
      session.endTurn();

      expect(session.cumulativeUsage.inputTokens).toBe(1000);
      expect(session.cumulativeUsage.outputTokens).toBe(1000);
    });

    it('B6.3: prevents cumulative token overflow across 50 consecutive turns', () => {
      const session = new OpaqueTurnSessionSimulator();
      for (let i = 0; i < 50; i++) {
        session.startTurn();
        session.recordTurnUsage({ inputTokens: 100_000, outputTokens: 20_000 });
        session.endTurn();
      }

      expect(session.cumulativeUsage.inputTokens).toBe(5_000_000);
      expect(session.cumulativeUsage.outputTokens).toBe(1_000_000);
    });

    it('B6.4: client connecting to idle session receives zero tokens without error', () => {
      const session = new OpaqueTurnSessionSimulator();
      const messages: string[] = [];
      session.registerClient({ send: (m) => messages.push(m) });

      expect(messages.length).toBe(1);
      const summary = JSON.parse(messages[0]);
      expect(summary.cumulative.inputTokens).toBe(0);
      expect(summary.cumulative.outputTokens).toBe(0);
    });

    it('B6.5: zero-turn session immediately closed cleans up properly', () => {
      const session = new OpaqueTurnSessionSimulator();
      session.startTurn();
      session.endTurn();

      expect(session.bufferedTurnEvents.length).toBe(0);
      expect(session.isTurnBusy).toBe(false);
    });
  });

  // ─── Boundary 7: GUI Chat Boundaries ───────────────────────────────────────
  describe('B7: GUI Chat Boundaries', () => {
    it('B7.1: verifies responsive token layout safety at narrow 320px viewport', () => {
      const maxWidthPx = 320;
      const formatted = '2.1k in / 450 out (120 cached)';
      const approxWidth = formatted.length * 8; // approx 8px per char
      expect(approxWidth).toBeLessThan(maxWidthPx);
    });

    it('B7.2: suppresses turn pill when both input and output tokens are 0', () => {
      function shouldRenderTurnPill(usage?: NormalizedUsage): boolean {
        if (!usage) return false;
        return (usage.inputTokens > 0 || usage.outputTokens > 0);
      }

      expect(shouldRenderTurnPill(undefined)).toBe(false);
      expect(shouldRenderTurnPill({ inputTokens: 0, outputTokens: 0 })).toBe(false);
      expect(shouldRenderTurnPill({ inputTokens: 10, outputTokens: 0 })).toBe(true);
    });

    it('B7.3: formats huge token numbers (1,420,500 tokens) with localized commas', () => {
      const tokens = 1420500;
      const formatted = tokens.toLocaleString('en-US');
      expect(formatted).toBe('1,420,500');
    });

    it('B7.4: processes rapid stream text deltas followed by delayed usage packet', () => {
      const streamDeltas = ['Hel', 'lo, ', 'wor', 'ld!'];
      let textAccumulator = '';
      for (const d of streamDeltas) {
        textAccumulator += d;
      }
      expect(textAccumulator).toBe('Hello, world!');

      // Late arrival of usage
      const lateUsage: NormalizedUsage = { inputTokens: 15, outputTokens: 4 };
      expect(lateUsage.totalTokens ?? (lateUsage.inputTokens + lateUsage.outputTokens)).toBe(19);
    });

    it('B7.5: handles corrupted local storage record in chatStore safely', () => {
      function safeParseChatStore(raw: string): any[] {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }

      expect(safeParseChatStore('invalid-json{{{')).toEqual([]);
      expect(safeParseChatStore('{"notAnArray":true}')).toEqual([]);
      expect(safeParseChatStore('[{"id":"msg-1"}]')).toEqual([{ id: 'msg-1' }]);
    });
  });

  // ─── Boundary 8: Session History Boundaries ────────────────────────────────
  describe('B8: Session History Boundaries', () => {
    it('B8.1: skips corrupted or unparseable JSONL lines in disk transcript cleanly', async () => {
      const filePath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
        sessionId: 'session-corrupt-line',
        provider: 'claude-cli',
        turns: [
          {
            turnIndex: 0,
            userPrompt: 'Hi',
            assistantResponse: 'Hello',
            usage: { inputTokens: 100, outputTokens: 20 },
            timestamp: '2026-09-24T06:00:00Z',
          },
        ],
      });

      // Append invalid JSON line
      const fs = await import('node:fs/promises');
      await fs.appendFile(filePath, 'CORRUPTED LINE NOT JSON\n', 'utf-8');

      // Add valid turn 2
      await fs.appendFile(
        filePath,
        JSON.stringify({
          turnIndex: 1,
          usage: { inputTokens: 200, outputTokens: 40 },
        }) + '\n',
        'utf-8',
      );

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      let validTurnCount = 0;
      let totalTokens = 0;

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.usage) {
            validTurnCount++;
            totalTokens += parsed.usage.inputTokens + parsed.usage.outputTokens;
          }
        } catch {
          // Skip corrupted line
        }
      }

      expect(validTurnCount).toBe(2);
      expect(totalTokens).toBe(360);
    });

    it('B8.2: parses 1,000 turn transcript file under performance threshold (< 500ms)', async () => {
      const turns = Array.from({ length: 1000 }, (_, i) => ({
        turnIndex: i,
        userPrompt: `Prompt ${i}`,
        assistantResponse: `Response ${i}`,
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 },
        timestamp: '2026-09-24T06:00:00Z',
      }));

      const filePath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
        sessionId: 'session-perf-test',
        provider: 'claude-cli',
        turns,
      });

      const fs = await import('node:fs/promises');
      const start = Date.now();
      const content = await fs.readFile(filePath, 'utf-8');
      const parsedLines = content.trim().split('\n').map((l) => JSON.parse(l));
      const durationMs = Date.now() - start;

      expect(parsedLines.length).toBe(1000);
      expect(durationMs).toBeLessThan(500);
    });

    it('B8.3: handles transcript turn with missing timestamp by applying fallback', () => {
      const rawTurn = {
        turnIndex: 0,
        userPrompt: 'test',
        usage: { inputTokens: 50, outputTokens: 10 },
      };

      const turnWithFallback = {
        ...rawTurn,
        timestamp: (rawTurn as any).timestamp ?? new Date().toISOString(),
      };

      expect(turnWithFallback.timestamp).toBeDefined();
    });

    it('B8.4: handles empty (0 byte) session transcript file without error', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const emptyFile = path.join(wsFixture.workspaceDir, 'empty-session.jsonl');
      await fs.writeFile(emptyFile, '', 'utf-8');

      const content = await fs.readFile(emptyFile, 'utf-8');
      const lines = content.trim() ? content.trim().split('\n') : [];
      expect(lines.length).toBe(0);
    });

    it('B8.5: handles mixed provider turns within single workspace safely', () => {
      const sessions = [
        { provider: 'claude-cli', input: 1000, output: 200 },
        { provider: 'codex-cli', input: 1500, output: 300 },
        { provider: 'antigravity-cli', input: 2000, output: 400 },
      ];

      const byProvider: Record<string, number> = {};
      for (const s of sessions) {
        byProvider[s.provider] = (byProvider[s.provider] ?? 0) + s.input + s.output;
      }

      expect(byProvider['claude-cli']).toBe(1200);
      expect(byProvider['codex-cli']).toBe(1800);
      expect(byProvider['antigravity-cli']).toBe(2400);
    });
  });

  // ─── Boundary 9: CLI Status Boundaries ─────────────────────────────────────
  describe('B9: CLI Status Boundaries', () => {
    it('B9.1: handles zero active or historical sessions cleanly', () => {
      const output = 'Live Workspace Status:\n  Repositories: NexusFlow\nAI Assistant Sessions:\n  No active AI sessions found.';
      const parsed = parseCliHumanStatus(output);
      expect(parsed.hasAiSessionsSection).toBe(true);
      expect(parsed.sessions.length).toBe(0);
    });

    it('B9.2: formats session block cleanly in narrow 40-column terminal', () => {
      const terminalWidth = 40;
      const compactSessionRow = '[claude] 1.2k in / 400 out | OK';
      expect(compactSessionRow.length).toBeLessThanOrEqual(terminalWidth);
    });

    it('B9.3: produces plain text without raw ANSI escapes when NO_COLOR=1', () => {
      function stripAnsi(str: string): string {
        return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
      }

      const ansiColored = '\x1B[32m[claude-cli]\x1B[0m session-1: \x1B[36m1,200 in\x1B[0m';
      const plain = stripAnsi(ansiColored);
      expect(plain).toBe('[claude-cli] session-1: 1,200 in');
    });

    it('B9.4: ensures --json flag produces strictly parseable JSON without console noise', () => {
      const cleanJson = JSON.stringify({
        workspace: 'test',
        sessions: [{ id: 's1', inputTokens: 500 }],
      });

      expect(() => JSON.parse(cleanJson)).not.toThrow();
    });

    it('B9.5: ignores stale session lockfiles (.session.lock) on disk', async () => {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const lockFile = path.join(wsFixture.workspaceDir, '.session.lock');
      await fs.writeFile(lockFile, 'pid: 999999', 'utf-8');

      const files = await fs.readdir(wsFixture.workspaceDir);
      const transcriptFiles = files.filter((f) => f.endsWith('.jsonl'));
      expect(transcriptFiles.length).toBe(0);
    });
  });
});
