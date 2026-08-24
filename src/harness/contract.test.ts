import { describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import type { HarnessEvent } from './types.js';

describe('Harness Contract Test Suite (Issue #174)', () => {
  describe('ClaudeCodeAdapter Contract', () => {
    it('resolves lazy sessionId and normalizes stream events and usage', async () => {
      async function* fakeQuery() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        };
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello from Claude' },
          },
        };
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello from Claude' }],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: 'Hello from Claude',
          total_cost_usd: 0.002,
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            cache_read_input_tokens: 40,
          },
        };
      }

      const mockQueryFn = vi.fn().mockReturnValue(fakeQuery());
      const adapter = new ClaudeCodeAdapter(undefined, mockQueryFn as any);

      const handle = await adapter.start({
        prompt: 'Say hello',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      const sessionId = await handle.sessionId();
      expect(sessionId).toBe('123e4567-e89b-12d3-a456-426614174000');

      const events: HarnessEvent[] = [];
      for await (const ev of handle.events) {
        events.push(ev);
        if (ev.type === 'turn_completed') break;
      }

      expect(events).toContainEqual({
        type: 'session_started',
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(events).toContainEqual({
        type: 'text_delta',
        text: 'Hello from Claude',
      });
      expect(events).toContainEqual({
        type: 'assistant_message',
        text: 'Hello from Claude',
      });
      expect(events).toContainEqual({
        type: 'turn_completed',
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cachedInputTokens: 40,
          costUsdEstimate: 0.002,
        },
      });

      await handle.dispose();
    });

    it('cancels active turn cleanly on handle.interrupt() via AbortController', async () => {
      let aborted = false;

      async function* fakeLongQuery(args: any) {
        const signal = args.options.abortController.signal;
        signal.addEventListener('abort', () => {
          aborted = true;
        });

        yield {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        };
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Starting long task...' },
          },
        };

        // Simulate waiting for abort
        while (!signal.aborted) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      const mockQueryFn = vi.fn().mockImplementation((args) => fakeLongQuery(args));
      const adapter = new ClaudeCodeAdapter(undefined, mockQueryFn as any);

      const handle = await adapter.start({
        prompt: 'Long running task',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      await handle.interrupt();
      expect(aborted).toBe(true);
      await handle.dispose();
    });
  });

  describe('CodexAdapter Contract & MCP Smoke Test', () => {
    it('executes Codex thread lifecycle, maps MCP tool items, and normalizes usage', async () => {
      async function* fakeStream() {
        yield {
          type: 'thread.started',
          thread_id: 'codex-thread-12345',
        };
        yield {
          type: 'item.completed',
          item: {
            id: 'mcp-call-1',
            type: 'mcp_tool_call',
            server: 'nexusflow',
            tool: 'list_repos',
            arguments: {},
            status: 'completed',
            result: {
              content: [{ type: 'text', text: '["repo1"]' }],
              structured_content: ['repo1'],
            },
          },
        };
        yield {
          type: 'item.completed',
          item: {
            id: 'agent-msg-1',
            type: 'agent_message',
            text: 'Found 1 repo in workspace.',
          },
        };
        yield {
          type: 'turn.completed',
          usage: {
            input_tokens: 200,
            output_tokens: 50,
            cached_input_tokens: 100,
          },
        };
      }

      const mockThread = {
        id: 'codex-thread-12345',
        runStreamed: vi.fn().mockResolvedValue({ events: fakeStream() }),
      };

      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);

      const handle = await adapter.start({
        prompt: 'List repos via MCP',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
        mcpServers: {
          nexusflow: {
            command: process.execPath,
            args: ['mcp', 'run'],
          },
        },
      });

      const sessionId = await handle.sessionId();
      expect(sessionId).toBe('codex-thread-12345');

      const events: HarnessEvent[] = [];
      for await (const ev of handle.events) {
        events.push(ev);
        if (ev.type === 'turn_completed') break;
      }

      expect(events).toContainEqual({
        type: 'session_started',
        sessionId: 'codex-thread-12345',
      });
      expect(events).toContainEqual({
        type: 'tool_completed',
        callId: 'mcp-call-1',
        ok: true,
        outputSummary: undefined,
      });
      expect(events).toContainEqual({
        type: 'assistant_message',
        text: 'Found 1 repo in workspace.',
      });
      expect(events).toContainEqual({
        type: 'turn_completed',
        usage: {
          inputTokens: 200,
          outputTokens: 50,
          cachedInputTokens: 100,
        },
      });

      await handle.dispose();
    });

    it('keeps the handle stream open for a queued follow-up turn', async () => {
      let finishFirstTurn!: () => void;
      let finishSecondTurn!: () => void;
      const firstTurnFinished = new Promise<void>((resolve) => {
        finishFirstTurn = resolve;
      });
      const secondTurnFinished = new Promise<void>((resolve) => {
        finishSecondTurn = resolve;
      });

      async function* firstTurn() {
        try {
          yield {
            type: 'thread.started',
            thread_id: 'codex-thread-multi-turn',
          };
          yield {
            type: 'item.completed',
            item: {
              id: 'agent-msg-first',
              type: 'agent_message',
              text: 'First response',
            },
          };
          yield {
            type: 'turn.completed',
            usage: { input_tokens: 10, output_tokens: 2 },
          };
        } finally {
          finishFirstTurn();
        }
      }

      async function* secondTurn() {
        try {
          yield {
            type: 'item.completed',
            item: {
              id: 'agent-msg-second',
              type: 'agent_message',
              text: 'Second response',
            },
          };
          yield {
            type: 'turn.completed',
            usage: { input_tokens: 12, output_tokens: 3 },
          };
        } finally {
          finishSecondTurn();
        }
      }

      const runStreamed = vi.fn()
        .mockResolvedValueOnce({ events: firstTurn() })
        .mockResolvedValueOnce({ events: secondTurn() });
      const mockThread = {
        id: 'codex-thread-multi-turn',
        runStreamed,
      };
      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);
      const handle = await adapter.start({
        prompt: 'First prompt',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
      });
      const events = handle.events[Symbol.asyncIterator]();

      try {
        await expect(events.next()).resolves.toEqual({
          done: false,
          value: { type: 'session_started', sessionId: 'codex-thread-multi-turn' },
        });
        await expect(events.next()).resolves.toEqual({
          done: false,
          value: { type: 'assistant_message', text: 'First response' },
        });
        await expect(events.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'turn_completed' },
        });

        await firstTurnFinished;
        await new Promise<void>((resolve) => setImmediate(resolve));
        handle.send('Second prompt');

        await expect(events.next()).resolves.toEqual({
          done: false,
          value: { type: 'assistant_message', text: 'Second response' },
        });
        await expect(events.next()).resolves.toMatchObject({
          done: false,
          value: { type: 'turn_completed' },
        });
        await secondTurnFinished;
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(runStreamed).toHaveBeenNthCalledWith(1, 'First prompt', expect.any(Object));
        expect(runStreamed).toHaveBeenNthCalledWith(2, 'Second prompt', expect.any(Object));

        const pendingNext = events.next();
        const stateBeforeDispose = await Promise.race([
          pendingNext.then(() => 'settled' as const),
          new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 25)),
        ]);
        expect(stateBeforeDispose).toBe('pending');

        await handle.dispose();
        await expect(pendingNext).resolves.toEqual({ done: true, value: undefined });
      } finally {
        await handle.dispose();
      }
    });

    it('cancels active Codex turn on handle.interrupt() via AbortSignal', async () => {
      let aborted = false;

      async function* fakeLongStream(signal?: AbortSignal) {
        if (signal) {
          signal.addEventListener('abort', () => {
            aborted = true;
          });
        }
        yield {
          type: 'thread.started',
          thread_id: 'codex-thread-abort',
        };
        while (!signal?.aborted) {
          await new Promise((r) => setTimeout(r, 10));
        }
      }

      const mockThread = {
        id: 'codex-thread-abort',
        runStreamed: vi.fn().mockImplementation((_prompt, opts) => {
          return Promise.resolve({ events: fakeLongStream(opts?.signal) });
        }),
      };

      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);

      const handle = await adapter.start({
        prompt: 'Long running codex task',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
      });

      await handle.interrupt();
      expect(aborted).toBe(true);
      await handle.dispose();
    });
  });
});
