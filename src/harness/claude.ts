import { randomUUID } from "node:crypto";
import {
  query,
  type CanUseTool,
  type Options,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  type HarnessAdapter,
  type SessionHandle,
  type SessionSummary,
  UnsupportedOperationError,
} from "./interface.js";
import { Pushable } from "./pushable.js";
import type {
  ApprovalDecision,
  AuthStatus,
  HarnessEvent,
  NormalizedUsage,
  ResumeSpec,
  SerializedError,
  StartSpec,
  WorkspaceRef,
} from "./types.js";

interface SDKUserMessage {
  type: "user";
  message: {
    role: "user";
    content: Array<{ type: "text"; text: string } | string> | string;
  };
  parent_tool_use_id?: string | null;
}

type BaseSpec = Omit<StartSpec, "prompt"> & { prompt?: string };

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return {
      message: err.message || "Unknown error",
      name: err.name,
      stack: err.stack,
    };
  }
  return { message: String(err) };
}

export class ClaudeCodeAdapter implements HarnessAdapter {
  readonly vendor = "claude-code" as const;

  constructor(private readonly sessionStore?: unknown) {}

  async start(spec: StartSpec): Promise<SessionHandle> {
    return this.spawn(spec);
  }

  async resume(spec: ResumeSpec): Promise<SessionHandle> {
    return this.spawn(spec, {
      resume: spec.sessionId,
      forkSession: spec.mode === "fork", // audit-preserving retries => mode:"fork"
    });
  }

  async authStatus(_workspace?: WorkspaceRef): Promise<AuthStatus> {
    const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const hasOAuth = Boolean(
      process.env.CLAUDE_CODE_OAUTH_TOKEN ||
      process.env.CLAUDE_CODE_SETUP_TOKEN
    );

    if (hasOAuth) {
      return {
        configured: true,
        method: "subscription-oauth",
        hasApiKeyFallback: hasApiKey,
      };
    }
    if (hasApiKey) {
      return {
        configured: true,
        method: "api-key",
        hasApiKeyFallback: true,
      };
    }
    return {
      configured: false,
      method: "unauthenticated",
      message: "No Anthropic API key or Claude Code OAuth token detected.",
    };
  }

  async listSessions(_workspace: WorkspaceRef): Promise<SessionSummary[]> {
    // Requires CLAUDE_CODE_PROJECT_DIR_NAME=<workspaceId> to have been set at
    // session start, so projectKey matches across hosts. TODO(spike-2).
    throw new UnsupportedOperationError(
      "claude-code",
      "listSessions",
      "wire to sessionStore-backed listSessions() once store adapter lands",
    );
  }

  // ── internals ──────────────────────────────────────────────────────────

  private spawn(
    spec: BaseSpec,
    overrides: Partial<Options> = {},
  ): SessionHandle {
    const out = new Pushable<HarnessEvent>();
    // Streaming-input mode: enables multi-turn `send()` without losing the session.
    const userInput = new Pushable<SDKUserMessage>();
    const approvals = new Map<string, (d: ApprovalDecision) => void>();
    const abort = new AbortController();

    let resolveId!: (s: string) => void;
    let rejectId!: (e: Error) => void;
    const sessionIdPromise = new Promise<string>((res, rej) => {
      resolveId = res;
      rejectId = rej;
    });

    abort.signal.addEventListener(
      "abort",
      () => rejectId(new DOMException("aborted", "AbortError")),
      { once: true },
    );

    if (spec.prompt !== undefined && spec.prompt.length > 0) {
      userInput.push({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "text", text: spec.prompt }],
        },
        parent_tool_use_id: null,
      });
    }

    // Approval bridge: canUseTool callback ↔ approval_required event + respondToApproval()
    const canUseTool: CanUseTool = async (_toolName, _input, { signal }) => {
      const requestId = randomUUID();
      out.push({
        type: "approval_required",
        requestId,
        tool: _toolName as string,
        input: _input,
      });
      // Auto-deny on timeout so handles never hang indefinitely
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(requestId);
          resolve({ behavior: "deny", message: "Approval request timed out after 5 minutes" });
        }, 5 * 60 * 1000);

        approvals.set(requestId, (decision: ApprovalDecision) => {
          clearTimeout(timer);
          approvals.delete(requestId);
          if (decision.behavior === "allow") {
            resolve({
              behavior: "allow",
              updatedInput: decision.updatedInput as Record<string, unknown> | undefined,
            });
          } else {
            resolve({
              behavior: "deny",
              message: decision.message,
            });
          }
        });

        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            approvals.delete(requestId);
            resolve({ behavior: "deny", message: "interrupted" });
          },
          { once: true },
        );
      });
    };

    void this.pump({
      spec,
      overrides,
      userInput,
      out,
      canUseTool,
      approvals,
      resolveId,
      rejectId,
      abortController: abort,
    });

    return {
      vendor: this.vendor,
      sessionId: () => sessionIdPromise,
      events: out,
      send: (prompt) =>
        userInput.push({
          type: "user",
          message: {
            role: "user",
            content: [{ type: "text", text: prompt }],
          },
          parent_tool_use_id: null,
        }),
      respondToApproval: (requestId, decision) =>
        approvals.get(requestId)?.(decision),
      interrupt: async () => abort.abort(),
      dispose: async () => {
        abort.abort();
        userInput.end();
        out.end();
      },
    };
  }

  private async pump(args: {
    spec: BaseSpec;
    overrides: Partial<Options>;
    userInput: Pushable<SDKUserMessage>;
    out: Pushable<HarnessEvent>;
    canUseTool: CanUseTool;
    approvals: Map<string, (d: ApprovalDecision) => void>;
    resolveId: (s: string) => void;
    rejectId: (e: Error) => void;
    abortController: AbortController;
  }): Promise<void> {
    const { spec, overrides, userInput, out, canUseTool, abortController } = args;
    try {
      const options: Options = {
        cwd: spec.workspace.rootPath,
        additionalDirectories: spec.workspace.additionalDirectories,
        permissionMode: spec.permissionMode ?? "acceptEdits",
        maxTurns: spec.maxTurns,
        model: spec.model,
        // Caller injects CLAUDE_CODE_PROJECT_DIR_NAME + CLAUDE_CONFIG_DIR here.
        // TODO(spike-2): verify SDK env REPLACES process.env vs merges —
        // if it replaces, callers must spread process.env themselves.
        env: spec.env,
        mcpServers: spec.mcpServers as any,
        canUseTool,
        includePartialMessages: true, // enables stream_event deltas below
        sessionStore: this.sessionStore as any,
        abortController,
        ...overrides,
        // ESCAPE HATCH — deliberately last, wins over everything above.
        ...(spec.nativeOptions as Partial<Options>),
      };

      const queryHandle = query({
        prompt: userInput as any,
        options,
      });

      for await (const msg of queryHandle) {
        this.mapMessage(msg, out, args);
      }
    } catch (err) {
      args.rejectId(err instanceof Error ? err : new Error(String(err))); // sessionId() must not hang on pre-init failure
      out.push({ type: "turn_failed", error: serializeError(err), fatal: true });
      out.end();
    }
  }

  private mapMessage(
    msg: SDKMessage,
    out: Pushable<HarnessEvent>,
    args: {
      resolveId: (s: string) => void;
      rejectId: (e: Error) => void;
      spec: BaseSpec;
    },
  ): void {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          args.resolveId(msg.session_id);
          out.push({ type: "session_started", sessionId: msg.session_id });
        }
        break;

      case "stream_event": {
        // Partial assistant text deltas (requires includePartialMessages).
        const event = (msg as any).event;
        if (event?.type === "content_block_delta" && event?.delta?.type === "text_delta" && event.delta.text) {
          out.push({ type: "text_delta", text: event.delta.text });
        }
        break;
      }

      case "assistant":
        for (const block of (msg as any).message?.content ?? []) {
          if (block.type === "text") {
            out.push({ type: "assistant_message", text: block.text });
          } else if (block.type === "tool_use") {
            out.push({
              type: "tool_requested",
              callId: block.id,
              tool: block.name,
              input: block.input,
            });
          }
        }
        break;

      case "user": {
        // Tool results arrive as user messages.
        const content = (msg as any).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              out.push({
                type: "tool_completed",
                callId: block.tool_use_id,
                ok: !block.is_error,
              });
            }
          }
        }
        break;
      }

      case "result": {
        if (msg.subtype === "success") {
          out.push({
            type: "turn_completed",
            usage: this.normalizeUsage((msg as any).usage, (msg as any).total_cost_usd),
          });
        } else {
          out.push({
            type: "turn_failed",
            error: { message: `claude turn failed: ${msg.subtype}` },
            fatal: msg.subtype === "error_during_execution",
          });
        }
        break;
      }
    }

    if (args.spec.debugMirrorRaw) {
      out.push({ type: "raw", vendor: "claude-code", payload: msg });
    }
  }

  private normalizeUsage(u: any, costUsdEstimate?: number): NormalizedUsage {
    return {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cachedInputTokens:
        (u?.cache_read_input_tokens ?? 0) +
        (u?.cache_creation_input_tokens ?? 0),
      costUsdEstimate,
    };
  }
}
