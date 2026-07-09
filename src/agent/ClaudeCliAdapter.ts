import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';

export class ClaudeCliAdapter extends EventEmitter {
  private isProcessing: boolean = false;
  private cwd: string = '';
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

    cliProcess.stdout?.on('data', (chunk) => {
      this.emit('data', chunk.toString());
    });

    cliProcess.stderr?.on('data', (chunk) => {
      this.emit('error', new Error(chunk.toString()));
    });

    cliProcess.on('close', (code) => {
      this.isProcessing = false;
      this.emit('data', '\n\n'); // Add separation between turns
    });
  }

  public stop() {
    this.emit('close', 0);
  }
}
