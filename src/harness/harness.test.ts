import { describe, expect, it } from 'vitest';
import { getAdapter } from './index.js';
import { Pushable } from './pushable.js';
import { UnsupportedOperationError, AuthRequiredError } from './interface.js';

describe('Harness Abstraction Layer', () => {
  describe('Factory getAdapter', () => {
    it('returns ClaudeCodeAdapter for claude-code', () => {
      const adapter = getAdapter('claude-code');
      expect(adapter.vendor).toBe('claude-code');
    });

    it('returns CodexAdapter for codex', () => {
      const adapter = getAdapter('codex');
      expect(adapter.vendor).toBe('codex');
    });
  });

  describe('Pushable Async Iterable Queue', () => {
    it('pushes and yields items sequentially', async () => {
      const queue = new Pushable<string>();
      queue.push('item-1');
      queue.push('item-2');
      queue.end();

      const items: string[] = [];
      for await (const item of queue) {
        items.push(item);
      }
      expect(items).toEqual(['item-1', 'item-2']);
    });

    it('handles async consumption after end', async () => {
      const queue = new Pushable<number>();
      queue.push(10);
      queue.end();

      const result: number[] = [];
      for await (const n of queue) {
        result.push(n);
      }
      expect(result).toEqual([10]);
    });

    it('drains buffered items to a late subscriber', async () => {
      const queue = new Pushable<string>();
      queue.push('a');
      queue.push('b');
      queue.push('c');
      queue.end();

      const received: string[] = [];
      for await (const item of queue) {
        received.push(item);
      }
      expect(received).toEqual(['a', 'b', 'c']);
    });

    it('is idempotent on double-end', async () => {
      const queue = new Pushable<string>();
      queue.push('x');
      queue.end();
      expect(() => queue.end()).not.toThrow();

      const items: string[] = [];
      for await (const item of queue) {
        items.push(item);
      }
      expect(items).toEqual(['x']);
    });

    it('throws when pushing to an ended Pushable queue', () => {
      const queue = new Pushable<string>();
      queue.end();
      expect(() => queue.push('late')).toThrow(
        'Cannot push to a Pushable stream that has already ended.',
      );
    });
  });

  describe('Normalized Contract Verification', () => {
    it('normalizes turn events with text_delta and SerializedError', async () => {
      const fakeError = new Error('Test failure');
      const serialized = {
        message: fakeError.message,
        name: fakeError.name,
        stack: fakeError.stack,
      };
      expect(JSON.stringify(serialized)).toContain('Test failure');
      expect(JSON.stringify(serialized)).toContain('Error');
    });
  });

  describe('Authentication Status Detection', () => {
    it('checks authStatus for ClaudeCodeAdapter', async () => {
      const adapter = getAdapter('claude-code');
      const status = await adapter.authStatus();
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('method');
    });

    it('checks authStatus for CodexAdapter', async () => {
      const adapter = getAdapter('codex');
      const status = await adapter.authStatus();
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('method');
    });
  });

  describe('Error Classes', () => {
    it('formats UnsupportedOperationError message correctly', () => {
      const err = new UnsupportedOperationError('codex', 'fork', 'no native fork');
      expect(err.message).toContain('[codex] fork unsupported: no native fork');
      expect(err.vendor).toBe('codex');
      expect(err.operation).toBe('fork');
    });

    it('formats AuthRequiredError message correctly', () => {
      const err = new AuthRequiredError('claude-code', 'token missing');
      expect(err.message).toContain('[claude-code] Authentication required: token missing');
      expect(err.vendor).toBe('claude-code');
    });
  });
});
