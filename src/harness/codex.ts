import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import {
  type HarnessAdapter,
  type SessionHandle,
  type SessionSummary,
  UnsupportedOperationError,
} from "./interface.js";
import { Pushable } from "./pushable.js";
import type {
  AuthStatus,
  HarnessEvent,
  NormalizedUsage,
  ResumeSpec,
  SerializedError,
  StartSpec,
  WorkspaceRef,
} from "./types.js";

type Thread = ReturnType<Codex["startThread"]>;
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

function mapPatchKind(kind: string | undefined): "write" | "edit" | "delete" | string {
  switch (kind) {
    case "add": return "write";
    case "update": return "edit";
    case "delete": return "delete";
    default: return kind ?? "edit";
  }
}

export class CodexAdapter implements HarnessAdapter {
  readonly vendor = "codex" as const;

  constructor(clientOpts: ConstructorParameters<typeof Codex>[0] = {}) {
    this.client = new Codex(clientOpts);
  }
  private client: Codex;

  async start(spec: StartSpec): Promise<SessionHandle> {
    const thread = this.client.startThread({
      workingDirectory: spec.workspace.rootPath,
      // NexusFlow workspaces are multi-repo roots => usually NOT a git repo.
      // Without this, Codex refuses to run. (Spike #4 validates.)
      skipGitRepoCheck: true,
      ...(spec.nativeOptions as Record<string, unknown>),
    });
    return this.spawn(spec, thread);
  }

  async resume(spec: ResumeSpec): Promise<SessionHandle> {
    if (spec.mode === "fork") {
      // Known asymmetry: no native fork. Emulate later via NexusFlow-side
      // history replay onto a fresh thread. Until then, degrade loudly.
      throw new UnsupportedOperationError(
        "codex",
        "fork",
        "no native fork; emulate via history replay (Phase 3)",
      );
    }
    const thread = this.client.resumeThread(spec.sessionId);
    return this.spawn(spec, thread);
  }

  async authStatus(_workspace?: WorkspaceRef): Promise<AuthStatus> {
    const hasApiKey = Boolean(process.env.OPENAI_API_KEY);
    // TODO(spike-7): Probe Codex CLI session/auth configuration
    if (hasApiKey) {
      return {
        configured: true,
        method: "api-key",
        hasApiKeyFallback: true,
      };
    }
    return {
      configured: true,
      method: "chatgpt-signin",
      message: "Using Codex CLI authentication.",
    };
  }

  async listSessions(_workspace: WorkspaceRef): Promise<SessionSummary[]> {
    throw new UnsupportedOperationError(
      "codex",
      "listSessions",
      "~/.codex/sessions rollout files are opaque; NexusFlow DB rows are source of truth",
    );
  }

  // ── internals ──────────────────────────────────────────────────────────

  private spawn(spec: BaseSpec, thread: Thread): SessionHandle {
    const out = new Pushable<HarnessEvent>();
    // Serial turn queue: Codex threads support sequential runs, not concurrent ones.
    const turnQueue: string[] = [];
    let draining = false;
    let disposed = false;

    let resolveId!: (s: string) => void;
    let rejectId!: (e: Error) => void;
    const sessionIdPromise = new Promise<string>((res, rej) => {
      resolveId = res;
      rejectId = rej;
    });

    const drain = async () => {
      if (draining || disposed) return;
      draining = true;
      try {
        while (turnQueue.length > 0 && !disposed) {
          const prompt = turnQueue.shift()!;
          await this.runTurn(thread, prompt, out, spec, resolveId, rejectId);
        }
      } finally {
        draining = false;
      }
    };

    if (spec.prompt !== undefined && spec.prompt.length > 0) {
      turnQueue.push(spec.prompt);
      void drain();
    }

    return {
      vendor: this.vendor,
      sessionId: () => sessionIdPromise,
      events: out,
      send: (prompt) => {
        if (disposed) return;
        turnQueue.push(prompt);
        void drain();
      },
      // Codex approvals are config-level (sandbox/approval policy) today, not
      // interactive callbacks. TODO(spike-7): confirm; until then this is a no-op.
      respondToApproval: (_requestId, _decision) => {},
      interrupt: async () => {
        // TODO(spike-5): thread.interrupt()/abort support in pinned SDK version.
      },
      dispose: async () => {
        disposed = true;
        turnQueue.length = 0;
        out.end();
      },
    };
  }

  private async runTurn(
    thread: Thread,
    prompt: string,
    out: Pushable<HarnessEvent>,
    spec: BaseSpec,
    resolveId: (s: string) => void,
    rejectId: (e: Error) => void,
  ): Promise<void> {
    try {
      const run = await thread.runStreamed(prompt);
      for await (const ev of run.events) {
        this.mapEvent(ev as any, out, resolveId);
        if (spec.debugMirrorRaw) {
          out.push({ type: "raw", vendor: "codex", payload: ev });
        }
      }
    } catch (err) {
      args_reject: {
        rejectId(err instanceof Error ? err : new Error(String(err)));
      }
      out.push({ type: "turn_failed", error: serializeError(err), fatal: true });
      out.end();
    }
  }

  private mapEvent(
    ev: ThreadEvent,
    out: Pushable<HarnessEvent>,
    resolveId: (s: string) => void,
  ): void {
    switch (ev.type) {
      case "thread.started":
        resolveId((ev as any).thread_id);
        out.push({ type: "session_started", sessionId: (ev as any).thread_id });
        break;

      case "item.started":
        // Command executions starting → tool_requested.
        // TODO(spike-6): confirm item discriminator field name on pinned version.
        break;

      case "item.completed":
        this.mapItem((ev as any).item, out);
        break;

      case "turn.completed":
        out.push({ type: "turn_completed", usage: this.normalizeUsage((ev as any).usage) });
        // Streams stay open across consecutive turns until explicit dispose()
        break;

      case "turn.failed":
        out.push({
          type: "turn_failed",
          error: { message: (ev as any).error?.message ?? "codex turn failed" },
          fatal: true,
        });
        out.end();
        break;
    }
  }

  private mapItem(item: { type: string } & Record<string, any>, out: Pushable<HarnessEvent>): void {
    switch (item.type) {
      case "agent_message":
        out.push({ type: "assistant_message", text: item.text });
        break;
      case "file_change":
        out.push({
          type: "file_changed",
          kind: mapPatchKind(item.changes?.[0]?.kind),
          paths: item.changes?.map((c: any) => c.path) ?? [],
        });
        break;
      case "command_execution":
        out.push({
          type: "tool_completed",
          callId: item.id,
          ok: item.exit_code === 0,
          outputSummary: item.aggregated_output?.slice(0, 500),
        });
        break;
      case "mcp_tool_call":
        out.push({ type: "tool_completed", callId: item.id, ok: !item.status || item.status === "success" });
        break;
      default:
        // reasoning / web_search / todo_list — pass-through only via raw mirroring
        break;
    }
  }

  private normalizeUsage(u?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number }): NormalizedUsage {
    return {
      inputTokens: u?.input_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      cachedInputTokens: u?.cached_input_tokens,
    }; // costUsd unavailable on Codex — left undefined by design
  }
}
