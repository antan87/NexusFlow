import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';

export class ClaudeCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
  private child: ChildProcess | null = null;
  // Note: We might need to handle session IDs for Claude if it doesn't auto-resume the folder's session,
  // but for now we just use the -p flag so it doesn't hang without a TTY.

  public async start(prompt: string | undefined, cwd: string) {
    this.cwd = cwd;
    if (prompt) {
      await this.send(prompt);
    }
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Pass -p to print and exit. This works without a TTY!
    const cliProcess = spawn('claude', ['-p', data], {
      cwd: this.cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: '0' } // Strip colors for easier parsing
    });
    this.child = cliProcess;

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
      if (code !== 0 && !producedOutput) {
        this.emit('error', new Error(`claude CLI exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
      }
      this.emit('data', '\n\n'); // Add separation between turns
    });
  }

  public stop() {
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
