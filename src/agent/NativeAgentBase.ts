import { EventEmitter } from 'node:events';
import type { AgentSession } from './session.js';
import { openWorkspaceMcp, type McpConnection, type McpTool } from './nativeMcp.js';

/**
 * Shared lifecycle for the SDK-backed native agents. Owns the processing guard,
 * the abort controller, and the idle/error signalling so each provider only
 * implements its SDK-specific streaming loop.
 */
export abstract class NativeAgentBase extends EventEmitter {
  protected cwd: string = '';
  protected isProcessing: boolean = false;
  protected abortController: AbortController | null = null;

  /** Human label used in server-side error logs. */
  protected abstract readonly label: string;

  /** Clear provider-specific conversation history for a new session. */
  protected abstract resetHistory(): void;

  /** Run one user turn's agent loop, honoring `signal` for cancellation. */
  protected abstract runLoop(userInput: string, signal: AbortSignal): Promise<void>;

  /**
   * Returns a user-facing message when the provider isn't usable (e.g. missing
   * API key), or null when it is. Checked before each turn so a misconfigured
   * provider gives a clear error instead of a raw SDK auth exception.
   */
  protected configError(): string | null {
    return null;
  }

  /** Session for this turn, when the caller supplied one. */
  protected session?: AgentSession;

  public async start(cwd: string, session?: AgentSession): Promise<void> {
    this.cwd = cwd;
    this.session = session;
    this.resetHistory();
    // Connect once per session; a reconnect after stop() opens a fresh one.
    this.mcp = undefined;
  }

  /** Terminates the MCP server process this session spawned, if any. */
  protected async closeMcp(): Promise<void> {
    const connection = this.mcp;
    this.mcp = undefined;
    await connection?.close();
  }

  /**
   * The model to call, in the order a user expects: the model chosen in chat
   * settings, then the provider's environment override, then its baseline.
   *
   * This existed only as the second and third steps, so choosing a model in the
   * UI had no effect on any native provider — the selection was silently dropped
   * and the baseline was sent instead.
   */
  protected resolveModel(baseline: string, envVar: string): string {
    return this.session?.model ?? process.env[envVar] ?? baseline;
  }


  /** The session's MCP connection, opened once in start() and closed in stop(). */
  private mcp?: McpConnection;

  /**
   * MCP tools for this turn, or none.
   *
   * A workspace generated for a native provider carries an `.mcp.json` that
   * nothing read, so the tools the workspace advertises simply were not there.
   * The connection is per *session*, not per turn: it owns a spawned server
   * process, and connecting per turn leaked one process per turn.
   */
  protected async mcpTools(): Promise<McpTool[]> {
    if (!this.mcp) this.mcp = await openWorkspaceMcp({ cwd: this.cwd });
    return this.mcp.tools;
  }

  public async send(data: string): Promise<void> {
    if (this.isProcessing) return;

    const cfgError = this.configError();
    if (cfgError) {
      this.emit('error', new Error(cfgError));
      this.emit('idle');
      return;
    }

    this.isProcessing = true;
    const controller = new AbortController();
    this.abortController = controller;
    try {
      await this.runLoop(data, controller.signal);
    } catch (err: any) {
      // Any error surfacing after an intentional Stop is the abort, not a
      // failure — the SDKs throw APIUserAbortError (name !== 'AbortError'),
      // so check the signal rather than the error name.
      if (!controller.signal.aborted) {
        console.error(`${this.label} error:`, err);
        this.emit('error', err);
      }
    } finally {
      this.isProcessing = false;
      this.emit('idle');
    }
  }

  public stop(): void {
    this.abortController?.abort();
    this.abortController = null;
    // Fire and forget: stop() is synchronous by contract, and a close failure
    // has nothing to report to a caller that has already moved on. The
    // connection is dropped either way, so it cannot be reused.
    void this.closeMcp();
    this.emit('close', 0);
  }
}
