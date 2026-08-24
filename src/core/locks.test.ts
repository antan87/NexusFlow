/**
 * Uses real temp directories rather than a mocked fs: the whole point of these
 * helpers is the behaviour of `open(..., 'wx')` on the actual filesystem, which
 * a mock cannot demonstrate.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireLock,
  createMutationQueue,
  getErrorCode,
} from './locks.js';

let dir = '';

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-locks-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const OPTIONS = { staleMs: 60_000, timeoutMs: 500, timeoutMessage: 'timed out' };

describe('getErrorCode', () => {
  it('reads an errno code and tolerates values without one', () => {
    expect(getErrorCode(Object.assign(new Error('x'), { code: 'EEXIST' }))).toBe('EEXIST');
    expect(getErrorCode(new Error('x'))).toBeUndefined();
    expect(getErrorCode(null)).toBeUndefined();
  });
});

describe('acquireLock', () => {
  it('creates the lock file, including any missing parent directory', async () => {
    const lockPath = path.join(dir, 'nested', 'a.lock');

    const release = await acquireLock(lockPath, OPTIONS);

    const body = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    expect(body.pid).toBe(process.pid);
    await release();
  });

  it('removes the lock file on release, and release is idempotent', async () => {
    const lockPath = path.join(dir, 'b.lock');
    const release = await acquireLock(lockPath, OPTIONS);

    await release();
    await release();

    await expect(fs.stat(lockPath)).rejects.toThrow();
  });

  it('times out while another holder keeps the lock', async () => {
    const lockPath = path.join(dir, 'c.lock');
    const release = await acquireLock(lockPath, OPTIONS);

    await expect(
      acquireLock(lockPath, { ...OPTIONS, timeoutMs: 150, timeoutMessage: 'still busy' }),
    ).rejects.toThrow('still busy');

    await release();
  });

  it('succeeds once the previous holder releases', async () => {
    const lockPath = path.join(dir, 'd.lock');
    const release = await acquireLock(lockPath, OPTIONS);
    setTimeout(() => void release(), 60);

    const second = await acquireLock(lockPath, { ...OPTIONS, timeoutMs: 2_000 });

    await second();
  });

    it('reclaims a lock left behind by a dead process', async () => {
    // Without stale reclamation a killed run would wedge its resource forever.
    const lockPath = path.join(dir, 'e.lock');
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999_999 }), 'utf-8');
    const old = new Date(Date.now() - 10 * 60_000);
    await fs.utimes(lockPath, old, old);

    const release = await acquireLock(lockPath, { ...OPTIONS, staleMs: 60_000, timeoutMs: 0 });

    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).pid).toBe(process.pid);
    await release();
  });

  it('reclaims a lock from a dead process immediately regardless of staleMs', async () => {
    const lockPath = path.join(dir, 'dead-pid.lock');
    // Write an invalid/dead PID with fresh mtime
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999_999, createdAt: new Date().toISOString() }), 'utf-8');

    const release = await acquireLock(lockPath, { ...OPTIONS, staleMs: 1_000_000, timeoutMs: 100 });
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).pid).toBe(process.pid);
    await release();
  });

  it('heartbeats lock mtime periodically while held to prevent lock-stealing', async () => {
    const lockPath = path.join(dir, 'heartbeat.lock');
    const release = await acquireLock(lockPath, { ...OPTIONS, staleMs: 100, heartbeatMs: 30 });

    const initialStat = await fs.stat(lockPath);
    await new Promise((r) => setTimeout(r, 90));
    const laterStat = await fs.stat(lockPath);

    expect(laterStat.mtimeMs).toBeGreaterThan(initialStat.mtimeMs);
    await release();
  });

  it('prevents another process from stealing a lock during long holds via continuous heartbeats', async () => {
    const lockPath = path.join(dir, 'long-turn.lock');
    // Lock with 100ms staleness window and 30ms heartbeat
    const release = await acquireLock(lockPath, { ...OPTIONS, staleMs: 100, heartbeatMs: 30 });

    // Wait longer than the staleness window (180ms)
    await new Promise((r) => setTimeout(r, 180));

    // Try to acquire the lock immediately with 0 timeout from a second attempt - should fail because heartbeat kept it fresh
    await expect(
      acquireLock(lockPath, { ...OPTIONS, staleMs: 100, timeoutMs: 0, timeoutMessage: 'lock still actively held' }),
    ).rejects.toThrow('lock still actively held');

    await release();
  });

  it('handles vanishing or concurrently unlinked lock files during staleness check without crashing (TOCTOU safety)', async () => {
    const lockPath = path.join(dir, 'toctou.lock');
    // Create an initial lock file
    await fs.writeFile(lockPath, JSON.stringify({ pid: 999_999 }), 'utf-8');

    // Simulate concurrent unlinking while acquireLock runs
    const acquirePromise = acquireLock(lockPath, { ...OPTIONS, staleMs: 50, timeoutMs: 1_000 });
    await fs.unlink(lockPath).catch(() => {});

    const release = await acquirePromise;
    expect(JSON.parse(await fs.readFile(lockPath, 'utf-8')).pid).toBe(process.pid);
    await release();
  });
});

describe('createMutationQueue', () => {
  it('runs operations one at a time in arrival order', async () => {
    const enqueue = createMutationQueue();
    const order: string[] = [];

    const slow = enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push('first');
      return 1;
    });
    const fast = enqueue(async () => {
      order.push('second');
      return 2;
    });

    expect(await Promise.all([slow, fast])).toEqual([1, 2]);
    expect(order).toEqual(['first', 'second']);
  });

  it('keeps draining after a rejection instead of wedging', async () => {
    // A single failure must not stall every later mutation.
    const enqueue = createMutationQueue();

    await expect(enqueue(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    await expect(enqueue(async () => 'still works')).resolves.toBe('still works');
  });

  it('propagates each operation result to its own caller', async () => {
    const enqueue = createMutationQueue();

    const results = await Promise.all([enqueue(async () => 'a'), enqueue(async () => 'b')]);

    expect(results).toEqual(['a', 'b']);
  });
});
