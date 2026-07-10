import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';

export class ClaudeCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
  private isFirstTurn: boolean = true;
  private child: ChildProcess | null = null;
  private stopped: boolean = false;

  public async start(cwd: string) {
    this.cwd = cwd;
    this.isFirstTurn = true;
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // -p prints and exits, so it works without a TTY. -c continues the
    // conversation started by the first turn. The prompt goes over stdin:
    // with shell:true (needed to resolve claude.cmd on Windows) an argv
    // prompt would be split at spaces because spawn does not quote args.
    const args = this.isFirstTurn ? ['-p'] : ['-c', '-p'];
    this.isFirstTurn = false;
    this.stopped = false;

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
    });

    cliProcess.on('close', (code) => {
      this.isProcessing = false;
      this.child = null;
      // A non-zero exit after an intentional stop is expected, not an error.
      if (!this.stopped && code !== 0 && !producedOutput) {
        this.emit('error', new Error(`claude CLI exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
      }
      this.emit('data', '\n\n'); // Add separation between turns
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
