import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Shared lifecycle for CLI-backed agents (claude, codex, agy). Each turn spawns the
 * binary once in print mode, streams stdout as `data`, and emits `idle` when
 * the turn ends. Subclasses supply the binary, the per-turn args, how the
 * prompt is delivered.
 *
 * Prompt delivery differs per CLI: `claude` is an npm `.cmd` shim that needs
 * `shell: true` on Windows, and under a shell an argv prompt would be split on
 * spaces, so its prompt goes over stdin. `agy` is a native binary that reads
 * the prompt from argv and needs no shell (argv is passed literally, so no
 * quoting hazard).
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
  /** Spawn through a shell (needed to resolve a `.cmd` shim on Windows). */
  protected readonly useShell: boolean = false;
  /** Pipe the prompt to stdin (true) vs. include it in argv via buildArgs (false). */
  protected readonly promptViaStdin: boolean = false;

  /** Args for one print-mode turn. Receives the prompt so argv-mode CLIs can
   *  include it; stdin-mode CLIs ignore it. */
  protected abstract buildArgs(isFirstTurn: boolean, prompt: string): string[];

  /**
   * Consume one stdout chunk. Structured-output adapters override this to
   * decode provider events and emit only user-facing text. The return value
   * means the chunk was handled as a meaningful result (including a structured
   * provider error), so a later non-zero exit should not add a duplicate error.
   */
  protected handleStdout(text: string): boolean {
    if (!text) return false;
    this.emit('data', text);
    return true;
  }

  /** Flush a final unterminated structured-output record, if any. */
  protected finishStdout(_exitCode: number | null): boolean {
    return false;
  }

  public async start(cwd: string): Promise<void> {
    this.cwd = cwd;
    this.isFirstTurn = true;
  }

  public async send(data: string): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopped = false;

    const args = this.buildArgs(this.isFirstTurn, data);
    this.isFirstTurn = false;
    this.runTurn(args, data);
  }

  /** Kept as a seam so lifecycle tests can exercise process failures without a real CLI. */
  protected spawnProcess(args: string[]): ChildProcess {
    return spawn(this.binary, args, {
      cwd: this.cwd,
      shell: this.useShell,
      env: { ...process.env, FORCE_COLOR: '0' } // Strip colors for easier parsing
    });
  }

  private runTurn(args: string[], data: string) {
    const cliProcess = this.spawnProcess(args);
    this.child = cliProcess;
    if (this.promptViaStdin) {
      cliProcess.stdin?.write(data);
      cliProcess.stdin?.end();
    }

    let producedOutput = false;
    let stderrTail = '';

    cliProcess.stdout?.on('data', (chunk) => {
      producedOutput = this.handleStdout(chunk.toString()) || producedOutput;
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
      producedOutput = this.finishStdout(code) || producedOutput;

      this.isProcessing = false;
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
