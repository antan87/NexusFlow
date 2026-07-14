import { CliAdapterBase } from './CliAdapterBase.js';
import { buildClaudeTurnArgs, type AgentSession } from './session.js';

export class ClaudeCliAdapter extends CliAdapterBase {
  protected readonly binary = 'claude';
  protected readonly label = 'claude CLI';
  // claude is an npm .cmd shim: needs a shell on Windows, and under a shell an
  // argv prompt would split on spaces, so the prompt goes over stdin.
  protected readonly useShell = true;
  protected readonly promptViaStdin = true;
  protected fallbackMessage = 'Could not resume the previous session — starting a new one.';

  private session: AgentSession | undefined;
  private sessionEstablished: boolean = false;

  public async start(cwd: string, session?: AgentSession) {
    await super.start(cwd);
    this.session = session;
    this.sessionEstablished = false;
  }

  protected buildArgs(isFirstTurn: boolean): string[] {
    return buildClaudeTurnArgs(isFirstTurn, this.session);
  }

  // A --resume of a purged session fails on the very first turn; the id is
  // then free, so one retry with --session-id recreates it under the same id.
  protected fallbackArgs(): string[] | null {
    if (this.session?.resume === true && !this.sessionEstablished) {
      return ['-p', '--session-id', this.session.id];
    }
    return null;
  }

  protected onTurnComplete(succeeded: boolean): void {
    if (succeeded) this.sessionEstablished = true;
  }
}
