import { CliAdapterBase } from './CliAdapterBase.js';
import { buildClaudeTurnArgs, type AgentSession } from './session.js';

export class ClaudeCliAdapter extends CliAdapterBase {
  protected readonly binary = 'claude';
  protected readonly label = 'claude CLI';
  // claude is an npm .cmd shim: needs a shell on Windows, and under a shell an
  // argv prompt would split on spaces, so the prompt goes over stdin.
  protected readonly useShell = true;
  protected readonly promptViaStdin = true;

  private session: AgentSession | undefined;

  public async start(cwd: string, session?: AgentSession) {
    await super.start(cwd);
    this.session = session;
  }

  protected buildArgs(isFirstTurn: boolean): string[] {
    return buildClaudeTurnArgs(isFirstTurn, this.session);
  }
}
