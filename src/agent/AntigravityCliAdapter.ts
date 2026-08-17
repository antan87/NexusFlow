import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CliAdapterBase } from './CliAdapterBase.js';
import { isValidSessionUuid, type AgentSession } from './session.js';
import type { AgentExecutionProfile } from './ProviderRegistry.js';

export function getAntigravityHistoryPath(): string {
  const agDir = process.env.ANTIGRAVITY_HOME || path.join(os.homedir(), '.gemini', 'antigravity-cli');
  return path.join(agDir, 'history.jsonl');
}

/**
 * Searches Antigravity's history.jsonl for the newest session matching cwd and started at or after turnStartTime.
 */
export function findAntigravitySessionIdForWorkspace(
  cwd: string,
  sinceEpochMs: number,
  historyPath = getAntigravityHistoryPath(),
): string | null {
  try {
    if (!fs.existsSync(historyPath)) return null;
    const content = fs.readFileSync(historyPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const normalize = (p: string) => path.normalize(p).toLowerCase();
    const normCwd = normalize(cwd);

    // Scan backwards from newest entry
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (!entry.conversationId || !isValidSessionUuid(entry.conversationId)) continue;
        if (!entry.workspace) continue;
        const normEntryWs = normalize(entry.workspace);
        const matchesWs =
          normEntryWs === normCwd ||
          normEntryWs.startsWith(normCwd + path.sep) ||
          normCwd.startsWith(normEntryWs + path.sep);
        if (!matchesWs) continue;

        const timestamp = typeof entry.timestamp === 'number' ? entry.timestamp : new Date(entry.timestamp).getTime();
        if (!Number.isNaN(timestamp) && timestamp >= sinceEpochMs - 10000) {
          return entry.conversationId;
        }
      } catch {}
    }
  } catch {}
  return null;
}

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
  private turnStartTime: number = 0;

  public async start(cwd: string, session?: AgentSession): Promise<void> {
    this.session = session;
    this.turnStartTime = 0;
    await super.start(cwd);
  }

  public override async send(data: string, executionProfile?: AgentExecutionProfile): Promise<void> {
    this.turnStartTime = Date.now();
    return super.send(data, executionProfile);
  }

  protected override finishStdout(_exitCode: number | null): boolean {
    if (this.session?.id && this.session.resume) {
      return false;
    }

    const capturedId = findAntigravitySessionIdForWorkspace(this.cwd, this.turnStartTime);
    if (capturedId) {
      this.session = { id: capturedId, resume: true };
      this.emit('session', capturedId);
    }
    return false;
  }

  protected buildArgs(
    isFirstTurn: boolean,
    prompt: string,
    executionProfile?: AgentExecutionProfile,
  ): string[] {
    return buildAntigravityTurnArgs(isFirstTurn, prompt, this.session, executionProfile);
  }
}
