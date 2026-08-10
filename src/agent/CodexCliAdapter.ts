import { CliAdapterBase } from './CliAdapterBase.js';
import { isValidSessionUuid, type AgentSession } from './session.js';
import { findExecutable } from './cliAvailability.js';

export type CodexOutputEvent =
  | { type: 'session'; id: string }
  | { type: 'message'; text: string }
  | { type: 'error'; message: string };

/** Incrementally decodes the JSONL stream produced by `codex exec --json`. */
export class CodexJsonlDecoder {
  private buffer = '';

  push(chunk: string): CodexOutputEvent[] {
    this.buffer += chunk;
    const events: CodexOutputEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) events.push(...decodeCodexLine(line));
      newline = this.buffer.indexOf('\n');
    }
    return events;
  }

  finish(): CodexOutputEvent[] {
    const line = this.buffer.trim();
    this.buffer = '';
    return line ? decodeCodexLine(line) : [];
  }
}

function failureMessage(value: any): string {
  return value?.error?.message
    ?? value?.message
    ?? value?.error
    ?? 'Codex could not complete the turn.';
}

/** Decode one complete Codex JSONL record into the small chat protocol. */
export function decodeCodexLine(line: string): CodexOutputEvent[] {
  let value: any;
  try {
    value = JSON.parse(line);
  } catch {
    return [];
  }

  if (value?.type === 'thread.started' && isValidSessionUuid(value.thread_id)) {
    return [{ type: 'session', id: value.thread_id }];
  }

  if (
    value?.type === 'item.completed'
    && value.item?.type === 'agent_message'
    && typeof value.item.text === 'string'
    && value.item.text
  ) {
    return [{ type: 'message', text: value.item.text }];
  }

  if (value?.type === 'turn.failed' || value?.type === 'error') {
    return [{ type: 'error', message: failureMessage(value) }];
  }

  return [];
}

const CODEX_RUN_CONFIG = [
  '-c', 'sandbox_mode="workspace-write"',
  '-c', 'approval_policy="never"',
];

/** Build one keyless Codex CLI turn. Prompts always arrive over stdin. */
export function buildCodexTurnArgs(sessionId?: string): string[] {
  if (sessionId) {
    return ['exec', 'resume', '--json', ...CODEX_RUN_CONFIG, sessionId, '-'];
  }
  return ['exec', '--json', '--color', 'never', ...CODEX_RUN_CONFIG, '-'];
}

export class CodexCliAdapter extends CliAdapterBase {
  protected readonly binary: string;
  protected readonly label = 'Codex CLI';
  protected readonly useShell: boolean;
  protected readonly promptViaStdin = true;

  private requestedSession: AgentSession | undefined;
  private activeSessionId: string | undefined;
  private decoder = new CodexJsonlDecoder();
  private sawTurnOutcome = false;

  constructor() {
    super();
    this.binary = findExecutable('codex') ?? 'codex';
    this.useShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(this.binary);
  }

  public async start(cwd: string, session?: AgentSession): Promise<void> {
    await super.start(cwd);
    this.requestedSession = session;
    this.activeSessionId = session?.resume ? session.id : undefined;
    this.decoder = new CodexJsonlDecoder();
    this.sawTurnOutcome = false;
  }

  protected buildArgs(isFirstTurn: boolean): string[] {
    this.decoder = new CodexJsonlDecoder();
    this.sawTurnOutcome = false;
    const sessionId = isFirstTurn
      ? (this.requestedSession?.resume ? this.requestedSession.id : undefined)
      : this.activeSessionId;
    return buildCodexTurnArgs(sessionId);
  }

  protected handleStdout(text: string): boolean {
    return this.emitDecoded(this.decoder.push(text));
  }

  protected finishStdout(exitCode: number | null): boolean {
    const handled = this.emitDecoded(this.decoder.finish());
    if (!this.sawTurnOutcome && exitCode === 0) {
      this.sawTurnOutcome = true;
      this.emit('error', new Error(
        'Codex CLI ended without a recognized response. Update Codex and try again; its JSON output may be incompatible with this NexusFlow version.',
      ));
      return true;
    }
    return handled;
  }

  private emitDecoded(events: CodexOutputEvent[]): boolean {
    let handled = false;
    for (const event of events) {
      if (event.type === 'session') {
        this.activeSessionId = event.id;
        this.emit('session', event.id);
      } else if (event.type === 'message') {
        handled = true;
        this.sawTurnOutcome = true;
        this.emit('data', event.text);
      } else {
        handled = true;
        this.sawTurnOutcome = true;
        this.emit('error', new Error(event.message));
      }
    }
    return handled;
  }
}
