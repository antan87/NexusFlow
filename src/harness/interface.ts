import type {
  ApprovalDecision,
  AuthStatus,
  HarnessEvent,
  ResumeSpec,
  StartSpec,
  Vendor,
  WorkspaceRef,
} from "./types.js";

export type SessionSummary = {
  id: string;
  updatedAt: string;
  title?: string;
};

export interface SessionHandle {
  readonly vendor: Vendor;

  /**
   * LAZY: resolves when the engine reports its ID mid-stream.
   * Rejects if the turn fails before initialization (see adapters' reject path).
   */
  sessionId(): Promise<string>;

  /** Terminates after explicit dispose() or fatal unrecoverable error. Multi-turn stream stays alive across turns. */
  events: AsyncIterable<HarnessEvent>;

  /** Queue a follow-up user turn. One in-flight turn per handle (adapters serialize). */
  send(prompt: string): void;

  /** Resolve a pending approval_required event. No-op for unknown IDs. */
  respondToApproval(requestId: string, decision: ApprovalDecision): void;

  interrupt(): Promise<void>;

  /** Closes input queues, cancels active turns, and terminates the event stream. */
  dispose(): Promise<void>;
}

export interface HarnessAdapter {
  readonly vendor: Vendor;
  start(spec: StartSpec): Promise<SessionHandle>;
  resume(spec: ResumeSpec): Promise<SessionHandle>;
  /** Check engine authentication status (API key presence, OAuth tokens, session validity). */
  authStatus(workspace?: WorkspaceRef, env?: Record<string, string>): Promise<AuthStatus>;
  /** Backed by Claude sessionStore. Throws for Codex (known asymmetry). */
  listSessions(workspace: WorkspaceRef): Promise<SessionSummary[]>;
}

export class UnsupportedOperationError extends Error {
  constructor(
    public readonly vendor: Vendor,
    public readonly operation: string,
    reason: string,
  ) {
    super(`[${vendor}] ${operation} unsupported: ${reason}`);
  }
}

export class AuthRequiredError extends Error {
  constructor(public readonly vendor: Vendor, message: string) {
    super(`[${vendor}] Authentication required: ${message}`);
  }
}
