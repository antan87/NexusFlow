/**
 * @module tests/e2e/harness-usage/test-harness
 *
 * Comprehensive E2E test harness for Harness Usage & Remaining Quota Display.
 * Provides opaque contract schemas, synthetic stream factories for all 4 harnesses
 * (Claude, Codex, Antigravity, Copilot), session transcript generators, in-memory
 * WebSocket turn simulation, and CLI status output validators.
 *
 * Strictly opaque-box: asserts only observable events, transcripts, CLI outputs,
 * and public protocol messages without relying on internal implementation details.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';
import { z } from 'zod';

// ─── 1. Canonical Interface Contracts (per PROJECT.md) ──────────────────────────

export type QuotaUnit = 'tokens' | 'requests' | 'percent';
export type QuotaStatus = 'ok' | 'approaching_limit' | 'exceeded';
export type PlanType = 'per-token' | 'plan-included' | 'free-tier';
export type CostConfidence = 'authoritative' | 'estimated' | 'absent';

export interface QuotaWindow {
  unit: QuotaUnit;
  remaining?: number;
  limit?: number;
  used?: number;
  resetsAt?: string;
  resetInSeconds?: number;
  status?: QuotaStatus;
}

export interface ContextWindowQuota {
  usedTokens: number;
  maxTokens: number;
  utilizationPercent?: number;
}

export interface NormalizedRemainingQuota {
  requests?: QuotaWindow;
  tokens?: QuotaWindow;
  contextWindow?: ContextWindowQuota;
  creditsRemainingUsd?: number;
  planType?: PlanType;
  label?: string;
  isEstimated?: boolean;
  warningMessage?: string;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsdEstimate?: number;
  costConfidence?: CostConfidence;
  remainingQuota?: NormalizedRemainingQuota;
}

export interface WebSocketUsageBroadcast {
  type: 'usage';
  usage: NormalizedUsage;
  cumulative: NormalizedUsage;
  quota?: NormalizedRemainingQuota;
}

export interface WebSocketUsageSummary {
  type: 'usage_summary';
  cumulative: NormalizedUsage;
  quota?: NormalizedRemainingQuota;
}

// ─── 2. Runtime Schema Validators (Zod) ─────────────────────────────────────────

export const QuotaWindowSchema = z.object({
  unit: z.enum(['tokens', 'requests', 'percent']),
  remaining: z.number().nonnegative().optional(),
  limit: z.number().positive().optional(),
  used: z.number().nonnegative().optional(),
  resetsAt: z.string().optional(),
  resetInSeconds: z.number().optional(),
  status: z.enum(['ok', 'approaching_limit', 'exceeded']).optional(),
});

export const ContextWindowQuotaSchema = z.object({
  usedTokens: z.number().nonnegative(),
  maxTokens: z.number().positive(),
  utilizationPercent: z.number().min(0).max(100).optional(),
});

export const NormalizedRemainingQuotaSchema = z.object({
  requests: QuotaWindowSchema.optional(),
  tokens: QuotaWindowSchema.optional(),
  contextWindow: ContextWindowQuotaSchema.optional(),
  creditsRemainingUsd: z.number().nonnegative().optional(),
  planType: z.enum(['per-token', 'plan-included', 'free-tier']).optional(),
  label: z.string().optional(),
  isEstimated: z.boolean().optional(),
  warningMessage: z.string().optional(),
});

export const NormalizedUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cachedInputTokens: z.number().nonnegative().optional(),
  cacheReadInputTokens: z.number().nonnegative().optional(),
  cacheWriteInputTokens: z.number().nonnegative().optional(),
  reasoningOutputTokens: z.number().nonnegative().optional(),
  totalTokens: z.number().nonnegative().optional(),
  costUsdEstimate: z.number().nonnegative().optional(),
  costConfidence: z.enum(['authoritative', 'estimated', 'absent']).optional(),
  remainingQuota: NormalizedRemainingQuotaSchema.optional(),
});

export function validateNormalizedUsage(data: unknown): NormalizedUsage {
  return NormalizedUsageSchema.parse(data) as NormalizedUsage;
}

export function validateNormalizedRemainingQuota(data: unknown): NormalizedRemainingQuota {
  return NormalizedRemainingQuotaSchema.parse(data) as NormalizedRemainingQuota;
}

// ─── 3. Synthetic Vendor Stream Generators ──────────────────────────────────────

/**
 * Creates realistic stdout JSON lines for Claude CLI (`claude -p ... --output-format stream-json`)
 */
export function createClaudeCliStream(options: {
  inputTokens: number;
  outputTokens: number;
  cacheRead?: number;
  cacheCreation?: number;
  costUsd?: number;
  retryAttempt?: number;
  maxRetries?: number;
  errorMessage?: string;
}): string[] {
  const lines: string[] = [];

  if (options.retryAttempt) {
    lines.push(
      JSON.stringify({
        type: 'system',
        subtype: 'api_retry',
        attempt: options.retryAttempt,
        max_retries: options.maxRetries ?? 3,
        error: options.errorMessage ?? 'Rate limit exceeded, retrying...',
      }),
    );
  }

  lines.push(
    JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Here is the response code...' },
    }),
  );

  lines.push(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      usage: {
        input_tokens: options.inputTokens,
        output_tokens: options.outputTokens,
        cache_read_input_tokens: options.cacheRead ?? 0,
        cache_creation_input_tokens: options.cacheCreation ?? 0,
      },
      total_cost_usd: options.costUsd,
    }),
  );

  return lines;
}

/**
 * Creates realistic stdout JSON lines for OpenAI Codex CLI (`codex exec --json`)
 */
export function createCodexCliStream(options: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}): string[] {
  return [
    JSON.stringify({
      type: 'turn.started',
      turn_id: 'turn-001',
    }),
    JSON.stringify({
      type: 'text.delta',
      text: 'Synthesizing algorithm...',
    }),
    JSON.stringify({
      type: 'turn.completed',
      usage: {
        input_tokens: options.inputTokens,
        output_tokens: options.outputTokens,
        cached_input_tokens: options.cachedInputTokens ?? 0,
        cache_write_input_tokens: options.cacheWriteTokens ?? 0,
        reasoning_output_tokens: options.reasoningTokens ?? 0,
      },
    }),
  ];
}

/**
 * Creates realistic stdout JSON lines for Antigravity CLI (`agy -p ... --output-format stream-json`)
 */
export function createAntigravityCliStream(options: {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  costUsd?: number;
  quotaWarning?: string;
  quotaExceeded?: boolean;
}): string[] {
  const lines: string[] = [];

  if (options.quotaExceeded) {
    lines.push(
      JSON.stringify({
        type: 'error',
        error: options.quotaWarning ?? 'Quota exceeded for gemini-2.5-pro: RESOURCE_EXHAUSTED',
      }),
    );
    return lines;
  }

  if (options.quotaWarning) {
    lines.push(
      JSON.stringify({
        type: 'warning',
        warning: options.quotaWarning,
      }),
    );
  }

  lines.push(
    JSON.stringify({
      type: 'delta',
      content: 'Antigravity plan completed successfully.',
    }),
  );

  lines.push(
    JSON.stringify({
      type: 'stats',
      input_token_count: options.promptTokens,
      candidates_token_count: options.completionTokens,
      cached_content_token_count: options.cachedTokens ?? 0,
      cost_usd: options.costUsd,
    }),
  );

  return lines;
}

/**
 * Creates realistic ACP protocol messages for GitHub Copilot (`copilot --acp --stdio`)
 */
export function createCopilotAcpMessages(options: {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens?: number;
  cachedRead?: number;
  cachedWrite?: number;
  contextUsed?: number;
  contextSize?: number;
  costAmount?: number;
}): Array<{ kind: 'response' | 'notification'; payload: unknown }> {
  const messages: Array<{ kind: 'response' | 'notification'; payload: unknown }> = [];

  if (options.contextUsed !== undefined && options.contextSize !== undefined) {
    messages.push({
      kind: 'notification',
      payload: {
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionUpdate: 'usage_update',
          used: options.contextUsed,
          size: options.contextSize,
          cost: options.costAmount !== undefined ? { amount: options.costAmount, currency: 'USD' } : null,
        },
      },
    });
  }

  messages.push({
    kind: 'response',
    payload: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        status: 'completed',
        usage: {
          inputTokens: options.inputTokens,
          outputTokens: options.outputTokens,
          thoughtTokens: options.thoughtTokens ?? 0,
          cachedReadTokens: options.cachedRead ?? 0,
          cachedWriteTokens: options.cachedWrite ?? 0,
          totalTokens: options.inputTokens + options.outputTokens,
        },
      },
    },
  });

  return messages;
}

// ─── 4. Opaque Session & Turn State Simulator ───────────────────────────────────

/**
 * Simulates the state engine of TurnSessionManager for opaque validation
 * of event accumulation, turn buffering, and WebSocket frame delivery.
 */
export class OpaqueTurnSessionSimulator extends EventEmitter {
  public cumulativeUsage: NormalizedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    costUsdEstimate: 0,
  };
  public latestQuota?: NormalizedRemainingQuota;
  public bufferedTurnEvents: Array<{ type: string; payload: unknown }> = [];
  public isTurnBusy = false;
  public clients: Array<{ send: (msg: string) => void }> = [];

  public registerClient(client: { send: (msg: string) => void }): void {
    this.clients.push(client);
    // Send immediate summary on connect/reconnect
    const summary: WebSocketUsageSummary = {
      type: 'usage_summary',
      cumulative: { ...this.cumulativeUsage },
      quota: this.latestQuota ? { ...this.latestQuota } : undefined,
    };
    client.send(JSON.stringify(summary));

    // If turn is in flight, replay buffered events
    if (this.isTurnBusy) {
      for (const event of this.bufferedTurnEvents) {
        client.send(JSON.stringify(event));
      }
    }
  }

  public startTurn(): void {
    this.isTurnBusy = true;
    this.bufferedTurnEvents = [];
  }

  public recordTurnUsage(usage: NormalizedUsage, quota?: NormalizedRemainingQuota): void {
    // Accumulate into cumulative usage
    this.cumulativeUsage.inputTokens += usage.inputTokens;
    this.cumulativeUsage.outputTokens += usage.outputTokens;
    this.cumulativeUsage.cachedInputTokens =
      (this.cumulativeUsage.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0);
    if (usage.costUsdEstimate !== undefined) {
      this.cumulativeUsage.costUsdEstimate =
        (this.cumulativeUsage.costUsdEstimate ?? 0) + usage.costUsdEstimate;
    }
    if (quota) {
      this.latestQuota = { ...quota };
    }

    const broadcastMsg: WebSocketUsageBroadcast = {
      type: 'usage',
      usage: { ...usage },
      cumulative: { ...this.cumulativeUsage },
      quota: this.latestQuota ? { ...this.latestQuota } : undefined,
    };

    if (this.isTurnBusy) {
      this.bufferedTurnEvents.push(broadcastMsg);
    }

    for (const client of this.clients) {
      client.send(JSON.stringify(broadcastMsg));
    }
  }

  public endTurn(): void {
    this.isTurnBusy = false;
  }
}

// ─── 5. Disk Session Transcript Generator ───────────────────────────────────────

export interface SyntheticTranscriptRecord {
  sessionId: string;
  provider: 'claude-cli' | 'codex-cli' | 'antigravity-cli' | 'copilot-cli';
  turns: Array<{
    turnIndex: number;
    userPrompt: string;
    assistantResponse: string;
    usage: NormalizedUsage;
    quota?: NormalizedRemainingQuota;
    timestamp: string;
  }>;
}

export async function createTemporaryWorkspace(): Promise<{
  workspaceDir: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-e2e-harness-'));
  return {
    workspaceDir: tmpDir,
    cleanup: async () => {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export async function writeSyntheticSessionTranscript(
  workspaceDir: string,
  record: SyntheticTranscriptRecord,
): Promise<string> {
  const sessionDir = path.join(workspaceDir, '.sessions', record.provider);
  await fs.mkdir(sessionDir, { recursive: true });
  const filePath = path.join(sessionDir, `${record.sessionId}.jsonl`);

  const lines = record.turns.map((turn) =>
    JSON.stringify({
      sessionId: record.sessionId,
      turnIndex: turn.turnIndex,
      provider: record.provider,
      timestamp: turn.timestamp,
      userPrompt: turn.userPrompt,
      assistantResponse: turn.assistantResponse,
      usage: turn.usage,
      quota: turn.quota,
    }),
  );

  await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf-8');
  return filePath;
}

// ─── 6. CLI Output Parsing & Formatting Helpers ─────────────────────────────────

export interface ParsedCliSessionOutput {
  hasAiSessionsSection: boolean;
  sessions: Array<{
    sessionId: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    quotaStatus?: string;
    costEstimate?: string;
  }>;
}

export function parseCliHumanStatus(stdout: string): ParsedCliSessionOutput {
  const hasAiSessionsSection =
    stdout.includes('AI Assistant Sessions') ||
    stdout.includes('Active AI Sessions') ||
    stdout.includes('Assistant Sessions');

  const sessions: ParsedCliSessionOutput['sessions'] = [];

  // Look for session table rows or formatted blocks
  const lines = stdout.split('\n');
  for (const line of lines) {
    // Matches patterns like: [claude-cli] session-123: 1,200 in / 450 out (120 cached) | Quota: ok
    const match = line.match(
      /(?:\[([a-z0-9_-]+)\])?\s*([a-zA-Z0-9_-]{6,}):\s*([\d,]+)\s*in\s*\/\s*([\d,]+)\s*out(?:\s*\(([\d,]+)\s*cached\))?(?:\s*\|\s*Quota:\s*([a-zA-Z_-]+))?(?:\s*\|\s*(~\$[\d.]+))?/i,
    );
    if (match) {
      sessions.push({
        provider: match[1] || 'unknown',
        sessionId: match[2],
        inputTokens: parseInt(match[3].replace(/,/g, ''), 10),
        outputTokens: parseInt(match[4].replace(/,/g, ''), 10),
        cachedTokens: match[5] ? parseInt(match[5].replace(/,/g, ''), 10) : undefined,
        quotaStatus: match[6],
        costEstimate: match[7],
      });
    }
  }

  return { hasAiSessionsSection, sessions };
}
