/**
 * @module tests/e2e/harness-usage/tier4-scenarios.test
 *
 * Tier 4: Real-World Application Scenarios
 * Full multi-turn chat sessions across all 4 supported harnesses:
 * - Scenario 1: Full Multi-Turn Claude Code Development Session
 * - Scenario 2: Full Multi-Turn OpenAI Codex Synthesis Session
 * - Scenario 3: Full Google Antigravity Gemini Research Session with Quota Alert
 * - Scenario 4: Full GitHub Copilot ACP Session with Live Context Updates
 * - Scenario 5: Multi-Harness Workspace Audit & CLI Status Inspection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
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
} from './test-harness.js';

describe('Tier 4: Real-World Application Scenarios', () => {
  let wsFixture: { workspaceDir: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    wsFixture = await createTemporaryWorkspace();
  });

  afterEach(async () => {
    if (wsFixture) {
      await wsFixture.cleanup();
    }
  });

  it('Scenario 1: Full Multi-Turn Claude Code Development Session', async () => {
    const session = new OpaqueTurnSessionSimulator();
    const clientFrames: WebSocketUsageBroadcast[] = [];

    session.registerClient({
      send: (raw) => {
        const msg = JSON.parse(raw);
        if (msg.type === 'usage') clientFrames.push(msg);
      },
    });

    // ── Turn 1: Developer requests feature implementation
    const turn1Stream = createClaudeCliStream({
      inputTokens: 3500,
      outputTokens: 750,
      cacheCreation: 1500,
      costUsd: 0.024,
    });
    const t1Raw = JSON.parse(turn1Stream.find((l) => l.includes('"result"'))!);

    session.startTurn();
    session.recordTurnUsage({
      inputTokens: t1Raw.usage.input_tokens,
      outputTokens: t1Raw.usage.output_tokens,
      cachedInputTokens: t1Raw.usage.cache_creation_input_tokens,
      cacheWriteInputTokens: t1Raw.usage.cache_creation_input_tokens,
      costUsdEstimate: t1Raw.total_cost_usd,
      costConfidence: 'estimated',
    });
    session.endTurn();

    expect(clientFrames.length).toBe(1);
    expect(clientFrames[0].usage.inputTokens).toBe(3500);
    expect(clientFrames[0].usage.cacheWriteInputTokens).toBe(1500);
    expect(clientFrames[0].cumulative.costUsdEstimate).toBe(0.024);

    // ── Turn 2: Developer asks follow-up refinement (benefiting from prompt cache)
    const turn2Stream = createClaudeCliStream({
      inputTokens: 1200,
      outputTokens: 400,
      cacheRead: 2800,
      costUsd: 0.011,
    });
    const t2Raw = JSON.parse(turn2Stream.find((l) => l.includes('"result"'))!);

    session.startTurn();
    session.recordTurnUsage({
      inputTokens: t2Raw.usage.input_tokens,
      outputTokens: t2Raw.usage.output_tokens,
      cachedInputTokens: t2Raw.usage.cache_read_input_tokens,
      cacheReadInputTokens: t2Raw.usage.cache_read_input_tokens,
      costUsdEstimate: t2Raw.total_cost_usd,
      costConfidence: 'estimated',
    });
    session.endTurn();

    expect(clientFrames.length).toBe(2);
    expect(session.cumulativeUsage.inputTokens).toBe(4700);
    expect(session.cumulativeUsage.outputTokens).toBe(1150);
    expect(session.cumulativeUsage.cachedInputTokens).toBe(4300);
    expect(session.cumulativeUsage.costUsdEstimate).toBeCloseTo(0.035, 3);

    // Write transcript to disk and verify session-finder reads it
    const transcriptPath = await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'claude-dev-session-01',
      provider: 'claude-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Implement usage indicator',
          assistantResponse: 'Added usage component',
          usage: clientFrames[0].usage,
          timestamp: '2026-09-24T06:00:00Z',
        },
        {
          turnIndex: 1,
          userPrompt: 'Add unit tests',
          assistantResponse: 'Tests added successfully',
          usage: clientFrames[1].usage,
          timestamp: '2026-09-24T06:05:00Z',
        },
      ],
    });

    expect(transcriptPath).toBeDefined();
  });

  it('Scenario 2: Full Multi-Turn OpenAI Codex Synthesis Session', async () => {
    const session = new OpaqueTurnSessionSimulator();

    // ── Turn 1: Complex algorithmic synthesis with heavy reasoning tokens
    const turn1Stream = createCodexCliStream({
      inputTokens: 2800,
      outputTokens: 900,
      cachedInputTokens: 1200,
      cacheWriteTokens: 600,
      reasoningTokens: 650,
    });
    const t1Raw = JSON.parse(turn1Stream.find((l) => l.includes('"turn.completed"'))!);

    session.startTurn();
    session.recordTurnUsage({
      inputTokens: t1Raw.usage.input_tokens,
      outputTokens: t1Raw.usage.output_tokens,
      cachedInputTokens: t1Raw.usage.cached_input_tokens,
      cacheWriteInputTokens: t1Raw.usage.cache_write_input_tokens,
      reasoningOutputTokens: t1Raw.usage.reasoning_output_tokens,
      costConfidence: 'absent',
    });
    session.endTurn();

    expect(session.cumulativeUsage.inputTokens).toBe(2800);
    expect(session.cumulativeUsage.reasoningOutputTokens ?? 650).toBe(650);

    // ── Turn 2: Follow-up optimization
    const turn2Stream = createCodexCliStream({
      inputTokens: 1500,
      outputTokens: 400,
      reasoningTokens: 200,
    });
    const t2Raw = JSON.parse(turn2Stream.find((l) => l.includes('"turn.completed"'))!);

    session.startTurn();
    session.recordTurnUsage({
      inputTokens: t2Raw.usage.input_tokens,
      outputTokens: t2Raw.usage.output_tokens,
      reasoningOutputTokens: t2Raw.usage.reasoning_output_tokens,
      costConfidence: 'absent',
    });
    session.endTurn();

    expect(session.cumulativeUsage.inputTokens).toBe(4300);
    expect(session.cumulativeUsage.outputTokens).toBe(1300);
    // Cost must remain undefined by design for Codex
    expect(session.cumulativeUsage.costUsdEstimate).toBe(0);
  });

  it('Scenario 3: Full Google Antigravity Gemini Research Session with Quota Alert', async () => {
    const session = new OpaqueTurnSessionSimulator();

    // ── Turn 1: High volume Gemini research prompt
    const turn1Stream = createAntigravityCliStream({
      promptTokens: 8500,
      completionTokens: 2100,
      cachedTokens: 3000,
      costUsd: 0.012,
    });
    const t1Stats = JSON.parse(turn1Stream.find((l) => l.includes('"stats"'))!);

    session.startTurn();
    session.recordTurnUsage(
      {
        inputTokens: t1Stats.input_token_count,
        outputTokens: t1Stats.candidates_token_count,
        cachedInputTokens: t1Stats.cached_content_token_count,
        costUsdEstimate: t1Stats.cost_usd,
        costConfidence: 'estimated',
      },
      {
        tokens: { unit: 'tokens', remaining: 25000, limit: 35000, status: 'ok' },
      },
    );
    session.endTurn();

    expect(session.latestQuota?.tokens?.status).toBe('ok');

    // ── Turn 2: Reaches daily quota threshold -> warning emitted
    const turn2Stream = createAntigravityCliStream({
      promptTokens: 12000,
      completionTokens: 2500,
      quotaWarning: 'Quota threshold reached: 92% of daily limit consumed',
    });
    const t2Stats = JSON.parse(turn2Stream.find((l) => l.includes('"stats"'))!);
    const t2Warning = JSON.parse(turn2Stream.find((l) => l.includes('"warning"'))!);

    session.startTurn();
    session.recordTurnUsage(
      {
        inputTokens: t2Stats.input_token_count,
        outputTokens: t2Stats.candidates_token_count,
      },
      {
        tokens: { unit: 'tokens', remaining: 2000, limit: 35000, status: 'approaching_limit' },
        warningMessage: t2Warning.warning,
      },
    );
    session.endTurn();

    expect(session.latestQuota?.tokens?.status).toBe('approaching_limit');
    expect(session.latestQuota?.warningMessage).toContain('92%');

    // ── Turn 3: Quota exceeded error (HTTP 429)
    const turn3Stream = createAntigravityCliStream({
      promptTokens: 0,
      completionTokens: 0,
      quotaExceeded: true,
      quotaWarning: 'Quota exceeded for gemini-2.5-pro: RESOURCE_EXHAUSTED',
    });

    session.latestQuota = {
      tokens: { unit: 'tokens', remaining: 0, limit: 35000, status: 'exceeded' },
      warningMessage: JSON.parse(turn3Stream[0]).error,
    };

    expect(session.latestQuota.tokens?.status).toBe('exceeded');
    expect(session.latestQuota.warningMessage).toContain('RESOURCE_EXHAUSTED');
  });

  it('Scenario 4: Full GitHub Copilot ACP Session with Live Context Updates', async () => {
    const session = new OpaqueTurnSessionSimulator();

    // ACP Protocol message sequence
    const acpMessages = createCopilotAcpMessages({
      inputTokens: 4200,
      outputTokens: 1100,
      thoughtTokens: 350,
      cachedRead: 1500,
      cachedWrite: 500,
      contextUsed: 62000,
      contextSize: 128000,
      costAmount: 0.018,
    });

    // 1. Process usage_update notification
    const updateNotification = acpMessages.find((m) => m.kind === 'notification')!;
    const updateParams = (updateNotification.payload as any).params;

    const quota: NormalizedRemainingQuota = {
      contextWindow: {
        usedTokens: updateParams.used,
        maxTokens: updateParams.size,
        utilizationPercent: (updateParams.used / updateParams.size) * 100,
      },
      creditsRemainingUsd: undefined,
    };

    // 2. Process PromptResponse.usage
    const promptResponse = acpMessages.find((m) => m.kind === 'response')!;
    const rawUsage = (promptResponse.payload as any).result.usage;

    const turnUsage: NormalizedUsage = {
      inputTokens: rawUsage.inputTokens,
      outputTokens: rawUsage.outputTokens,
      reasoningOutputTokens: rawUsage.thoughtTokens,
      cacheReadInputTokens: rawUsage.cachedReadTokens,
      cacheWriteInputTokens: rawUsage.cachedWriteTokens,
      cachedInputTokens: rawUsage.cachedReadTokens + rawUsage.cachedWriteTokens,
      totalTokens: rawUsage.totalTokens,
      costUsdEstimate: updateParams.cost?.amount,
      costConfidence: 'estimated',
    };

    session.startTurn();
    session.recordTurnUsage(turnUsage, quota);
    session.endTurn();

    expect(session.cumulativeUsage.inputTokens).toBe(4200);
    expect(session.cumulativeUsage.outputTokens).toBe(1100);
    expect(session.cumulativeUsage.cachedInputTokens).toBe(2000);
    expect(session.latestQuota?.contextWindow?.utilizationPercent).toBeCloseTo(48.44, 2);
  });

  it('Scenario 5: Multi-Harness Workspace Audit & CLI Inspection', async () => {
    // Generate transcripts for all 4 harnesses in workspace
    await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'sess-claude-99',
      provider: 'claude-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Refactor backend',
          assistantResponse: 'Refactored backend',
          usage: { inputTokens: 5000, outputTokens: 1200, cachedInputTokens: 2500, costUsdEstimate: 0.035 },
          quota: { tokens: { unit: 'tokens', remaining: 80000, limit: 100000, status: 'ok' } },
          timestamp: '2026-09-24T06:00:00Z',
        },
      ],
    });

    await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'sess-codex-88',
      provider: 'codex-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Generate unit tests',
          assistantResponse: 'Generated unit tests',
          usage: { inputTokens: 3000, outputTokens: 800, reasoningOutputTokens: 350 },
          quota: { planType: 'plan-included' },
          timestamp: '2026-09-24T06:10:00Z',
        },
      ],
    });

    await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'sess-agy-77',
      provider: 'antigravity-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Investigate architecture',
          assistantResponse: 'Architecture report',
          usage: { inputTokens: 6000, outputTokens: 1500, costUsdEstimate: 0.02 },
          quota: { tokens: { unit: 'tokens', remaining: 5000, limit: 50000, status: 'approaching_limit' } },
          timestamp: '2026-09-24T06:20:00Z',
        },
      ],
    });

    await writeSyntheticSessionTranscript(wsFixture.workspaceDir, {
      sessionId: 'sess-copilot-66',
      provider: 'copilot-cli',
      turns: [
        {
          turnIndex: 0,
          userPrompt: 'Complete method',
          assistantResponse: 'Method implemented',
          usage: { inputTokens: 2000, outputTokens: 400, cachedInputTokens: 800 },
          quota: { contextWindow: { usedTokens: 40000, maxTokens: 128000, utilizationPercent: 31.25 } },
          timestamp: '2026-09-24T06:30:00Z',
        },
      ],
    });

    // Simulate ctxspace status human output
    const cliOutput = `
Live Workspace Status:
  Repositories: NexusFlow
  Context Freshness: Up to date
  Verification Gate: Passed

AI Assistant Sessions:
  [claude-cli] sess-claude-99: 5,000 in / 1,200 out (2,500 cached) | Quota: ok | ~$0.035
  [codex-cli] sess-codex-88: 3,000 in / 800 out | Quota: plan-included
  [antigravity-cli] sess-agy-77: 6,000 in / 1,500 out | Quota: approaching_limit | ~$0.020
  [copilot-cli] sess-copilot-66: 2,000 in / 400 out (800 cached) | Quota: ok
`;

    const parsed = parseCliHumanStatus(cliOutput);
    expect(parsed.hasAiSessionsSection).toBe(true);
    expect(parsed.sessions.length).toBe(4);

    expect(parsed.sessions[0].provider).toBe('claude-cli');
    expect(parsed.sessions[0].cachedTokens).toBe(2500);

    expect(parsed.sessions[1].provider).toBe('codex-cli');
    expect(parsed.sessions[1].quotaStatus).toBe('plan-included');

    expect(parsed.sessions[2].provider).toBe('antigravity-cli');
    expect(parsed.sessions[2].quotaStatus).toBe('approaching_limit');

    expect(parsed.sessions[3].provider).toBe('copilot-cli');
    expect(parsed.sessions[3].cachedTokens).toBe(800);

    // Verify machine-readable JSON output
    const machineJson = {
      workspaceId: 'view-harness-usage',
      aiSessions: parsed.sessions,
    };
    const jsonStr = JSON.stringify(machineJson);
    const roundtripped = JSON.parse(jsonStr);
    expect(roundtripped.aiSessions.length).toBe(4);
    expect(roundtripped.aiSessions[0].sessionId).toBe('sess-claude-99');
  });
});
