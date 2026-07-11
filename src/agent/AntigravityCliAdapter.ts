import { CliAdapterBase } from './CliAdapterBase.js';

export class AntigravityCliAdapter extends CliAdapterBase {
  protected readonly binary = 'agy';
  protected readonly label = 'agy CLI';
  // agy is a native binary: reads the prompt from argv and needs no shell
  // (argv is passed literally, so multi-word prompts are safe without quoting).

  // -p runs a single prompt; -c continues the conversation for later turns.
  // agy has no resume-by-id, so no fallback.
  protected buildArgs(isFirstTurn: boolean, prompt: string): string[] {
    return isFirstTurn ? ['-p', prompt] : ['-c', '-p', prompt];
  }
}
