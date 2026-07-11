import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Shared lifecycle for CLI-backed agents (claude, agy). Each turn spawns the
 * binary once in print mode, pipes the prompt over stdin, streams stdout as
 * `data`, and emits `idle` when the turn ends. Subclasses supply the binary,
 * the per-turn args, and (optionally) a one-shot fallback used when the first
 * attempt of a turn fails with no output.
 *
 * The prompt always goes over stdin, never argv: `shell: true` is required to
 * resolve the `.cmd` shim on Windows, and under a shell an argv prompt would
 * be split on spaces (spawn does not quote args).
 */
export abstract class CliAdapterBase extends EventEmitter {
  protected cwd: string = '';
  protected isFirstTurn: boolean = true;
  private isProcessing: boolean = false;
  private stopped: boolean = false;
  private child: ChildProcess | null = null;

  /** Executable name, e.g. 'claude' or 'agy'. */
  protected abstract readonly binary: string;
  /** Short label for stderr/error diagnostics. */
  protected abstract readonly label: string;

  /** Args for one print-mode turn (prompt is piped via stdin, not argv). */
  protected abstract buildArgs(isFirstTurn: boolean): string[];

  /**
   * Args to retry with when the first attempt of a turn exits non-zero with no
   * output (e.g. resuming a purged session). Return null for no fallback.
   */
  protected fallbackArgs(): string[] | null {
    return null;
  }

  /** Message emitted as a `system` event when the fallback kicks in. */
  protected fallbackMessage: string = 'Retrying…';

  /** Called once per turn after it settles; `succeeded` if it produced output or exited 0. */
  protected onTurnComplete(_succeeded: boolean): void {}

  public async start(cwd: string): Promise<void> {
    this.cwd = cwd;
    this.isFirstTurn = true;
  }

  public async send(data: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopped = false;

    const args = this.buildArgs(this.isFirstTurn);
    this.isFirstTurn = false;
    this.runTurn(args, data, true);
  }

  private runTurn(args: string[], data: string, allowFallback: boolean) {
    const cliProcess = spawn(this.binary, args, {
      cwd: this.cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' } // Strip colors for easier parsing
    });
    this.child = cliProcess;
    cliProcess.stdin?.write(data);
    cliProcess.stdin?.end();

    let producedOutput = false;
    let stderrTail = '';

    cliProcess.stdout?.on('data', (chunk) => {
      producedOutput = true;
      this.emit('data', chunk.toString());
    });

    // CLIs print warnings and progress on stderr; only keep it for diagnostics.
    cliProcess.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-2000);
      console.warn(`[${this.label} stderr]`, text.trimEnd());
    });

    cliProcess.on('error', (err) => {
      this.isProcessing = false;
      this.child = null;
      this.emit('error', new Error(`Failed to start ${this.label}: ${err.message}`));
      this.emit('idle');
    });

    cliProcess.on('close', (code) => {
      this.child = null;

      if (!this.stopped && code !== 0 && !producedOutput && allowFallback) {
        const fb = this.fallbackArgs();
        if (fb) {
          this.emit('system', this.fallbackMessage);
          this.runTurn(fb, data, false);
          return;
        }
      }

      this.isProcessing = false;
      this.onTurnComplete(code === 0 || producedOutput);
      // A non-zero exit after an intentional stop is expected, not an error.
      if (!this.stopped && code !== 0 && !producedOutput) {
        this.emit('error', new Error(`${this.label} exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
      }
      // Turn separation is the GUI's concern — do not inject stray output here,
      // or a failed turn would spawn an empty bubble on the client.
      this.emit('idle');
    });
  }

  public stop(): void {
    this.stopped = true;
    killTree(this.child);
    this.child = null;
    this.isProcessing = false;
    this.emit('close', 0);
  }
}

// With shell:true on Windows, child.kill() only kills the shell wrapper,
// so take the whole tree down via taskkill.
export function killTree(child: ChildProcess | null) {
  if (!child || child.killed || child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}
