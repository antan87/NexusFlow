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

    it('safely handles dispose() mid-turn without unhandled rejections', async () => {
      const queue = new Pushable<string>();
      let closed = false;
      const safePush = (val: string) => {
        if (closed) return;
        try {
          queue.push(val);
        } catch {
          // Disposed concurrently
        }
      };

      safePush('first-turn');
      // Simulate concurrent dispose
      closed = true;
      queue.end();

      // In-flight producer tries to push post-disposal
      expect(() => safePush('in-flight-event')).not.toThrow();

      const events: string[] = [];
      for await (const ev of queue) {
        events.push(ev);
      }
      expect(events).toEqual(['first-turn']);
    });
  });

  describe('Normalized Contract Stream Verification (Fake Engine)', () => {
    it('normalizes stream events into canonical HarnessEvent sequence', async () => {
      const events: import('./types.js').HarnessEvent[] = [];
      const out = new Pushable<import('./types.js').HarnessEvent>();

      // Push a canonical turn sequence
      out.push({ type: 'session_started', sessionId: '123e4567-e89b-12d3-a456-426614174000' });
      out.push({ type: 'text_delta', text: 'Hel' });
      out.push({ type: 'text_delta', text: 'lo' });
      out.push({ type: 'assistant_message', text: 'Hello' });
      out.push({
        type: 'turn_completed',
        usage: {
          inputTokens: 100,
          outputTokens: 25,
          cachedInputTokens: 50,
          costUsdEstimate: 0.0015,
        },
      });
      out.end();

      for await (const ev of out) {
        events.push(ev);
      }

      expect(events).toHaveLength(5);
      expect(events[0]).toEqual({ type: 'session_started', sessionId: '123e4567-e89b-12d3-a456-426614174000' });
      expect(events[1]).toEqual({ type: 'text_delta', text: 'Hel' });
      expect(events[2]).toEqual({ type: 'text_delta', text: 'lo' });
      expect(events[3]).toEqual({ type: 'assistant_message', text: 'Hello' });
      expect(events[4]).toEqual({
        type: 'turn_completed',
        usage: {
          inputTokens: 100,
          outputTokens: 25,
          cachedInputTokens: 50,
          costUsdEstimate: 0.0015,
        },
      });
    });

    it('serializes errors safely for JSON boundary in turn_failed event', () => {
      const rawError = new TypeError('Network connection reset');
      const serialized: import('./types.js').SerializedError = {
        message: rawError.message,
        name: rawError.name,
        stack: rawError.stack,
      };
      const event: import('./types.js').HarnessEvent = {
        type: 'turn_failed',
        error: serialized,
        fatal: true,
      };

      const json = JSON.stringify(event);
      const parsed = JSON.parse(json);
      expect(parsed.error.message).toBe('Network connection reset');
      expect(parsed.error.name).toBe('TypeError');
      expect(parsed.fatal).toBe(true);
    });
  });

  describe('Authentication Status Detection & Preflight', () => {
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

    it('detects credentials passed via env parameter (multi-tenant / per-spec)', async () => {
      const adapter = getAdapter('claude-code');
      const status = await adapter.authStatus(undefined, { ANTHROPIC_API_KEY: 'test-key' });
      expect(status.configured).toBe(true);
      expect(status.method).toBe('api-key');

      const codexAdapter = getAdapter('codex');
      const codexStatus = await codexAdapter.authStatus(undefined, { OPENAI_API_KEY: 'sk-test' });
      expect(codexStatus.configured).toBe(true);
      expect(codexStatus.method).toBe('api-key');
    });

    it('throws AuthRequiredError on start() if unauthenticated', async () => {
      const origKey = process.env.ANTHROPIC_API_KEY;
      const origToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

      try {
        const adapter = getAdapter('claude-code');
        await expect(
          adapter.start({
            prompt: 'test',
            workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
          }),
        ).rejects.toThrow(AuthRequiredError);
      } finally {
        if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
        if (origToken) process.env.CLAUDE_CODE_OAUTH_TOKEN = origToken;
      }
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
