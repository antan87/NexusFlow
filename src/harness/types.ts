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

export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  /** cache reads + cache creation, summed */
  cachedInputTokens?: number;
  /** Client-side ESTIMATE of equivalent API cost. Never authoritative. Never use for chargeback. */
  costUsdEstimate?: number;
};

/** Derived from auth method: plan-included sessions render tokens prominently and suppress or label dollar estimates. */
export type BillingMode = "per-token" | "plan-included";

export type ApprovalDecision =
  | { behavior: "allow"; updatedInput?: unknown }
  | { behavior: "deny"; message: string };

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** Mirrors Claude's ResumeMode. Codex ignores `mode:"fork"` (see adapter). */
export type ResumeMode = "resume" | "fork";

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
  mcpServers?: Record<string, unknown>;
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
  | { type: "turn_failed"; error: SerializedError; fatal: boolean }
  | { type: "raw"; vendor: Vendor; payload: unknown };
