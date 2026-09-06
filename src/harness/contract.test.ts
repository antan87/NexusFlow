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

    it('maps file modification tools (Write, Edit, MultiEdit, FileEdit, FileWrite) to file_changed events', async () => {
      async function* fakeToolQuery() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        };
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'call-1',
                name: 'Write',
                input: { file_path: 'src/index.ts' },
              },
              {
                type: 'tool_use',
                id: 'call-2',
                name: 'Edit',
                input: { path: 'src/app.ts' },
              },
              {
                type: 'tool_use',
                id: 'call-3',
                name: 'MultiEdit',
                input: { paths: ['src/a.ts', 'src/b.ts'] },
              },
              {
                type: 'tool_use',
                id: 'call-4',
                name: 'FileEdit',
                input: { filePath: 'src/c.ts' },
              },
              {
                type: 'tool_use',
                id: 'call-5',
                name: 'FileWrite',
                input: { file_path: 'src/d.ts' },
              },
            ],
          },
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: 'All done',
        };
      }

      const mockQueryFn = vi.fn().mockReturnValue(fakeToolQuery());
      const adapter = new ClaudeCodeAdapter(undefined, mockQueryFn as any);

      const handle = await adapter.start({
        prompt: 'Edit files',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      const events: HarnessEvent[] = [];
      for await (const ev of handle.events) {
        events.push(ev);
        if (ev.type === 'turn_completed') break;
      }

      expect(events).toContainEqual({
        type: 'file_changed',
        kind: 'write',
        paths: ['src/index.ts'],
      });
      expect(events).toContainEqual({
        type: 'file_changed',
        kind: 'edit',
        paths: ['src/app.ts'],
      });
      expect(events).toContainEqual({
        type: 'file_changed',
        kind: 'edit',
        paths: ['src/a.ts', 'src/b.ts'],
      });
      expect(events).toContainEqual({
        type: 'file_changed',
        kind: 'edit',
        paths: ['src/c.ts'],
      });
      expect(events).toContainEqual({
        type: 'file_changed',
        kind: 'write',
        paths: ['src/d.ts'],
      });

      await handle.dispose();
    });

    it('extracts rich error details from msg.errors on turn_failed', async () => {
      async function* fakeErrorQuery() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        };
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          errors: ['Permission denied to execute command', 'File is locked'],
        };
      }

      const mockQueryFn = vi.fn().mockReturnValue(fakeErrorQuery());
      const adapter = new ClaudeCodeAdapter(undefined, mockQueryFn as any);

      const handle = await adapter.start({
        prompt: 'Fail please',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      const events: HarnessEvent[] = [];
      for await (const ev of handle.events) {
        events.push(ev);
        if (ev.type === 'turn_failed') break;
      }

      expect(events).toContainEqual({
        type: 'turn_failed',
        error: { message: 'Permission denied to execute command; File is locked' },
        fatal: true,
      });

      await handle.dispose();
    });

    it('extracts rich error details from msg.result on turn_failed', async () => {
      async function* fakeResultErrorQuery() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: '123e4567-e89b-12d3-a456-426614174000',
        };
        yield {
          type: 'result',
          subtype: 'error_during_execution',
          result: 'Rate limit exceeded: 429 Too Many Requests',
        };
      }

      const mockQueryFn = vi.fn().mockReturnValue(fakeResultErrorQuery());
      const adapter = new ClaudeCodeAdapter(undefined, mockQueryFn as any);

      const handle = await adapter.start({
        prompt: 'Fail please',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
      });

      const events: HarnessEvent[] = [];
      for await (const ev of handle.events) {
        events.push(ev);
        if (ev.type === 'turn_failed') break;
      }

      expect(events).toContainEqual({
        type: 'turn_failed',
        error: { message: 'Rate limit exceeded: 429 Too Many Requests' },
        fatal: true,
      });

      await handle.dispose();
    });

    it('supports ANTHROPIC_AUTH_TOKEN, Bedrock, Vertex, Foundry, and OAuth credentials in authStatus', async () => {
      const adapter = new ClaudeCodeAdapter();

      const authTokenStatus = await adapter.authStatus(undefined, { ANTHROPIC_AUTH_TOKEN: 'auth-token-123' });
      expect(authTokenStatus).toEqual({
        configured: true,
        method: 'api-key',
        hasApiKeyFallback: false,
      });

      const bedrockStatus = await adapter.authStatus(undefined, { CLAUDE_CODE_USE_BEDROCK: '1' });
      expect(bedrockStatus).toEqual({
        configured: true,
        method: 'cloud-gateway',
        hasApiKeyFallback: false,
      });

      const vertexStatus = await adapter.authStatus(undefined, { CLAUDE_CODE_USE_VERTEX: '1' });
      expect(vertexStatus).toEqual({
        configured: true,
        method: 'cloud-gateway',
        hasApiKeyFallback: false,
      });

      const foundryStatus = await adapter.authStatus(undefined, { CLAUDE_CODE_USE_FOUNDRY: '1' });
      expect(foundryStatus).toEqual({
        configured: true,
        method: 'cloud-gateway',
        hasApiKeyFallback: false,
      });

      const oauthStatus = await adapter.authStatus(undefined, { CLAUDE_CODE_OAUTH_TOKEN: 'oauth-tok' });
      expect(oauthStatus).toEqual({
        configured: true,
        method: 'subscription-oauth',
        hasApiKeyFallback: false,
      });
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

    it('applies model and native thread options when resuming a Codex thread', async () => {
      const mockThread = {
        id: 'codex-thread-resumed',
        runStreamed: vi.fn(),
      };
      const mockClient = {
        resumeThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);
      const handle = await adapter.resume({
        sessionId: 'codex-thread-resumed',
        mode: 'resume',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
        model: 'gpt-5.6-terra',
        nativeOptions: { sandboxMode: 'read-only' },
      });

      expect(mockClient.resumeThread).toHaveBeenCalledWith('codex-thread-resumed', {
        workingDirectory: 'C:/test',
        skipGitRepoCheck: true,
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        model: 'gpt-5.6-terra',
      });
      expect(mockThread.runStreamed).not.toHaveBeenCalled();

      await handle.dispose();
    });

    it('maps permissionMode to sandboxMode and sets approvalPolicy never on start and resume', async () => {
      const mockThread = {
        id: 'codex-thread-perm',
        runStreamed: vi.fn(),
      };
      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
        resumeThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);

      // 1. acceptEdits -> workspace-write
      const handle1 = await adapter.start({
        prompt: 'test',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
        permissionMode: 'acceptEdits',
      });
      expect(mockClient.startThread).toHaveBeenCalledWith(expect.objectContaining({
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        skipGitRepoCheck: true,
      }));
      await handle1.dispose();

      // 2. default -> read-only
      const handle2 = await adapter.start({
        prompt: 'test',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
        permissionMode: 'default',
      });
      expect(mockClient.startThread).toHaveBeenCalledWith(expect.objectContaining({
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
        skipGitRepoCheck: true,
      }));
      await handle2.dispose();

      // 3. resume with bypassPermissions -> workspace-write
      const handle3 = await adapter.resume({
        sessionId: 'codex-thread-perm',
        mode: 'resume',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
        permissionMode: 'bypassPermissions',
      });
      expect(mockClient.resumeThread).toHaveBeenCalledWith('codex-thread-perm', expect.objectContaining({
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        skipGitRepoCheck: true,
      }));
      await handle3.dispose();
    });

    it('forwards env, API keys, and nested mcp_servers to Codex client options', async () => {
      const mockThread = {
        id: 'codex-thread-cfg',
        runStreamed: vi.fn(),
      };
      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
      };

      let capturedClientOpts: any = null;
      const adapter = new CodexAdapter({}, (opts) => {
        capturedClientOpts = opts;
        return mockClient as any;
      });

      const handle = await adapter.start({
        prompt: 'test',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { CODEX_API_KEY: 'sk-codex-custom-key', CUSTOM_VAR: 'value1' },
        mcpServers: {
          myserver: {
            command: 'node',
            args: ['server.js'],
          },
        },
      });

      expect(capturedClientOpts).toMatchObject({
        apiKey: 'sk-codex-custom-key',
        env: expect.objectContaining({
          CODEX_API_KEY: 'sk-codex-custom-key',
          CUSTOM_VAR: 'value1',
        }),
        config: {
          mcp_servers: {
            myserver: {
              command: 'node',
              args: ['server.js'],
            },
          },
        },
      });

      await handle.dispose();
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

    it('does not run queued or later prompts after an interrupted turn fails fatally', async () => {
      let streamWaiting!: () => void;
      const streamIsWaiting = new Promise<void>((resolve) => {
        streamWaiting = resolve;
      });

      async function* interruptedStream(signal?: AbortSignal) {
        yield {
          type: 'thread.started',
          thread_id: 'codex-thread-interrupted',
        };
        await new Promise<void>((_resolve, reject) => {
          const fail = () => reject(new Error('turn aborted'));
          if (signal?.aborted) {
            fail();
            return;
          }
          signal?.addEventListener('abort', fail, { once: true });
          streamWaiting();
        });
      }

      const runStreamed = vi.fn().mockImplementation((_prompt, opts) => (
        Promise.resolve({ events: interruptedStream(opts?.signal) })
      ));
      const mockThread = {
        id: 'codex-thread-interrupted',
        runStreamed,
      };
      const mockClient = {
        startThread: vi.fn().mockReturnValue(mockThread),
      };

      const adapter = new CodexAdapter({}, () => mockClient as any);
      const handle = await adapter.start({
        prompt: 'Active prompt',
        workspace: { workspaceId: 'test-ws', rootPath: 'C:/test' },
        env: { OPENAI_API_KEY: 'sk-test' },
      });
      const events = handle.events[Symbol.asyncIterator]();

      await expect(events.next()).resolves.toEqual({
        done: false,
        value: { type: 'session_started', sessionId: 'codex-thread-interrupted' },
      });
      await streamIsWaiting;

      handle.send('Queued follow-up');
      await handle.interrupt();

      await expect(events.next()).resolves.toMatchObject({
        done: false,
        value: { type: 'turn_failed', fatal: true },
      });
      await expect(events.next()).resolves.toEqual({ done: true, value: undefined });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(runStreamed).toHaveBeenCalledTimes(1);

      handle.send('Prompt after fatal failure');
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(runStreamed).toHaveBeenCalledTimes(1);

      await handle.dispose();
    });
  });
});
