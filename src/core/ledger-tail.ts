/**
 * @module core/ledger-tail
 * Reads the end of a chat ledger without reading its history. Shared by the
 * alert, the open-question list and the live screen feed, which all want only
 * the newest entries of a file that grows for as long as a workspace lives.
 */

import * as fs from 'node:fs/promises';

export interface LedgerTail {
  /** Complete lines from the end of the file, oldest first. */
  lines: string[];
  /** The whole file was read, so reading more finds nothing new. */
  complete: boolean;
}

/**
 * Reads up to `bytes` from the end of `file`. A file untouched since `sinceMs`
 * cannot hold anything newer than it, so it is skipped. A missing or unreadable
 * file is an empty, complete tail.
 */
export async function readLedgerTail(file: string, sinceMs: number, bytes: number): Promise<LedgerTail> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mtimeMs < sinceMs) return { lines: [], complete: true };
    const start = Math.max(0, stat.size - bytes);
    const buffer = Buffer.alloc(stat.size - start);
    // A short read (the file shrank meanwhile) must not leave padding in the last line.
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.subarray(0, bytesRead).toString('utf8').split('\n');
    // Reading from mid-file starts inside a line; drop that fragment.
    if (start > 0) lines.shift();
    return { lines, complete: start === 0 };
  } catch {
    return { lines: [], complete: true };
  } finally {
    await handle?.close().catch(() => {});
  }
}
