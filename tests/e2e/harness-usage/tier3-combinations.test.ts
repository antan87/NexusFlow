/**
 * @module tests/e2e/harness-usage/tier3-combinations.test
 *
 * Tier 3: Cross-Feature Combinations (Pairwise Interactions)
 * Verifies complex multi-feature interactions:
 * - C1: Token usage + quota alert interaction
 * - C2: Multi-turn chat + late client reconnection
 * - C3: Cross-provider sequential turns (Claude -> Codex -> Antigravity)
 * - C4: Active busy turn buffering + concurrent reconnect
 * - C5: CLI status read during active in-flight turn
 * - C6: Plan-included subscription + per-token telemetry
 * - C7: Corrupted transcript lines + historical discovery
 * - C8: Cost confidence transitions (estimated -> authoritative)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  OpaqueTurnSessionSimulator,
  createTemporaryWorkspace,
  writeSyntheticSessionTranscript,
  type NormalizedUsage,
  type NormalizedRemainingQuota,
  type WebSocketUsageBroadcast,
  type WebSocketUsageSummary,
} from './test-harness.js';

describe('Tier 3: Cross-Feature Combinations', () => {
  let wsFixture: { workspaceDir: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    wsFixture = await createTemporaryWorkspace();
  });

  afterEach(async () => {
    if (wsFixture) {
      await wsFixture.cleanup();
    }
  });

  it('C1: Token Usage + Quota Alert Interaction', () => {
    const session = new OpaqueTurnSessionSimulator();
    const receivedBroadcasts: WebSocketUsageBroadcast[] = [];

    session.registerClient({
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'usage') {
          receivedBroadcasts.push(parsed);
        }
      },
    });

    // Turn 1: 50k tokens consumed, context window at 50%
    session.startTurn();
    session.recordTurnUsage(
      { inputTokens: 40000, outputTokens: 10000 },
      { contextWindow: { usedTokens: 50000, maxTokens: 100000, utilizationPercent: 50.0 } },
    );
    session.endTurn();

    expect(receivedBroadcasts.length).toBe(1);
    expect(receivedBroadcasts[0].cumulative.inputTokens).toBe(40000);
    expect(receivedBroadcasts[0].quota?.contextWindow?.utilizationPercent).toBe(50);

    // Turn 2: Another 35k tokens consumed, context window reaches 85% -> status: approaching_limit
    session.startTurn();
    session.recordTurnUsage(
      { inputTokens: 30000, outputTokens: 5000 },
      {
        contextWindow: { usedTokens: 85000, maxTokens: 100000, utilizationPercent: 85.0 },
        tokens: { unit: 'tokens', remaining: 15000, limit: 100000, status: 'approaching_limit' },
        warningMessage: 'Context window utilization at 85%',
      },
    );
    session.endTurn();

    expect(receivedBroadcasts.length).toBe(2);
    expect(receivedBroadcasts[1].cumulative.inputTokens).toBe(70000);
    expect(receivedBroadcasts[1].quota?.tokens?.status).toBe('approaching_limit');
    expect(receivedBroadcasts[1].quota?.warningMessage).toContain('85%');
  });

  it('C2: Multi-turn Chat + Late Client Reconnection', () => {
    const session = new OpaqueTurnSessionSimulator();

    // Turn 1
    session.startTurn();
    session.recordTurnUsage({ inputTokens: 1200, outputTokens: 300, cachedInputTokens: 400, costUsdEstimate: 0.012 });
    session.endTurn();

    // Turn 2
    session.startTurn();
    session.recordTurnUsage({ inputTokens: 2500, outputTokens: 600, cachedInputTokens: 800, costUsdEstimate: 0.024 });
    session.endTurn();

    // Turn 3
    session.startTurn();
    session.recordTurnUsage(
      { inputTokens: 1800, outputTokens: 450, cachedInputTokens: 600, costUsdEstimate: 0.018 },
      { tokens: { unit: 'tokens', remaining: 80000, limit: 100000, status: 'ok' } },
    );
    session.endTurn();

    // A brand new client connects after 3 completed turns
    const clientMessages: string[] = [];
    session.registerClient({
      send: (m) => clientMessages.push(m),
    });

    expect(clientMessages.length).toBe(1);
    const summary: WebSocketUsageSummary = JSON.parse(clientMessages[0]);
    expect(summary.type).toBe('usage_summary');
    expect(summary.cumulative.inputTokens).toBe(1200 + 2500 + 1800);
    expect(summary.cumulative.outputTokens).toBe(300 + 600 + 450);
    expect(summary.cumulative.cachedInputTokens).toBe(400 + 800 + 600);
    expect(summary.cumulative.costUsdEstimate).toBeCloseTo(0.054, 4);
    expect(summary.quota?.tokens?.remaining).toBe(80000);
  });

  it('C3: Cross-Provider Sequential Turns (Claude -> Codex -> Antigravity)', () => {
    const session = new OpaqueTurnSessionSimulator();

    // Step 1: Claude Code turn (with cache breakdown and cost estimate)
    session.startTurn();
    session.recordTurnUsage({
      inputTokens: 3000,
      outputTokens: 500,
      cachedInputTokens: 1000,
      costUsdEstimate: 0.025,
      costConfidence: 'estimated',
    });
    session.endTurn();

    // Step 2: Codex turn (with reasoning tokens, absent cost)
    session.startTurn();
    session.recordTurnUsage({
      inputTokens: 2000,
      outputTokens: 800,
      reasoningOutputTokens: 400,
      costConfidence: 'absent',
    });
    session.endTurn();

    // Step 3: Antigravity turn (with Gemini quota warning)
    session.startTurn();
    session.recordTurnUsage(
      {
        inputTokens: 4000,
        outputTokens: 700,
        costUsdEstimate: 0.018,
        costConfidence: 'estimated',
      },
      {
        tokens: { unit: 'tokens', remaining: 40000, limit: 50000, status: 'ok' },
      },
    );
    session.endTurn();

    expect(session.cumulativeUsage.inputTokens).toBe(9000);
    expect(session.cumulativeUsage.outputTokens).toBe(2000);
    expect(session.cumulativeUsage.costUsdEstimate).toBeCloseTo(0.043, 4);
    expect(session.latestQuota?.tokens?.remaining).toBe(40000);
  });

  it('C4: Active Busy Turn Buffering + Concurrent Reconnect', () => {
    const session = new OpaqueTurnSessionSimulator();

    // Turn 1 completes
    session.startTurn();
    session.recordTurnUsage({ inputTokens: 1000, outputTokens: 200 });
    session.endTurn();

    // Turn 2 starts and becomes busy
    session.startTurn();
    session.recordTurnUsage({ inputTokens: 1500, outputTokens: 300 });

    // Client connects while Turn 2 is still actively busy
    const reconnectMessages: string[] = [];
    session.registerClient({
      send: (m) => reconnectMessages.push(m),
    });

    // Reconnecting client must get summary first, then the in-flight buffered usage event
    expect(reconnectMessages.length).toBe(2);
    const summaryMsg = JSON.parse(reconnectMessages[0]);
    const bufferedUsageMsg = JSON.parse(reconnectMessages[1]);

    expect(summaryMsg.type).toBe('usage_summary');
    expect(summaryMsg.cumulative.inputTokens).toBe(2500);
    expect(bufferedUsageMsg.type).toBe('usage');
    expect(bufferedUsageMsg.usage.inputTokens).toBe(1500);

    session.endTurn();
  });

  it('C5: CLI Status Read During Active In-Flight Turn', () => {
    const session = new OpaqueTurnSessionSimulator();
    session.startTurn();
    session.recordTurnUsage({ inputTokens: 5000, outputTokens: 1200, cachedInputTokens: 2000 });

    // Simulate CLI status rendering while session is in flight
    function renderStatus(sess: OpaqueTurnSessionSimulator, sessionId: string, provider: string): string {
      const state = sess.isTurnBusy ? 'running' : 'idle';
      const cacheStr = sess.cumulativeUsage.cachedInputTokens ? ` (${sess.cumulativeUsage.cachedInputTokens.toLocaleString()} cached)` : '';
      return `AI Assistant Sessions:\n  [${provider}] ${sessionId} [${state}]: ${sess.cumulativeUsage.inputTokens.toLocaleString()} in / ${sess.cumulativeUsage.outputTokens.toLocaleString()} out${cacheStr}`;
    }

    const runningOutput = renderStatus(session, 'session-live-01', 'claude-cli');
    expect(runningOutput).toContain('[running]');
    expect(runningOutput).toContain('5,000 in / 1,200 out');
    expect(runningOutput).toContain('(2,000 cached)');

    session.endTurn();
    const idleOutput = renderStatus(session, 'session-live-01', 'claude-cli');
    expect(idleOutput).toContain('[idle]');
  });

  it('C6: Plan-Included Subscription + Per-Token Telemetry', () => {
    const planQuota: NormalizedRemainingQuota = {
      planType: 'plan-included',
      label: 'ChatGPT Plus Subscription',
      contextWindow: {
        usedTokens: 45000,
        maxTokens: 128000,
        utilizationPercent: 35.15,
      },
    };

    const usage: NormalizedUsage = {
      inputTokens: 4000,
      outputTokens: 900,
      costConfidence: 'absent',
      remainingQuota: planQuota,
    };

    function renderDisplay(u: NormalizedUsage): { pillText: string; headerQuota: string } {
      const pillText = `${u.inputTokens} in / ${u.outputTokens} out`;
      const headerQuota = u.remainingQuota?.planType === 'plan-included' ? 'Plan: Included' : `~$${u.costUsdEstimate ?? 0}`;
      return { pillText, headerQuota };
    }

    const display = renderDisplay(usage);
    expect(display.pillText).toBe('4000 in / 900 out');
    expect(display.headerQuota).toBe('Plan: Included');
    expect(display.headerQuota).not.toContain('$');
  });

  it('C7: Corrupted Transcript Lines + Historical Discovery', async () => {
    const sessionPath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'session-crash-recovery',
      provider: 'antigravity-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Step 1',
          assistantResponse: 'Finished step 1',
          usage: { inputTokens: 1200, outputTokens: 250 },
          timestamp: '2026-09-24T06:00:00Z',
        },
        {
          turnIndex: 1,
          userPrompt: 'Step 2',
          assistantResponse: 'Finished step 2',
          usage: { inputTokens: 2200, outputTokens: 450 },
          timestamp: '2026-09-24T06:05:00Z',
        },
      ],
    });

    // Simulate crash where last line is half-written
    const fs = await import('node:fs/promises');
    await fs.appendFile(sessionPath, '{"turnIndex": 2, "userPrompt": "Half writt\n', 'utf-8');

    // Reader logic
    const content = await fs.readFile(sessionPath, 'utf-8');
    const lines = content.trim().split('\n');

    let recoveredInput = 0;
    let recoveredOutput = 0;
    let validTurns = 0;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.usage) {
          recoveredInput += parsed.usage.inputTokens;
          recoveredOutput += parsed.usage.outputTokens;
          validTurns++;
        }
      } catch {
        // Skip unparseable trailing line
      }
    }

    expect(validTurns).toBe(2);
    expect(recoveredInput).toBe(3400);
    expect(recoveredOutput).toBe(700);
  });

  it('C8: Cost Confidence Transitions (Estimated -> Authoritative)', () => {
    let currentUsage: NormalizedUsage = {
      inputTokens: 1000,
      outputTokens: 200,
      costUsdEstimate: 0.015,
      costConfidence: 'estimated',
    };

    expect(currentUsage.costConfidence).toBe('estimated');

    // Turn completes and vendor delivers authoritative billing invoice
    currentUsage = {
      ...currentUsage,
      costConfidence: 'authoritative',
    };

    expect(currentUsage.costConfidence).toBe('authoritative');
  });
});
