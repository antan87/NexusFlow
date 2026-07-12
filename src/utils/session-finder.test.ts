import { describe, it, expect } from 'vitest';
import { getClaudeProjectFolderName, isNoiseUserRecord, claudeRecordText } from './session-finder.js';

describe('getClaudeProjectFolderName', () => {
  it('matches Claude Code encoding for a Windows path (colon, backslash, dot, underscore)', () => {
    expect(getClaudeProjectFolderName('C:\\Users\\anton.patron\\Git\\workspaces\\improve_las'))
      .toBe('C--Users-anton-patron-Git-workspaces-improve-las');
  });

  it('maps each separator to its own dash without collapsing runs', () => {
    // `C:\` is three non-alphanumerics (colon + backslash) around the drive → `C--`.
    expect(getClaudeProjectFolderName('C:\\Git')).toBe('C--Git');
  });

  it('encodes a POSIX path', () => {
    expect(getClaudeProjectFolderName('/home/a.b/Git/my_repo'))
      .toBe('-home-a-b-Git-my-repo');
  });

  it('preserves case', () => {
    expect(getClaudeProjectFolderName('C:\\Git\\NexusFlow')).toBe('C--Git-NexusFlow');
  });
});

describe('isNoiseUserRecord', () => {
  const mk = (text: string, extra: any = {}) => ({ type: 'user', message: { content: text }, ...extra });

  it('flags meta records', () => {
    expect(isNoiseUserRecord({ isMeta: true, message: { content: 'anything' } }, 'anything')).toBe(true);
  });

  it('flags local-command caveats and slash-command wrappers', () => {
    expect(isNoiseUserRecord(mk('<local-command-caveat>Caveat: ...'), '<local-command-caveat>Caveat: ...')).toBe(true);
    expect(isNoiseUserRecord(mk('<command-name>/plan</command-name>'), '<command-name>/plan</command-name>')).toBe(true);
    expect(isNoiseUserRecord(mk('<local-command-stdout>done</local-command-stdout>'), '<local-command-stdout>done</local-command-stdout>')).toBe(true);
  });

  it('flags empty text and tool-result-only content', () => {
    expect(isNoiseUserRecord(mk(''), '')).toBe(true);
    expect(isNoiseUserRecord({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }, '')).toBe(true);
  });

  it('accepts a real typed prompt', () => {
    expect(isNoiseUserRecord(mk('Please refactor the auth module'), 'Please refactor the auth module')).toBe(false);
  });
});

describe('claudeRecordText', () => {
  it('reads string content', () => {
    expect(claudeRecordText({ message: { content: 'hello' } })).toBe('hello');
  });
  it('joins text blocks from array content', () => {
    expect(claudeRecordText({ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } })).toBe('a b');
  });
});
