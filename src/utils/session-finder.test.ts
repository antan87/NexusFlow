import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { canOpenCodexSessionInWorkspace, canTransferClaudeSessionInWorkspace, getClaudeProjectFolderName, isCanonicalPathWithin, isNoiseUserRecord, claudeRecordText, codexMessageText, codexSessionId, isCodexSessionId, isInjectedContextText, getSessionTranscript } from './session-finder.js';

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

describe('codexMessageText', () => {
  it('joins the text parts of a response_item message payload', () => {
    expect(codexMessageText({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello ' }, { type: 'input_text', text: 'world' }] }))
      .toBe('hello world');
  });
  it('handles string content', () => {
    expect(codexMessageText({ content: 'plain' })).toBe('plain');
  });
});

describe('codexSessionId', () => {
  it('uses session_meta.payload.id instead of the timestamped rollout filename', () => {
    expect(codexSessionId({
      type: 'session_meta',
      payload: { id: '0199a213-81c0-7800-8aa1-bbab2a035a53', cwd: '/repo' },
    })).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
  });

  it('ignores unrelated or empty records', () => {
    expect(codexSessionId({ type: 'turn_context', payload: { id: 'wrong' } })).toBeNull();
    expect(codexSessionId({ type: 'session_meta', payload: { id: '' } })).toBeNull();
    expect(codexSessionId({ type: 'session_meta', payload: { id: 'thread-name' } })).toBeNull();
  });
});

describe('isCodexSessionId', () => {
  it('accepts only complete UUIDs', () => {
    expect(isCodexSessionId('0199a213-81c0-7800-8aa1-bbab2a035a53')).toBe(true);
    expect(isCodexSessionId('53')).toBe(false);
    expect(isCodexSessionId('0199a213-81c0-7800-8aa1-bbab2a035a53; whoami')).toBe(false);
  });
});

describe('Codex Desktop workspace authorization', () => {
  const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  let codexHome = '';
  let workspacePath = '';
  let previousCodexHome: string | undefined;

  beforeEach(async () => {
    previousCodexHome = process.env.CODEX_HOME;
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-codex-authorization-'));
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workspace-'));
    process.env.CODEX_HOME = codexHome;
    await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  });

  afterEach(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(codexHome, { recursive: true, force: true });
    await fs.rm(workspacePath, { recursive: true, force: true });
  });

  it('requires a matching session_meta cwd inside the canonical workspace', async () => {
    await fs.writeFile(
      path.join(codexHome, 'sessions', 'rollout.jsonl'),
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId, cwd: workspacePath } }),
    );

    await expect(canOpenCodexSessionInWorkspace(workspacePath, [], sessionId)).resolves.toBe(true);
  });

  it('rejects a fuzzy transcript mention when session_meta has no cwd', async () => {
    await fs.writeFile(
      path.join(codexHome, 'sessions', 'old-rollout.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
        JSON.stringify({
          type: 'response_item',
          payload: { type: 'message', role: 'user', content: workspacePath },
        }),
      ].join('\n'),
    );

    await expect(canOpenCodexSessionInWorkspace(workspacePath, [], sessionId)).resolves.toBe(false);
  });

  it('keeps POSIX path authorization case-sensitive', () => {
    expect(isCanonicalPathWithin('/workspaces/NexusFlow', '/workspaces/nexusflow/repo', 'linux'))
      .toBe(false);
  });

  it('matches Windows canonical paths case-insensitively', () => {
    expect(isCanonicalPathWithin('C:\\Workspaces\\NexusFlow', 'c:\\workspaces\\nexusflow\\repo', 'win32'))
      .toBe(true);
  });
});

describe('Claude Desktop transfer authorization', () => {
  const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  let claudeConfigDir = '';
  let workspacePath = '';
  let outsidePath = '';
  let previousClaudeConfigDir: string | undefined;

  beforeEach(async () => {
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    claudeConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-claude-authorization-'));
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workspace-'));
    outsidePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-outside-'));
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    await fs.mkdir(
      path.join(claudeConfigDir, 'projects', getClaudeProjectFolderName(workspacePath)),
      { recursive: true },
    );
  });

  afterEach(async () => {
    if (previousClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    await fs.rm(claudeConfigDir, { recursive: true, force: true });
    await fs.rm(workspacePath, { recursive: true, force: true });
    await fs.rm(outsidePath, { recursive: true, force: true });
  });

  it('requires the exact UUID and a canonical recorded cwd in the workspace', async () => {
    await fs.writeFile(
      path.join(claudeConfigDir, 'projects', getClaudeProjectFolderName(workspacePath), `${sessionId}.jsonl`),
      JSON.stringify({ type: 'user', sessionId, cwd: workspacePath }),
    );

    await expect(canTransferClaudeSessionInWorkspace(workspacePath, [], sessionId)).resolves.toBe(true);
  });

  it('rejects a lossy-folder collision whose recorded cwd is outside the workspace', async () => {
    await fs.writeFile(
      path.join(claudeConfigDir, 'projects', getClaudeProjectFolderName(workspacePath), `${sessionId}.jsonl`),
      JSON.stringify({ type: 'user', sessionId, cwd: outsidePath }),
    );

    await expect(canTransferClaudeSessionInWorkspace(workspacePath, [], sessionId)).resolves.toBe(false);
    await expect(canTransferClaudeSessionInWorkspace(workspacePath, [], `${sessionId}; whoami`)).resolves.toBe(false);
  });
});

describe('Codex transcript identity', () => {
  const targetId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  const otherId = '0199a213-81c0-7800-8aa1-bbab2a035a54';
  let codexHome = '';
  let previousCodexHome: string | undefined;

  beforeEach(async () => {
    previousCodexHome = process.env.CODEX_HOME;
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-codex-sessions-'));
    process.env.CODEX_HOME = codexHome;
    await fs.mkdir(path.join(codexHome, 'sessions'), { recursive: true });
  });

  afterEach(async () => {
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await fs.rm(codexHome, { recursive: true, force: true });
  });

  it('verifies session_meta even when another rollout filename has the requested suffix', async () => {
    const sessionsDir = path.join(codexHome, 'sessions');
    await fs.writeFile(
      path.join(sessionsDir, `rollout-timestamp-${targetId}.jsonl`),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: otherId } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'wrong' } }),
      ].join('\n'),
    );
    await fs.writeFile(
      path.join(sessionsDir, 'renamed-rollout.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: targetId } }),
        JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'correct' } }),
      ].join('\n'),
    );

    await expect(getSessionTranscript('codex', targetId)).resolves.toEqual([
      { role: 'assistant', content: 'correct', timestamp: undefined },
    ]);
  });

  it('rejects partial or attacker-controlled ids before scanning files', async () => {
    await expect(getSessionTranscript('codex', '53')).rejects.toThrow(/Invalid Codex session id/);
  });
});

describe('isInjectedContextText', () => {
  it('flags Codex and Copilot injected context', () => {
    expect(isInjectedContextText('<environment_context>\n  <cwd>...')).toBe(true);
    expect(isInjectedContextText('<user_instructions>do X</user_instructions>')).toBe(true);
    expect(isInjectedContextText('<system_reminder> Custom instructions')).toBe(true);
  });
  it('does not flag a real prompt', () => {
    expect(isInjectedContextText('Refactor the auth module')).toBe(false);
  });
});
