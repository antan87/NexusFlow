import { CliAdapterBase } from './CliAdapterBase.js';

export class AntigravityCliAdapter extends CliAdapterBase {
  protected readonly binary = 'agy';
  protected readonly label = 'agy CLI';

  // -p runs a single prompt (piped via stdin); -c continues the conversation
  // for turns after the first. agy has no resume-by-id, so no fallback.
  protected buildArgs(isFirstTurn: boolean): string[] {
    return isFirstTurn ? ['-p'] : ['-c', '-p'];
  }
}
