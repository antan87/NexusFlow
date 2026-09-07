import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { tailLogFile } from './log-tail.js';

/** Collects emitted chunks until `predicate` is satisfied or a timeout hits. */
function collectUntil(
  file: string,
  startOffset: number,
  predicate: (joined: string) => boolean,
  timeoutMs = 2000,
): Promise<{ chunks: string[]; stop: () => void }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const handle = tailLogFile(
      file,
      (chunk) => {
        chunks.push(chunk);
        if (predicate(chunks.join(''))) resolve({ chunks, stop: handle.stop });
      },
      { intervalMs: 15, startOffset },
    );
    setTimeout(() => {
      handle.stop();
      reject(new Error(`timeout; got: ${JSON.stringify(chunks)}`));
    }, timeoutMs);
  });
}

describe('tailLogFile', () => {
  let dir: string;
  let file: string;

  const INITIAL_CONTENT = 'existing\n';
  const INITIAL_SIZE = Buffer.byteLength(INITIAL_CONTENT, 'utf-8');

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-tail-'));
    file = path.join(dir, 'svc.log');
    await fs.writeFile(file, INITIAL_CONTENT, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('emits only bytes appended after the start offset', async () => {
    const wait = collectUntil(file, INITIAL_SIZE, (j) => j.includes('new line'));
    await fs.appendFile(file, 'new line\n', 'utf-8');
    const { chunks, stop } = await wait;
    stop();
    expect(chunks.join('')).toContain('new line');
    expect(chunks.join('')).not.toContain('existing');
  });

  it('resets and streams from the top after truncation', async () => {
    const wait = collectUntil(file, INITIAL_SIZE, (j) => j.includes('fresh'));
    // Rewrite to content SHORTER than the current offset (as PM2 does on
    // rotation) so size < offset triggers the reset-to-top path.
    await fs.writeFile(file, 'fresh\n', 'utf-8');
    const { chunks, stop } = await wait;
    stop();
    expect(chunks.join('')).toContain('fresh');
  });

  it('decodes a multi-byte character split across two appends', async () => {
    const euro = Buffer.from('€', 'utf-8'); // 3 bytes: e2 82 ac
    const wait = collectUntil(file, INITIAL_SIZE, (j) => j.includes('€'));
    await fs.appendFile(file, euro.subarray(0, 1)); // first byte only
    await new Promise((r) => setTimeout(r, 40));
    await fs.appendFile(file, euro.subarray(1)); // remaining bytes
    const { chunks, stop } = await wait;
    stop();
    expect(chunks.join('')).toContain('€');
  });

  it('stop() ends polling (no chunks after stop)', async () => {
    const seen: string[] = [];
    const handle = tailLogFile(file, (c) => seen.push(c), { intervalMs: 15, startOffset: INITIAL_SIZE });
    handle.stop();
    await fs.appendFile(file, 'ignored\n', 'utf-8');
    await new Promise((r) => setTimeout(r, 80));
    expect(seen.join('')).not.toContain('ignored');
  });
});
