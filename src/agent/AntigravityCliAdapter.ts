import { CliAdapterBase } from './CliAdapterBase.js';
import { type AgentSession, isValidSessionUuid } from './session.js';
import type { AgentExecutionProfile } from './ProviderRegistry.js';

export function buildAntigravityTurnArgs(
  isFirstTurn: boolean,
  prompt: string,
  session?: AgentSession,
  executionProfile?: AgentExecutionProfile,
): string[] {
  const args: string[] = [];

  if (session?.id) {
    args.push('--conversation', session.id);
  } else if (!isFirstTurn) {
    args.push('-c');
  }

  if (executionProfile === 'workspace-write') {
    args.push('--mode', 'accept-edits');
  }

  args.push('-p', prompt);
  return args;
}

export class AntigravityCliAdapter extends CliAdapterBase {
  protected readonly binary = 'agy';
  protected readonly label = 'agy CLI';
  // agy is a native binary: reads the prompt from argv and needs no shell
  // (argv is passed literally, so multi-word prompts are safe without quoting).

  private session?: AgentSession;
  private sessionEmitted = false;

  public async start(cwd: string, session?: AgentSession): Promise<void> {
    await super.start(cwd);
    this.session = session;
    this.sessionEmitted = false;
  }

  public override async send(data: string, executionProfile?: AgentExecutionProfile): Promise<void> {
    if (this.session?.id && !this.sessionEmitted && isValidSessionUuid(this.session.id)) {
      this.sessionEmitted = true;
      this.emit('session', this.session.id);
    }
    return super.send(data, executionProfile);
  }

  protected buildArgs(
    isFirstTurn: boolean,
    prompt: string,
    executionProfile?: AgentExecutionProfile,
  ): string[] {
    return buildAntigravityTurnArgs(isFirstTurn, prompt, this.session, executionProfile);
  }
}

