import { describe, it, expect } from 'vitest';
import { buildClaudeTurnArgs, isValidSessionUuid } from './session.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const STREAM_ARGS = [
  '--output-format', 'stream-json',
  '--verbose',
  '--include-partial-messages',
];

describe('buildClaudeTurnArgs', () => {
  it('defaults a first legacy turn to read-only plan mode', () => {
    expect(buildClaudeTurnArgs(true)).toEqual(['-p', ...STREAM_ARGS, '--permission-mode', 'plan']);
  });

  it('continues later legacy turns in plan mode', () => {
    expect(buildClaudeTurnArgs(false)).toEqual(['-c', '-p', ...STREAM_ARGS, '--permission-mode', 'plan']);
  });

  it('creates a new session with --session-id on the first turn', () => {
    expect(buildClaudeTurnArgs(true, { id: ID, resume: false })).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--session-id', ID,
    ]);
  });

  it('resumes the created session on later turns', () => {
    expect(buildClaudeTurnArgs(false, { id: ID, resume: false })).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', ID,
    ]);
  });

  it('resumes an existing session from the first turn', () => {
    expect(buildClaudeTurnArgs(true, { id: ID, resume: true })).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', ID,
    ]);
  });

  it('keeps resuming an existing session on later turns', () => {
    expect(buildClaudeTurnArgs(false, { id: ID, resume: true })).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'plan', '--resume', ID,
    ]);
  });

  it('maps workspace write to acceptEdits on new and resumed turns', () => {
    expect(buildClaudeTurnArgs(true, { id: ID, resume: false }, 'workspace-write')).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'acceptEdits', '--session-id', ID,
    ]);
    expect(buildClaudeTurnArgs(false, { id: ID, resume: false }, 'workspace-write')).toEqual([
      '-p', ...STREAM_ARGS, '--permission-mode', 'acceptEdits', '--resume', ID,
    ]);
  });
});

describe('isValidSessionUuid', () => {
  it('accepts a lowercase uuid', () => {
    expect(isValidSessionUuid(ID)).toBe(true);
  });

  it('accepts an uppercase uuid', () => {
    expect(isValidSessionUuid(ID.toUpperCase())).toBe(true);
  });

  it('rejects empty strings', () => {
    expect(isValidSessionUuid('')).toBe(false);
  });

  it('rejects shell metacharacters', () => {
    expect(isValidSessionUuid('x; rm -rf .')).toBe(false);
    expect(isValidSessionUuid(`${ID} && echo pwned`)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidSessionUuid(undefined)).toBe(false);
    expect(isValidSessionUuid(42)).toBe(false);
    expect(isValidSessionUuid({ id: ID })).toBe(false);
  });
});
