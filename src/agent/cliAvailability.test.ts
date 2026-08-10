import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectAntigravityCliStatus,
  detectClaudeCliStatus,
  detectCodexCliStatus,
  detectCopilotCliStatus,
  findExecutable,
} from './cliAvailability.js';

let home = '';

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-cliavail-'));
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('findExecutable', () => {
  it('finds a file on PATH', async () => {
    const name = process.platform === 'win32' ? 'thing.cmd' : 'thing';
    await fs.writeFile(path.join(home, name), '', 'utf-8');

    expect(findExecutable('thing', { PATH: home, PATHEXT: '.CMD' })).not.toBeNull();
  });

  it('returns null when the name is not on PATH', () => {
    expect(findExecutable('definitely-not-here', { PATH: home })).toBeNull();
  });

  it('returns null when PATH is empty', () => {
    expect(findExecutable('claude', {})).toBeNull();
  });
});

describe('detectClaudeCliStatus', () => {
  it('is unusable when the binary is missing, and says so', () => {
    const status = detectClaudeCliStatus({ hasBinary: false, env: {} });

    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/not found on PATH/);
    expect(status).toMatchObject({
      setupIssue: 'missing-cli',
      recoveryCommand: 'npm install -g @anthropic-ai/claude-code',
    });
  });

  it('is usable when an API key is set without inspecting auth status', () => {
    const status = detectClaudeCliStatus({
      hasBinary: true,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      authStatus: { exitCode: 1, stdout: '{not json', error: 'must not leak' },
    });

    expect(status).toEqual({ usable: true });
  });

  it.each([
    { ANTHROPIC_AUTH_TOKEN: 'gateway-token' },
    { CLAUDE_CODE_USE_BEDROCK: '1' },
    { CLAUDE_CODE_USE_VERTEX: '1' },
    { CLAUDE_CODE_USE_FOUNDRY: '1' },
  ])('accepts a declared provider-owned external auth mode', (externalEnv) => {
    expect(detectClaudeCliStatus({
      hasBinary: true,
      env: externalEnv,
      authStatus: { exitCode: 1, stdout: JSON.stringify({ loggedIn: false }) },
    })).toEqual({ usable: true });
  });

  it('accepts provider-owned subscription login without returning account metadata', () => {
    const status = detectClaudeCliStatus({
      hasBinary: true,
      env: {},
      authStatus: {
        exitCode: 0,
        stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'private@example.test' }),
      },
    });

    expect(status).toEqual({ usable: true });
  });

  it('maps a parsed signed-out response to keyless Claude login recovery', () => {
    const status = detectClaudeCliStatus({
      hasBinary: true,
      env: {},
      authStatus: { exitCode: 1, stdout: JSON.stringify({ loggedIn: false }) },
    });

    expect(status).toMatchObject({
      usable: false,
      setupIssue: 'signed-out',
      recoveryCommand: 'claude auth login',
      recoveryLabel: 'Copy sign-in command',
    });
    expect(status.message).toMatch(/no API key is required/i);
  });

  it.each([
    { name: 'malformed output', authStatus: { exitCode: 0, stdout: '{ not json' } },
    { name: 'unknown schema', authStatus: { exitCode: 0, stdout: '{"authenticated":true}' } },
    { name: 'timeout', authStatus: { exitCode: null, stdout: '', error: 'timed out at C:\\private\\path' } },
  ])('sanitizes a $name auth probe failure', ({ authStatus }) => {
    const status = detectClaudeCliStatus({ hasBinary: true, env: {}, authStatus });

    expect(status).toMatchObject({
      usable: false,
      setupIssue: 'probe-failed',
      recoveryCommand: 'claude auth status --json',
    });
    expect(status.message).not.toContain('private');
    expect(status).not.toHaveProperty('stdout');
  });
});

describe('detectAntigravityCliStatus', () => {
  it('is usable when agy is on PATH', () => {
    expect(detectAntigravityCliStatus({ hasBinary: true }).usable).toBe(true);
  });

  it('reports the missing binary otherwise', () => {
    const status = detectAntigravityCliStatus({ hasBinary: false });

    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/agy/);
  });
});

describe('detectCodexCliStatus', () => {
  it('is unusable when the binary is missing', () => {
    const status = detectCodexCliStatus({ hasBinary: false, env: {} });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/not found on PATH/i);
    expect(status).toMatchObject({
      setupIssue: 'missing-cli',
      recoveryCommand: 'npm install -g @openai/codex',
    });
  });

  it('accepts a saved ChatGPT or API login reported by the CLI', () => {
    const status = detectCodexCliStatus({
      hasBinary: true,
      env: {},
      loginStatus: { exitCode: 0 },
    });
    expect(status).toEqual({ usable: true });
  });

  it('directs signed-out users to ChatGPT login without demanding an API key', () => {
    const status = detectCodexCliStatus({
      hasBinary: true,
      env: {},
      loginStatus: { exitCode: 1 },
    });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/no API key is required/i);
    expect(status).toMatchObject({
      setupIssue: 'signed-out',
      recoveryCommand: 'codex login',
    });
  });

  it('reports a timed-out or failed auth probe actionably', () => {
    const status = detectCodexCliStatus({
      hasBinary: true,
      env: {},
      loginStatus: { exitCode: null, error: 'timed out' },
    });
    expect(status.usable).toBe(false);
    expect(status).toMatchObject({
      setupIssue: 'probe-failed',
      recoveryCommand: 'codex login status',
    });
    expect(status.message).not.toMatch(/timed out/);
  });
});

describe('detectCopilotCliStatus', () => {
  it('is unusable when the binary is missing', () => {
    const status = detectCopilotCliStatus({ hasBinary: false, env: {} });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/not found on PATH/i);
  });

  it('accepts an installation whose help advertises ACP', () => {
    expect(detectCopilotCliStatus({
      hasBinary: true,
      env: {},
      helpStatus: { exitCode: 0, output: '  --acp  Start Agent Client Protocol server' },
    })).toEqual({ usable: true });
  });

  it('asks users with an older CLI to update it', () => {
    const status = detectCopilotCliStatus({
      hasBinary: true,
      env: {},
      helpStatus: { exitCode: 0, output: 'Usage: copilot' },
    });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/does not expose ACP/i);
  });

  it('reports a failed or timed-out capability probe', () => {
    const status = detectCopilotCliStatus({
      hasBinary: true,
      env: {},
      helpStatus: { exitCode: null, error: 'timed out' },
    });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/timed out/);
  });

  it('rejects an overriding classic PAT that Copilot cannot use', () => {
    const status = detectCopilotCliStatus({
      hasBinary: true,
      env: { COPILOT_GITHUB_TOKEN: 'ghp_classic' },
      helpStatus: { exitCode: 0, output: '--acp' },
    });
    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/classic/i);
  });
});
