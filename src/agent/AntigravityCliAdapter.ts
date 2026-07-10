import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { killTree } from './ClaudeCliAdapter.js';

export class AntigravityCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
  private isFirstTurn: boolean = true;
  private child: ChildProcess | null = null;

  public async start(cwd: string) {
    this.cwd = cwd;
    this.isFirstTurn = true;
  }

  public async send(data: string) {
    if (this.isProcessing) return;
    this.isProcessing = true;

    // Use -p to run a single prompt. If it's not the first turn, use -c to continue the conversation.
    const args = this.isFirstTurn ? ['-p', data] : ['-c', '-p', data];
    this.isFirstTurn = false;

    const cliProcess = spawn('agy', args, {
      cwd: this.cwd,
      env: { ...process.env, FORCE_COLOR: '0' }
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
      console.warn('[agy stderr]', text.trimEnd());
    });

    cliProcess.on('error', (err) => {
      this.isProcessing = false;
      this.child = null;
      this.emit('error', new Error(`Failed to start agy CLI: ${err.message}`));
    });

    cliProcess.on('close', (code) => {
      this.isProcessing = false;
      this.child = null;
      if (code !== 0 && !producedOutput) {
        this.emit('error', new Error(`agy CLI exited with code ${code}${stderrTail ? `: ${stderrTail.trim()}` : ''}`));
      }
      // We don't emit 'close' here because we want the frontend to keep the chat session open for the next prompt.
      // We just print a newline to separate turns visually.
      this.emit('data', '\n\n');
    });
  }

  public stop() {
    killTree(this.child);
    this.child = null;
    this.isProcessing = false;
    this.emit('close', 0);
  }
}
