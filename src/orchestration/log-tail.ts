/**
 * @module orchestration/log-tail
 * Incremental, Windows-safe log file tailing for the SSE log stream. Polls on
 * an interval (fs.watch is unreliable on Windows) and emits only appended
 * bytes, tolerating missing files, truncation, and rotation.
 */

import * as fs from 'node:fs/promises';

export interface LogTailHandle {
  stop(): void;
}

export interface LogTailOptions {
  /** Poll cadence. Default 500ms. */
  intervalMs?: number;
  /** Byte offset to start from. Defaults to the file's current size. */
  startOffset?: number;
}

/**
 * Tails a log file, invoking `onChunk` with each newly appended stretch of
 * text. Semantics:
 * - Missing file: tolerated — it may appear later (first start), streaming
 *   then begins from byte 0.
 * - Truncation/rotation (size < offset): offset resets to 0 and the new
 *   file's content streams from the top (a service restart just appends).
 * - Multi-byte UTF-8 sequences split across reads decode correctly (a
 *   persistent streaming TextDecoder carries the partial bytes).
 */
export function tailLogFile(
  filePath: string,
  onChunk: (chunk: string) => void,
  options: LogTailOptions = {},
): LogTailHandle {
  const intervalMs = options.intervalMs ?? 500;
  let offset = options.startOffset ?? -1; // -1 → initialize to current size on first tick
  let stopped = false;
  let polling = false;
  let decoder = new TextDecoder('utf-8');

  const tick = async () => {
    if (polling || stopped) return;
    polling = true;
    try {
      let handle: fs.FileHandle;
      try {
        handle = await fs.open(filePath, 'r');
      } catch (err) {
        // ENOENT: the file isn't created yet or was removed — when it
        // (re)appears, stream it from the top and drop any half-decoded
        // multibyte bytes carried from the old file (as the truncation branch
        // does), else a split UTF-8 sequence corrupts the first char emitted
        // from the re-created file. Any OTHER (transient) stat failure (e.g. a
        // Windows lock while PM2 appends) must leave the offset intact and
        // retry next tick; resetting to 0 would re-read and re-emit the whole
        // file as duplicate output.
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          offset = 0;
          decoder = new TextDecoder('utf-8');
        }
        return;
      }

      try {
        const { size } = await handle.stat();
        if (offset === -1) {
          // First tick: stream only future output unless a startOffset was given.
          offset = size;
          return;
        }

        if (size < offset) {
          // Truncated or rotated — restart from the top of the new content, and
          // drop any half-decoded multibyte bytes carried from the old file.
          offset = 0;
          decoder = new TextDecoder('utf-8');
        }
        if (size === offset) return;

        const length = size - offset;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        offset += bytesRead;
        const text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
        if (text && !stopped) onChunk(text);
      } finally {
        await handle.close();
      }
    } catch {
      // Transient read errors (e.g. rotation mid-read) — next tick retries.
    } finally {
      polling = false;
    }
  };

  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
  // Fire immediately so a provided startOffset backfills without waiting.
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    },
  };
}
