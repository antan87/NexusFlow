import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildClaudeTurnArgs, type AgentSession } from './session.js';

export class ClaudeCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
  private isFirstTurn: boolean = true;
  private child: ChildProcess | null = null;
  private stopped: boolean = false;
  private session: AgentSession | undefined;
  private sessionEstablished: boolean = false;

  public async start(cwd: string, session?: AgentSession) {
    this.cwd = cwd;
    this.isFirstTurn = true;
    this.session = session;
    this.sessionEstablished = false;
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this.stopped = false;

    const args = buildClaudeTurnArgs(this.isFirstTurn, this.session);
    this.isFirstTurn = false;

    // A --resume of a purged session fails on the very first turn; in that
    // case the id is free again, so one retry with --session-id recreates
    // the conversation under the same id.
    const allowResumeFallback = this.session?.resume === true && !this.sessionEstablished;
    this.runTurn(args, data, allowResumeFallback);
  }

  private runTurn(args: string[], data: string, allowResumeFallback: boolean) {
    // -p prints and exits, so it works without a TTY. The prompt goes over
    // stdin: with shell:true (needed to resolve claude.cmd on Windows) an
    // argv prompt would be split at spaces because spawn does not quote args.
    const cliProcess = spawn('claude', args, {
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
      console.warn('[claude-cli stderr]', text.trimEnd());
    });

    cliProcess.on('error', (err) => {
      this.isProcessing = false;
      this.child = null;
      this.emit('error', new Error(`Failed to start claude CLI: ${err.message}`));
      this.emit('idle');
    });

    cliProcess.on('close', (code) => {
      this.child = null;

      if (!this.stopped && code !== 0 && !producedOutput && allowResumeFallback) {
        this.emit('system', 'Could not resume the previous session — starting a new one.');
        this.runTurn(['-p', '--session-id', this.session!.id], data, false);
        return;
      }

      this.isProcessing = false;
      if (code === 0 || producedOutput) {
        this.sessionEstablished = true;
      }
      // A non-zero exit after an intentional stop is expected, not an error.
      if (!this.stopped && code !== 0 && !producedOutput) {
        this.emit('error', new Error(`claude CLI exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
      }
      this.emit('data', '\n\n'); // Add separation between turns
      this.emit('idle');
    });
  }

  public stop() {
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
