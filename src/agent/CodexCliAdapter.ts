import { CliAdapterBase } from './CliAdapterBase.js';
import { isValidSessionUuid, type AgentSession } from './session.js';
import { findExecutable } from './cliAvailability.js';
import type { AgentExecutionProfile } from './ProviderRegistry.js';

export type CodexOutputEvent =
  | { type: 'session'; id: string }
  | { type: 'message'; text: string }
  | { type: 'complete' }
  | { type: 'error'; message: string; source: 'protocol' | 'provider' };

const MAX_JSONL_RECORD_CHARS = 8 * 1024 * 1024;
const OVERSIZED_RECORD_MESSAGE = 'Codex structured output exceeded the supported record size.';

/** Incrementally decodes the JSONL stream produced by `codex exec --json`. */
export class CodexJsonlDecoder {
  private buffer = '';
  private failed = false;

  public constructor(private readonly maxRecordChars = MAX_JSONL_RECORD_CHARS) {}

  push(chunk: string): CodexOutputEvent[] {
    if (this.failed) return [];
    this.buffer += chunk;
    const events: CodexOutputEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      if (newline > this.maxRecordChars) return this.failOversizedRecord();
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) events.push(...decodeCodexLine(line));
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxRecordChars) return this.failOversizedRecord();
    return events;
  }

  finish(): CodexOutputEvent[] {
    if (this.failed) return [];
    if (this.buffer.length > this.maxRecordChars) return this.failOversizedRecord();
    const line = this.buffer.trim();
    this.buffer = '';
    return line ? decodeCodexLine(line) : [];
  }

  private failOversizedRecord(): CodexOutputEvent[] {
    this.failed = true;
    this.buffer = '';
    return [{ type: 'error', message: OVERSIZED_RECORD_MESSAGE, source: 'protocol' }];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failureMessage(value: Record<string, unknown>): string {
  const error = isRecord(value.error) ? value.error : null;
  const candidates = [error?.message, value.message, typeof value.error === 'string' ? value.error : null];
  const message = candidates.find((candidate): candidate is string => (
    typeof candidate === 'string' && candidate.trim().length > 0
  ));
  return message?.trim().slice(0, 2_000) ?? 'Codex could not complete the turn.';
}

/** Decode one complete Codex JSONL record into the small chat protocol. */
export function decodeCodexLine(line: string): CodexOutputEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [{ type: 'error', message: 'Codex emitted malformed structured output.', source: 'protocol' }];
  }
  if (!isRecord(value)) {
    return [{ type: 'error', message: 'Codex emitted an invalid structured record.', source: 'protocol' }];
  }

  if (value.type === 'thread.started') {
    return typeof value.thread_id === 'string' && isValidSessionUuid(value.thread_id)
      ? [{ type: 'session', id: value.thread_id }]
      : [{ type: 'error', message: 'Codex started without a valid thread identity.', source: 'protocol' }];
  }

  if (
    value.type === 'item.completed'
    && isRecord(value.item)
    && value.item.type === 'agent_message'
    && typeof value.item.text === 'string'
    && value.item.text
  ) {
    return [{ type: 'message', text: value.item.text }];
  }

  if (value.type === 'turn.completed') {
    return [{ type: 'complete' }];
  }

  if (value.type === 'turn.failed' || value.type === 'error') {
    return [{ type: 'error', message: failureMessage(value), source: 'provider' }];
  }

  return [];
}

function codexRunConfig(executionProfile: AgentExecutionProfile): string[] {
  return [
    '-c', `sandbox_mode="${executionProfile === 'workspace-write' ? 'workspace-write' : 'read-only'}"`,
    '-c', 'approval_policy="never"',
    ...(executionProfile === 'workspace-write'
      ? ['-c', 'sandbox_workspace_write.network_access=false']
      : []),
  ];
}

/** Build one keyless Codex CLI turn. Prompts always arrive over stdin. */
export function buildCodexTurnArgs(
  sessionId?: string,
  executionProfile: AgentExecutionProfile = 'review',
): string[] {
  const runConfig = codexRunConfig(executionProfile);
  if (sessionId) {
    return ['exec', 'resume', '--json', ...runConfig, sessionId, '-'];
  }
  return ['exec', '--json', '--color', 'never', ...runConfig, '-'];
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
  private sawAssistantMessage = false;
  private acknowledgedThisTurn = false;
  private turnFinished = false;

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
    this.sawAssistantMessage = false;
    this.acknowledgedThisTurn = false;
    this.turnFinished = false;
  }

  protected buildArgs(
    isFirstTurn: boolean,
    _prompt: string,
    executionProfile: AgentExecutionProfile = 'review',
  ): string[] {
    this.decoder = new CodexJsonlDecoder();
    this.sawTurnOutcome = false;
    this.sawAssistantMessage = false;
    this.acknowledgedThisTurn = false;
    this.turnFinished = false;
    const sessionId = isFirstTurn
      ? (this.requestedSession?.resume ? this.requestedSession.id : undefined)
      : this.activeSessionId;
    return buildCodexTurnArgs(sessionId, executionProfile);
  }

  protected handleStdout(text: string): boolean {
    return this.emitDecoded(this.decoder.push(text));
  }

  protected finishStdout(exitCode: number | null): boolean {
    const handled = this.emitDecoded(this.decoder.finish());
    if (!this.sawTurnOutcome && this.sawAssistantMessage) {
      this.sawTurnOutcome = true;
      this.failCurrentTurn(new Error(
        'Codex CLI ended before confirming turn completion. The active session remains resumable.',
      ));
      return true;
    }
    if (!this.sawTurnOutcome && exitCode === 0) {
      this.sawTurnOutcome = true;
      this.failCurrentTurn(new Error(
        'Codex CLI ended without a recognized response. Update Codex and try again; its JSON output may be incompatible with this NexusFlow version.',
      ));
      return true;
    }
    return handled;
  }

  private emitDecoded(events: CodexOutputEvent[]): boolean {
    let handled = false;
    for (const event of events) {
      if (this.turnFinished) break;

      if (event.type === 'session') {
        const expectedId = this.activeSessionId;
        if (expectedId && event.id.toLowerCase() !== expectedId.toLowerCase()) {
          this.turnFinished = true;
          this.sawTurnOutcome = true;
          handled = true;
          this.failCurrentTurn(new Error(
            'Codex returned a conflicting thread identity. The unexpected identity was rejected; the active session remains resumable.',
          ), true);
          continue;
        }
        if (!this.acknowledgedThisTurn) {
          const acknowledgedId = expectedId ?? event.id;
          this.activeSessionId = acknowledgedId;
          this.acknowledgedThisTurn = true;
          this.emit('session', acknowledgedId);
        }
      } else if (event.type === 'message') {
        handled = true;
        if (!this.acknowledgedThisTurn) {
          this.turnFinished = true;
          this.sawTurnOutcome = true;
          this.failCurrentTurn(new Error(
            `Codex completed output without acknowledging a thread identity. ${this.resumabilitySuffix()}`,
          ), true);
        } else {
          this.sawAssistantMessage = true;
          this.emit('data', event.text);
        }
      } else if (event.type === 'complete') {
        handled = true;
        this.sawTurnOutcome = true;
        this.turnFinished = true;
        if (!this.acknowledgedThisTurn) {
          this.failCurrentTurn(new Error(
            `Codex completed without acknowledging a thread identity. ${this.resumabilitySuffix()}`,
          ), true);
        } else if (!this.sawAssistantMessage) {
          this.failCurrentTurn(new Error(
            'Codex completed without a recognizable assistant response. The active session remains resumable.',
          ), true);
        }
      } else {
        handled = true;
        this.sawTurnOutcome = true;
        this.turnFinished = true;
        const message = event.source === 'protocol'
          ? `${event.message} ${this.resumabilitySuffix()}`
          : event.message;
        this.failCurrentTurn(new Error(message), true);
      }
    }
    return handled;
  }

  private resumabilitySuffix(): string {
    return this.activeSessionId
      ? 'The active session remains resumable.'
      : 'The turn was not marked resumable.';
  }
}
