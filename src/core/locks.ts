/**
 * @module core/locks
 * Cross-process file locks and in-process mutation serialization.
 *
 * Both guards are needed together: the lock file keeps two NexusFlow processes
 * (a CLI invocation and the dashboard server) from writing the same state, and
 * the promise queue keeps two concurrent calls *within* one process from
 * interleaving a read-modify-write.
 *
 * Consumed by `core/scheduler.ts`. It lives in its own module rather than inside
 * the scheduler because the mutation-queue shape is subtle — the next operation
 * must run whether the previous one resolved or rejected — and that is worth
 * stating once, with tests, rather than re-deriving.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** How long to wait between attempts when a lock is contended. */
const LOCK_RETRY_MS = 50;

export interface LockOptions {
  /** A lock file older than this is presumed abandoned and reclaimed. */
  staleMs: number;
  /** How long to keep retrying before giving up. Zero fails immediately. */
  timeoutMs: number;
  timeoutMessage: string;
}

/** Releases a held lock. Safe to call more than once. */
export type ReleaseLock = () => Promise<void>;

/** Reads a Node errno code off an unknown thrown value. */
export function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as NodeJS.ErrnoException).code)
    : undefined;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clearStaleLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs <= staleMs) return false;
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    // Vanishing while we looked at it is the outcome we wanted anyway.
    return getErrorCode(error) === 'ENOENT';
  }
}

/**
 * Acquires an exclusive lock by creating `lockPath` with `wx`, which fails if it
 * already exists. A lock older than `staleMs` is reclaimed, so a process killed
 * mid-run cannot wedge the resource permanently.
 *
 * @throws when the lock cannot be taken within `timeoutMs`.
 */
export async function acquireLock(lockPath: string, options: LockOptions): Promise<ReleaseLock> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();

  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }) + '\n', 'utf-8');
      } catch (error) {
        // Never leave a lock we cannot describe.
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
        throw error;
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      };
    } catch (error) {
      const code = getErrorCode(error);
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
      if (await clearStaleLock(lockPath, options.staleMs)) continue;
      if (Date.now() - startedAt >= options.timeoutMs) {
        throw new Error(options.timeoutMessage);
      }
      await delay(LOCK_RETRY_MS);
    }
  }
}

/**
 * Serializes async operations in arrival order within this process.
 *
 * The `then(operation, operation)` shape is deliberate: the next operation must
 * run whether the previous one resolved or rejected, otherwise one failure would
 * wedge the queue forever.
 */
export function createMutationQueue(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();

  return <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}