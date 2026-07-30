import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectAntigravityCliStatus,
  detectClaudeCliStatus,
  findExecutable,
} from './cliAvailability.js';

let home = '';

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-cliavail-'));
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** Writes a credential store with the given oauth block. */
async function writeCredentials(oauth: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.join(home, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({ claudeAiOauth: oauth }),
    'utf-8',
  );
}

/** The observed real-world shape: scopes present, every token empty. */
const HOLLOW = {
  accessToken: '',
  refreshToken: '',
  expiresAt: 0,
  scopes: ['user:inference'],
  subscriptionType: 'team',
};

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
    const status = detectClaudeCliStatus({ hasBinary: false, env: {}, homeDir: home });

    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/not found on PATH/);
  });

  it('is usable when an API key is set, regardless of the credential store', async () => {
    await writeCredentials(HOLLOW);

    const status = detectClaudeCliStatus({
      hasBinary: true,
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      homeDir: home,
    });

    expect(status.usable).toBe(true);
    expect(status.message).toBeUndefined();
  });

  it('reports unusable when the credential store has no tokens at all', async () => {
    // The real failure: an interactive claude works because its host injects
    // tokens, but a spawned `claude -p` finds nothing on disk to use.
    await writeCredentials(HOLLOW);

    const status = detectClaudeCliStatus({ hasBinary: true, env: {}, homeDir: home });

    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/not signed in|credentials are empty/i);
  });

  it('names the host-managed case when the app is providing auth', async () => {
    await writeCredentials(HOLLOW);

    const status = detectClaudeCliStatus({
      hasBinary: true,
      env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' },
      homeDir: home,
    });

    expect(status.usable).toBe(false);
    expect(status.message).toMatch(/holds your tokens in memory/i);
    // The message must be actionable, not just descriptive.
    expect(status.message).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('is usable with an access token present', async () => {
    await writeCredentials({ ...HOLLOW, accessToken: 'tok' });

    expect(detectClaudeCliStatus({ hasBinary: true, env: {}, homeDir: home }).usable).toBe(true);
  });

  it('is usable with only a refresh token, which can mint a new one', async () => {
    await writeCredentials({ ...HOLLOW, refreshToken: 'refresh' });

    expect(detectClaudeCliStatus({ hasBinary: true, env: {}, homeDir: home }).usable).toBe(true);
  });

  it('assumes usable when there is no credential file to judge', () => {
    // Conservative on purpose: an install that stores tokens elsewhere must not
    // be disabled just because this particular file is absent.
    const status = detectClaudeCliStatus({ hasBinary: true, env: {}, homeDir: home });

    expect(status.usable).toBe(true);
  });

  it('assumes usable when the credential file is malformed', async () => {
    await fs.mkdir(path.join(home, '.claude'), { recursive: true });
    await fs.writeFile(path.join(home, '.claude', '.credentials.json'), '{ not json', 'utf-8');

    expect(detectClaudeCliStatus({ hasBinary: true, env: {}, homeDir: home }).usable).toBe(true);
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
