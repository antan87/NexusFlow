import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export class AntigravityCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
  private isFirstTurn: boolean = true;

  public async start(prompt: string | undefined, cwd: string) {
    this.cwd = cwd;
    this.isFirstTurn = true;
    if (prompt) {
      await this.send(prompt);
    }
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

    cliProcess.stdout?.on('data', (chunk) => {
      this.emit('data', chunk.toString());
    });

    cliProcess.stderr?.on('data', (chunk) => {
      this.emit('error', new Error(chunk.toString()));
    });

    cliProcess.on('close', (code) => {
      this.isProcessing = false;
      // We don't emit 'close' here because we want the frontend to keep the chat session open for the next prompt.
      // We just print a newline to separate turns visually.
      this.emit('data', '\n\n');
    });
  }

  public stop() {
    this.emit('close', 0);
  }
}
