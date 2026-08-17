import { CliAdapterBase } from './CliAdapterBase.js';
import type { AgentSession } from './session.js';
import type { AgentExecutionProfile } from './ProviderRegistry.js';

export function buildAntigravityTurnArgs(
  isFirstTurn: boolean,
  prompt: string,
  session?: AgentSession,
  executionProfile: AgentExecutionProfile = 'review',
): string[] {
  const args: string[] = [];

  // --conversation only loads an existing provider-owned conversation. It is
  // not a caller-assigned session id, so a new chat must let agy create one.
  if (session?.resume) {
    args.push('--conversation', session.id);
  } else if (!isFirstTurn) {
    args.push('-c');
  }

  // Never inherit agy's persisted global mode. The profile selected for this
  // turn is the authority for whether the harness may edit the workspace.
  args.push('--mode', executionProfile === 'workspace-write' ? 'accept-edits' : 'plan');

  args.push('-p', prompt);
  return args;
}

export class AntigravityCliAdapter extends CliAdapterBase {
  protected readonly binary = 'agy';
  protected readonly label = 'agy CLI';
  // agy is a native binary: reads the prompt from argv and needs no shell
  // (argv is passed literally, so multi-word prompts are safe without quoting).

  private session?: AgentSession;
  public async start(cwd: string, session?: AgentSession): Promise<void> {
    this.session = session;
    await super.start(cwd);
  }

  protected buildArgs(
    isFirstTurn: boolean,
    prompt: string,
    executionProfile?: AgentExecutionProfile,
  ): string[] {
    return buildAntigravityTurnArgs(isFirstTurn, prompt, this.session, executionProfile);
  }
}
