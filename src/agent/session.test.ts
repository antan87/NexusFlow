import { describe, it, expect } from 'vitest';
import { buildClaudeTurnArgs, isValidSessionUuid } from './session.js';

const ID = '123e4567-e89b-42d3-a456-426614174000';

describe('buildClaudeTurnArgs', () => {
  it('uses plain -p on the first legacy turn', () => {
    expect(buildClaudeTurnArgs(true)).toEqual(['-p']);
  });

  it('continues with -c on later legacy turns', () => {
    expect(buildClaudeTurnArgs(false)).toEqual(['-c', '-p']);
  });

  it('creates a new session with --session-id on the first turn', () => {
    expect(buildClaudeTurnArgs(true, { id: ID, resume: false })).toEqual(['-p', '--session-id', ID]);
  });

  it('resumes the created session on later turns', () => {
    expect(buildClaudeTurnArgs(false, { id: ID, resume: false })).toEqual(['-p', '--resume', ID]);
  });

  it('resumes an existing session from the first turn', () => {
    expect(buildClaudeTurnArgs(true, { id: ID, resume: true })).toEqual(['-p', '--resume', ID]);
  });

  it('keeps resuming an existing session on later turns', () => {
    expect(buildClaudeTurnArgs(false, { id: ID, resume: true })).toEqual(['-p', '--resume', ID]);
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
