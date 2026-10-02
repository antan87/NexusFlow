import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { INPUT_REQUEST_DISPLAY_LIMIT, INPUT_REQUEST_MAX_AGE_MS, latestInputRequest } from './attention.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const target of cleanup.splice(0)) await fs.rm(target, { recursive: true, force: true }).catch(() => {});
});

const NOW = Date.parse('2026-10-02T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

async function workspace(configDir = '.contextspace') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-attention-'));
  cleanup.push(dir);
  await fs.mkdir(path.join(dir, configDir), { recursive: true });
  return { dir, ledger: path.join(dir, configDir, 'chat.jsonl') };
}

const line = (entry: Record<string, unknown>) => JSON.stringify(entry) + '\n';
const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', timestamp: ago(MIN), harness: 'claude', author: 'agent', kind: 'input_request', message: 'Which branch?', ...over,
});

describe('latestInputRequest', () => {
  it('returns null when the workspace has no ledger', async () => {
    const { dir } = await workspace();
    expect(await latestInputRequest(dir, NOW)).toBeNull();
  });

  it('returns null for a directory that does not exist', async () => {
    expect(await latestInputRequest(path.join(os.tmpdir(), 'cs-attention-missing-dir'), NOW)).toBeNull();
  });

  it('returns the request with its id, time, harness and message', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger, line(request()), 'utf8');
    expect(await latestInputRequest(dir, NOW)).toEqual({
      id: 'r1', timestamp: ago(MIN), harness: 'claude', message: 'Which branch?',
    });
  });

  it('returns the newest request and ignores ordinary handoffs after it', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger,
      line(request({ id: 'a', timestamp: ago(30 * MIN), message: 'First?' }))
      + line(request({ id: 'b', timestamp: ago(10 * MIN), message: 'Second?' }))
      + line({ id: 'c', timestamp: ago(MIN), author: 'agent', message: 'Progress note' }),
      'utf8');
    expect((await latestInputRequest(dir, NOW))?.message).toBe('Second?');
  });

  it('picks the newest by time, not by position in the file', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger,
      line(request({ id: 'new', timestamp: ago(MIN), message: 'Newest' }))
      + line(request({ id: 'old', timestamp: ago(20 * MIN), message: 'Older' })),
      'utf8');
    expect((await latestInputRequest(dir, NOW))?.id).toBe('new');
  });

  it('skips malformed and truncated lines', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger, 'not json\n' + line(request()) + '{"kind":"input_request","message":"cut off', 'utf8');
    expect((await latestInputRequest(dir, NOW))?.message).toBe('Which branch?');
  });

  describe('ignores entries that should not raise an alert', () => {
    it.each([
      ['older than the maximum age', request({ timestamp: ago(INPUT_REQUEST_MAX_AGE_MS + MIN) })],
      ['dated far in the future', request({ timestamp: new Date(NOW + 60 * MIN).toISOString() })],
      ['without a timestamp', request({ timestamp: undefined })],
      ['with an unparseable timestamp', request({ timestamp: 'yesterday-ish' })],
      ['with an empty message', request({ message: '   ' })],
      ['with a non-string message', request({ message: { nested: true } })],
      ['of another kind', request({ kind: 'note' })],
    ])('an entry %s', async (_label, entry) => {
      const { dir, ledger } = await workspace();
      await fs.writeFile(ledger, line(entry), 'utf8');
      expect(await latestInputRequest(dir, NOW)).toBeNull();
    });

    it('accepts a request a little ahead of this clock', async () => {
      const { dir, ledger } = await workspace();
      await fs.writeFile(ledger, line(request({ timestamp: new Date(NOW + 2 * MIN).toISOString() })), 'utf8');
      expect(await latestInputRequest(dir, NOW)).not.toBeNull();
    });
  });

  it('strips control characters and bounds the message length', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger, line(request({ message: `\u001b[31mred\u0007 alert\u0000${'x'.repeat(INPUT_REQUEST_DISPLAY_LIMIT * 2)}` })), 'utf8');
    const result = await latestInputRequest(dir, NOW);
    expect(result?.message).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
    expect(result?.message.startsWith('[31mred alert')).toBe(true);
    expect(result?.message.length).toBe(INPUT_REQUEST_DISPLAY_LIMIT);
  });

  it('falls back to defaults for a missing id and harness', async () => {
    const { dir, ledger } = await workspace();
    await fs.writeFile(ledger, line(request({ id: undefined, harness: undefined })), 'utf8');
    const result = await latestInputRequest(dir, NOW);
    expect(result?.harness).toBe('agent');
    expect(result?.id).toBe(ago(MIN));
  });

  it('finds a request at the end of a ledger larger than the tail it reads', async () => {
    const { dir, ledger } = await workspace();
    const filler = Array.from({ length: 2500 }, (_, i) => line({ id: `h${i}`, timestamp: ago(40 * MIN), author: 'agent', message: `Handoff ${i} ${'y'.repeat(40)}` })).join('');
    expect(filler.length).toBeGreaterThan(64 * 1024);
    await fs.writeFile(ledger, filler + line(request({ message: 'Buried at the end?' })), 'utf8');
    expect((await latestInputRequest(dir, NOW))?.message).toBe('Buried at the end?');
  });

  it('does not misread the line cut by the tail boundary', async () => {
    const { dir, ledger } = await workspace();
    // A fake request sits right where the tail starts; it must not parse as a whole line.
    const filler = line({ id: 'pad', timestamp: ago(40 * MIN), message: 'p'.repeat(70 * 1024) });
    await fs.writeFile(ledger, filler + line(request({ message: 'Real one' })), 'utf8');
    expect((await latestInputRequest(dir, NOW))?.message).toBe('Real one');
  });

  it('reads a legacy .nexusflow ledger', async () => {
    const { dir, ledger } = await workspace('.nexusflow');
    await fs.writeFile(ledger, line(request({ message: 'From a legacy workspace' })), 'utf8');
    expect((await latestInputRequest(dir, NOW))?.message).toBe('From a legacy workspace');
  });

  it('takes the newest across a legacy and a primary ledger', async () => {
    const { dir, ledger: primary } = await workspace('.contextspace');
    await fs.mkdir(path.join(dir, '.nexusflow'), { recursive: true });
    await fs.writeFile(path.join(dir, '.nexusflow', 'chat.jsonl'), line(request({ id: 'legacy', timestamp: ago(MIN), message: 'Legacy is newer' })), 'utf8');
    await fs.writeFile(primary, line(request({ id: 'primary', timestamp: ago(15 * MIN), message: 'Primary is older' })), 'utf8');
    expect((await latestInputRequest(dir, NOW))?.id).toBe('legacy');
  });

  it('skips a ledger whose last write is older than the cutoff without reading it', async () => {
    const { dir, ledger } = await workspace();
    // The entry claims to be recent, but the file was last written long ago.
    await fs.writeFile(ledger, line(request()), 'utf8');
    const old = new Date(NOW - INPUT_REQUEST_MAX_AGE_MS - 60 * MIN);
    await fs.utimes(ledger, old, old);
    expect(await latestInputRequest(dir, NOW)).toBeNull();
  });

  it('treats an unreadable ledger as no alert', async () => {
    const { dir, ledger } = await workspace();
    await fs.mkdir(ledger); // a directory where the file should be
    expect(await latestInputRequest(dir, NOW)).toBeNull();
  });
});
