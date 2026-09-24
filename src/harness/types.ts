/**
 * Normalized harness contract for NexusFlow.
 *
 * RULES:
 * - Nothing vendor-specific leaks past this boundary except through
 *   `nativeOptions` (input) and `raw` events (output). Both are deliberate
 *   escape hatches and must stay typed `unknown`/opaque forever.
 * - Every event is fire-and-forget except `approval_required`, which expects
 *   a matching `respondToApproval()` call.
 */

export type Vendor = "claude-code" | "codex";

export type WorkspaceRef = {
  workspaceId: string;
  /** Absolute path to workspace root. May be a multi-repo root. */
  rootPath: string;
  /** Per-repo dirs Claude may additionally access. Ignored by Codex. */
  additionalDirectories?: string[];
};

export interface QuotaWindow {
  /** Unit of measurement for the quota window. */
  unit: 'tokens' | 'requests' | 'percent';
  /** Number of units remaining in current window, if reported. */
  remaining?: number;
  /** Total limit capacity in current window, if reported. */
  limit?: number;
  /** Units consumed in the current window. */
  used?: number;
  /** ISO timestamp when the current window resets (e.g. '2026-09-24T12:00:00.000Z'). */
  resetsAt?: string;
  /** Remaining seconds until reset. */
  resetInSeconds?: number;
  /** Status classification of the quota window. */
  status?: 'ok' | 'approaching_limit' | 'exceeded';
}

export interface NormalizedRemainingQuota {
  /** Request-rate limit window (RPM). */
  requests?: QuotaWindow;
  /** Token-rate limit window (TPM / TPD). */
  tokens?: QuotaWindow;
  /** Context window utilization telemetry for the active session. */
  contextWindow?: {
    usedTokens: number;
    maxTokens: number;
    utilizationPercent?: number; // 0.0 - 100.0
  };
  /** Provider-reported account or credit balance remaining in USD/credits. */
  creditsRemainingUsd?: number;
  /** Plan / billing classification if known. */
  planType?: 'per-token' | 'plan-included' | 'free-tier';
  /** Human-readable quota or tier label (e.g. "Pro tier", "Rate limit tier 4"). */
  label?: string;
  /** Whether the quota numbers are calculated client-side estimates vs authoritative vendor signals. */
  isEstimated?: boolean;
  /** Warning or error message if approaching limit or quota exhausted. */
  warningMessage?: string;
}

export type CostConfidence = 'authoritative' | 'estimated' | 'absent';

export type NormalizedUsage = {
  /** Prompt / input tokens consumed in this turn. Always present (or 0). */
  inputTokens: number;
  /** Completion / output tokens consumed in this turn. Always present (or 0). */
  outputTokens: number;
  /** Total cached input tokens (cache reads + cache writes/creation). Optional. */
  cachedInputTokens?: number;
  /** Tokens read from cache (prompt cache hits). Optional. */
  cacheReadInputTokens?: number;
  /** Tokens written to cache (prompt cache creation). Optional. */
  cacheWriteInputTokens?: number;
  /** Internal reasoning / thought / thinking tokens. Optional. */
  reasoningOutputTokens?: number;
  /** Total tokens consumed in this turn (input + output). Optional. */
  totalTokens?: number;
  /** Client-side or vendor-reported estimate of equivalent cost in USD. Optional. */
  costUsdEstimate?: number;
  /** Confidence classification for cost estimation. Optional. */
  costConfidence?: CostConfidence;
  /** Vendor-reported or derived remaining quota and limits snapshot. Optional. */
  remainingQuota?: NormalizedRemainingQuota;
};

/** Derived from auth method: plan-included sessions render tokens prominently and suppress or label dollar estimates. */
export type BillingMode = "per-token" | "plan-included";

export type ApprovalDecision =
  | { behavior: "allow"; updatedInput?: unknown }
  | { behavior: "deny"; message: string };

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** Mirrors Claude's ResumeMode. Codex ignores `mode:"fork"` (see adapter). */
export type ResumeMode = "resume" | "fork";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServersConfig = Record<string, McpServerConfig>;

export type StartSpec = {
  prompt: string;
  workspace: WorkspaceRef;
  model?: string;
  maxTurns?: number;
  permissionMode?: PermissionMode;
  /**
   * Extra env vars for the child process.
   * Callers MUST inject CLAUDE_CODE_PROJECT_DIR_NAME=<workspaceId> (+ CLAUDE_CONFIG_DIR)
   * here for cross-host sessionStore keying (Phase 1 requirement).
   * Note: Merged on top of process.env (spread-overrides); cannot unset host variables.
   */
  env?: Record<string, string>;
  mcpServers?: McpServersConfig;
  /**
   * ESCAPE HATCH — vendor-native option bag, spread LAST so it overrides
   * everything above. Never widen this type.
   */
  nativeOptions?: unknown;
  /** Mirror every underlying vendor message/event as `raw`. Dev/debug only. */
  debugMirrorRaw?: boolean;
};

export type ResumeSpec = Omit<StartSpec, "prompt"> & {
  sessionId: string;
  /** Omit to resume without a new user turn (e.g. orphan-sweep "resume?" action). */
  prompt?: string;
  /**
   * "fork" = branch transcript, preserve original (audit-safe retries).
   * NOTE: forks conversation history ONLY — file mutations stay shared.
   * Pair with worktree/checkpointing for isolated exploration.
   */
  mode: ResumeMode;
};

export type SerializedError = {
  message: string;
  name?: string;
  stack?: string;
};

export type AuthMethod =
  | "api-key"
  | "subscription-oauth"
  | "chatgpt-signin"
  | "cloud-gateway"
  | "unauthenticated";

export type AuthStatus = {
  configured: boolean;
  method?: AuthMethod;
  email?: string;
  hasApiKeyFallback?: boolean;
  message?: string;
};

export type PatchKind = "write" | "edit" | "delete" | string;

export type HarnessEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "assistant_message"; text: string }
  | { type: "tool_requested"; callId?: string; tool: string; input?: unknown }
  | { type: "tool_completed"; callId?: string; ok: boolean; outputSummary?: string }
  | { type: "file_changed"; kind: PatchKind; paths: string[] }
  | { type: "approval_required"; requestId: string; tool: string; input?: unknown }
  | { type: "turn_completed"; usage: NormalizedUsage }
  | { type: "quota_updated"; quota: NormalizedRemainingQuota }
  | { type: "turn_failed"; error: SerializedError; fatal: boolean }
  | { type: "raw"; vendor: Vendor; payload: unknown };
