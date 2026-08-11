import { CliAdapterBase } from './CliAdapterBase.js';
import { buildClaudeTurnArgs, isValidSessionUuid, type AgentSession } from './session.js';
import type { AgentExecutionProfile } from './ProviderRegistry.js';

export type ClaudeOutputEvent =
  | { type: 'session'; id: string }
  | { type: 'message'; text: string }
  | { type: 'complete'; text: string }
  | { type: 'system'; message: string }
  | { type: 'error'; message: string; source: 'protocol' | 'provider' };

const MAX_JSONL_RECORD_CHARS = 8 * 1024 * 1024;
const OVERSIZED_RECORD_MESSAGE =
  'Claude structured output exceeded the supported record size.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function claudeFailureMessage(value: Record<string, unknown>): string {
  const errors = Array.isArray(value.errors)
    ? value.errors.filter((error): error is string => typeof error === 'string' && error.trim().length > 0)
    : [];
  if (errors.length > 0) return errors.join('; ').slice(0, 2_000);
  return 'Claude could not complete the turn.';
}

/** Decode one complete record from Claude's supported stream-json output. */
export function decodeClaudeLine(line: string): ClaudeOutputEvent[] {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return [{
      type: 'error',
      message: 'Claude emitted malformed structured output.',
      source: 'protocol',
    }];
  }
  if (!isRecord(value)) {
    return [{
      type: 'error',
      message: 'Claude emitted an invalid structured record.',
      source: 'protocol',
    }];
  }

  if (value.type === 'system' && value.subtype === 'init') {
    return typeof value.session_id === 'string'
      ? [{ type: 'session', id: value.session_id }]
      : [{ type: 'error', message: 'Claude started without a valid session identity.', source: 'protocol' }];
  }

  if (value.type === 'system' && value.subtype === 'api_retry') {
    const attempt = Number.isInteger(value.attempt) ? value.attempt : null;
    const maxRetries = Number.isInteger(value.max_retries) ? value.max_retries : null;
    return [{
      type: 'system',
      message: attempt !== null && maxRetries !== null
        ? `Claude is retrying the request (attempt ${attempt} of ${maxRetries}).`
        : 'Claude is retrying the request.',
    }];
  }

  if (value.type === 'stream_event') {
    const event = isRecord(value.event) ? value.event : null;
    const delta = event && isRecord(event.delta) ? event.delta : null;
    if (
      event?.type === 'content_block_delta'
      && delta?.type === 'text_delta'
      && typeof delta.text === 'string'
      && delta.text
    ) {
      return [{ type: 'message', text: delta.text }];
    }
    return [];
  }

  if (value.type === 'result') {
    const events: ClaudeOutputEvent[] = [];
    if (typeof value.session_id === 'string') {
      events.push({ type: 'session', id: value.session_id });
    }
    if (value.subtype === 'success' && value.is_error !== true) {
      if (typeof value.result !== 'string') {
        events.push({
          type: 'error',
          message: 'Claude completed without a recognized text result.',
          source: 'protocol',
        });
      } else {
        events.push({ type: 'complete', text: value.result });
      }
    } else {
      events.push({ type: 'error', message: claudeFailureMessage(value), source: 'provider' });
    }
    return events;
  }

  return [];
}

/** Incrementally decode Claude's newline-delimited JSON output. */
export class ClaudeJsonlDecoder {
  private buffer = '';
  private failed = false;

  public constructor(private readonly maxRecordChars = MAX_JSONL_RECORD_CHARS) {}

  push(chunk: string): ClaudeOutputEvent[] {
    if (this.failed) return [];
    this.buffer += chunk;
    const events: ClaudeOutputEvent[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      if (newline > this.maxRecordChars) return this.failOversizedRecord();
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) events.push(...decodeClaudeLine(line));
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > this.maxRecordChars) return this.failOversizedRecord();
    return events;
  }

  finish(): ClaudeOutputEvent[] {
    if (this.failed) return [];
    if (this.buffer.length > this.maxRecordChars) return this.failOversizedRecord();
    const line = this.buffer.trim();
    this.buffer = '';
    return line ? decodeClaudeLine(line) : [];
  }

  private failOversizedRecord(): ClaudeOutputEvent[] {
    this.failed = true;
    this.buffer = '';
    return [{ type: 'error', message: OVERSIZED_RECORD_MESSAGE, source: 'protocol' }];
  }
}

export class ClaudeCliAdapter extends CliAdapterBase {
  protected readonly binary = 'claude';
  protected readonly label = 'claude CLI';
  // claude is an npm .cmd shim: needs a shell on Windows, and under a shell an
  // argv prompt would split on spaces, so the prompt goes over stdin.
  protected readonly useShell = true;
  protected readonly promptViaStdin = true;
  protected readonly advanceFirstTurnOnDispatch = false;

  private session: AgentSession | undefined;
  private decoder = new ClaudeJsonlDecoder();
  private sawTextDelta = false;
  private sawTurnOutcome = false;
  private acknowledgedThisTurn = false;
  private turnFinished = false;

  public async start(cwd: string, session?: AgentSession) {
    await super.start(cwd);
    this.session = session;
    this.decoder = new ClaudeJsonlDecoder();
    this.sawTextDelta = false;
    this.sawTurnOutcome = false;
    this.acknowledgedThisTurn = false;
    this.turnFinished = false;
  }

  protected buildArgs(
    isFirstTurn: boolean,
    _prompt: string,
    executionProfile: AgentExecutionProfile = 'review',
  ): string[] {
    this.decoder = new ClaudeJsonlDecoder();
    this.sawTextDelta = false;
    this.sawTurnOutcome = false;
    this.acknowledgedThisTurn = false;
    this.turnFinished = false;
    return buildClaudeTurnArgs(isFirstTurn, this.session, executionProfile);
  }

  protected handleStdout(text: string): boolean {
    return this.emitDecoded(this.decoder.push(text));
  }

  protected finishStdout(exitCode: number | null): boolean {
    const handled = this.emitDecoded(this.decoder.finish());
    if (!this.sawTurnOutcome && exitCode === 0) {
      this.sawTurnOutcome = true;
      this.failCurrentTurn(new Error(
        'Claude CLI ended without a recognized result. Update Claude Code and try again; its structured output may be incompatible with this NexusFlow version.',
      ));
      return true;
    }
    return handled;
  }

  private emitDecoded(events: ClaudeOutputEvent[]): boolean {
    let handledOutcome = false;
    for (const event of events) {
      if (this.turnFinished) break;

      if (event.type === 'session') {
        const expectedId = this.session?.id;
        const matchesExpectedId = expectedId === undefined
          || event.id.toLowerCase() === expectedId.toLowerCase();
        if (!isValidSessionUuid(event.id) || !matchesExpectedId) {
          const wasAcknowledged = this.acknowledgedThisTurn;
          this.turnFinished = true;
          this.sawTurnOutcome = true;
          handledOutcome = true;
          this.failCurrentTurn(new Error(
            wasAcknowledged
              ? 'Claude returned a conflicting session identity. The unexpected identity was rejected; the acknowledged session remains resumable.'
              : 'Claude returned an unexpected session identity. The turn was not marked resumable.',
          ), true);
          continue;
        }
        if (!this.acknowledgedThisTurn) {
          this.acknowledgedThisTurn = true;
          this.acknowledgeFirstTurn();
          // For client-assigned sessions, retain exactly the id NexusFlow
          // requested even if Claude canonicalizes its UUID casing.
          this.emit('session', expectedId ?? event.id);
        }
      } else if (event.type === 'message') {
        this.sawTextDelta = true;
        this.emit('data', event.text);
      } else if (event.type === 'system') {
        this.emit('system', event.message);
      } else if (event.type === 'complete') {
        this.turnFinished = true;
        this.sawTurnOutcome = true;
        handledOutcome = true;
        if (!this.acknowledgedThisTurn) {
          this.failCurrentTurn(new Error(
            'Claude completed without acknowledging the requested session. The turn was not marked resumable.',
          ), true);
        } else if (!this.sawTextDelta && event.text) {
          this.emit('data', event.text);
        }
      } else {
        this.turnFinished = true;
        this.sawTurnOutcome = true;
        handledOutcome = true;
        const message = event.source === 'protocol'
          ? `${event.message} ${this.acknowledgedThisTurn
            ? 'The acknowledged session remains resumable.'
            : 'The turn was not marked resumable.'}`
          : event.message;
        this.failCurrentTurn(new Error(message), true);
      }
    }
    return handledOutcome;
  }
}
