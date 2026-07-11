import { EventEmitter } from 'node:events';

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

  public async start(cwd: string): Promise<void> {
    this.cwd = cwd;
    this.resetHistory();
  }

  public async send(data: string): Promise<void> {
    if (this.isProcessing) return;
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
    this.emit('close', 0);
  }
}
