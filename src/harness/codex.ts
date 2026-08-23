import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Codex, type Thread } from "@openai/codex-sdk";
import {
  type HarnessAdapter,
  type SessionHandle,
  type SessionSummary,
  AuthRequiredError,
  UnsupportedOperationError,
} from "./interface.js";
import { Pushable } from "./pushable.js";
import type {
  AuthStatus,
  HarnessEvent,
  NormalizedUsage,
  PatchKind,
  ResumeSpec,
  SerializedError,
  StartSpec,
  WorkspaceRef,
} from "./types.js";

type ThreadEvent = Parameters<Parameters<Thread["runStreamed"]>[1] extends (e: infer E) => any ? E : any>[0];
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

function mapPatchKind(rawKind?: string): PatchKind {
  switch (rawKind) {
    case "add":
      return "write";
    case "update":
      return "edit";
    case "delete":
      return "delete";
    default:
      return (rawKind as PatchKind) ?? "edit";
  }
}

export class CodexAdapter implements HarnessAdapter {
  readonly vendor = "codex" as const;

  constructor(clientOpts: ConstructorParameters<typeof Codex>[0] = {}) {
    this.client = new Codex(clientOpts);
  }
  private client: Codex;

  async start(spec: StartSpec): Promise<SessionHandle> {
    const auth = await this.authStatus(spec.workspace, spec.env);
    if (!auth.configured) {
      throw new AuthRequiredError(this.vendor, auth.message ?? "Authentication required");
    }
    const thread = this.client.startThread({
      workingDirectory: spec.workspace.rootPath,
      // NexusFlow workspaces are multi-repo roots => usually NOT a git repo.
      // Without this, Codex refuses to run. Caller nativeOptions can override if provided.
      skipGitRepoCheck: true,
      ...(spec.nativeOptions as Record<string, unknown>),
    });
    return this.spawn(spec, thread);
  }

  async resume(spec: ResumeSpec): Promise<SessionHandle> {
    const auth = await this.authStatus(spec.workspace, spec.env);
    if (!auth.configured) {
      throw new AuthRequiredError(this.vendor, auth.message ?? "Authentication required");
    }
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

  async authStatus(_workspace?: WorkspaceRef, env?: Record<string, string>): Promise<AuthStatus> {
    const hasApiKey = Boolean(
      env?.OPENAI_API_KEY ??
      process.env.OPENAI_API_KEY ??
      env?.CODEX_API_KEY ??
      process.env.CODEX_API_KEY
    );
    if (hasApiKey) {
      return {
        configured: true,
        method: "api-key",
        hasApiKeyFallback: true,
      };
    }

    // Probe Codex CLI authentication file
    const codexHome = env?.CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const authFile = path.join(codexHome, "auth.json");
    if (fs.existsSync(authFile)) {
      return {
        configured: true,
        method: "chatgpt-signin",
        hasApiKeyFallback: false,
      };
    }

    return {
      configured: false,
      method: "unauthenticated",
      message:
        "No OpenAI API key or Codex CLI authentication found (~/.codex/auth.json). Run 'codex login' or set OPENAI_API_KEY.",
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

    const safePush = (ev: HarnessEvent) => {
      if (disposed) return;
      try {
        out.push(ev);
      } catch {
        // Stream ended or disposed concurrently
      }
    };

    let resolveId!: (s: string) => void;
    let rejectId!: (e: Error) => void;
    const sessionIdPromise = new Promise<string>((res, rej) => {
      resolveId = res;
      rejectId = rej;
    });
    // Armor against unhandled rejections if caller never attaches a handler before interrupt/dispose
    sessionIdPromise.catch(() => {});

    const drain = async () => {
      if (draining || disposed) return;
      draining = true;
      try {
        while (turnQueue.length > 0 && !disposed) {
          const prompt = turnQueue.shift()!;
          await this.runTurn(thread, prompt, safePush, out, spec, resolveId, rejectId, () => disposed);
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
        try {
          out.end();
        } catch {}
      },
    };
  }

  private async runTurn(
    thread: Thread,
    prompt: string,
    safePush: (ev: HarnessEvent) => void,
    out: Pushable<HarnessEvent>,
    spec: BaseSpec,
    resolveId: (s: string) => void,
    rejectId: (e: Error) => void,
    isDisposed: () => boolean,
  ): Promise<void> {
    try {
      const run = await thread.runStreamed(prompt);
      for await (const ev of run.events) {
        if (isDisposed()) break;
        this.mapEvent(ev as any, safePush, resolveId);
        if (spec.debugMirrorRaw) {
          safePush({ type: "raw", vendor: "codex", payload: ev });
        }
      }
    } catch (err) {
      try {
        rejectId(err instanceof Error ? err : new Error(String(err)));
      } catch {}
      safePush({ type: "turn_failed", error: serializeError(err), fatal: true });
      try {
        out.end();
      } catch {}
    }
  }

  private mapEvent(
    ev: any,
    push: (ev: HarnessEvent) => void,
    resolveId: (s: string) => void,
  ): void {
    switch (ev.type) {
      case "thread.started":
        resolveId((ev as any).thread_id);
        push({ type: "session_started", sessionId: (ev as any).thread_id });
        break;

      case "item.started":
        // Command executions starting → tool_requested.
        // TODO(spike-6): confirm item discriminator field name on pinned version.
        break;

      case "item.completed":
        this.mapItem((ev as any).item, push);
        break;

      case "turn.completed":
        push({ type: "turn_completed", usage: this.normalizeUsage((ev as any).usage) });
        // Streams stay open across consecutive turns until explicit dispose()
        break;

      case "turn.failed":
        push({
          type: "turn_failed",
          error: { message: (ev as any).error?.message ?? "codex turn failed" },
          fatal: true,
        });
        break;
    }
  }

  private mapItem(item: { type: string } & Record<string, any>, push: (ev: HarnessEvent) => void): void {
    switch (item.type) {
      case "agent_message":
        push({ type: "assistant_message", text: item.text });
        break;
      case "file_change":
        push({
          type: "file_changed",
          kind: mapPatchKind(item.changes?.[0]?.kind),
          paths: item.changes?.map((c: any) => c.path) ?? [],
        });
        break;
      case "command_execution":
        push({
          type: "tool_completed",
          callId: item.id,
          ok: item.exit_code === 0,
          outputSummary: item.aggregated_output?.slice(0, 500),
        });
        break;
      case "mcp_tool_call":
        push({ type: "tool_completed", callId: item.id, ok: !item.status || item.status === "success" });
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
