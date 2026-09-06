import type * as acp from '@agentclientprotocol/sdk';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  AcpCliAdapter,
  decideReadOnlyPermission,
  isSafeAcpSessionId,
  type AcpConnection,
  type AcpTransportFactory,
} from './AcpCliAdapter.js';
import { buildCopilotAcpArgs, CopilotAcpAdapter } from './CopilotAcpAdapter.js';

const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000';

class FakeChild extends EventEmitter {
  stdin = { end: vi.fn() };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  pid: number | undefined;
}

function makeConnection(overrides: Partial<AcpConnection> = {}): AcpConnection {
  return {
    initialize: vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    }),
    newSession: vi.fn().mockResolvedValue({ sessionId: SESSION_ID }),
    loadSession: vi.fn().mockResolvedValue({}),
    prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    closed: new Promise<void>(() => {}),
    ...overrides,
  };
}

function makeHarness(connection: AcpConnection) {
  const child = new FakeChild();
  let client: acp.Client | undefined;
  const factory: AcpTransportFactory = vi.fn((options) => {
    client = options.client;
    return { process: child as unknown as ChildProcess, connection };
  });
  const harness = new AcpCliAdapter({
    executable: 'copilot',
    args: buildCopilotAcpArgs(),
    label: 'GitHub Copilot CLI',
    loginCommand: 'copilot login',
    validateSessionId: (id) => id === SESSION_ID,
    transportFactory: factory,
  });
  return { harness, child, factory, getClient: () => client! };
}

describe('Copilot ACP profile', () => {
  it('starts stdio ACP with only read/search tools and no remote or MCP surface', () => {
    expect(buildCopilotAcpArgs()).toEqual([
      '--acp',
      '--stdio',
      '--available-tools=view,glob,grep',
      '--disable-builtin-mcps',
      '--no-ask-user',
      '--no-auto-update',
      '--no-remote',
      '--no-remote-export',
    ]);
  });
});

describe('read-only ACP permissions', () => {
  const options: acp.PermissionOption[] = [
    { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
  ];

  it.each(['read', 'search', 'edit', 'delete', 'move', 'execute', 'fetch', 'other'] as const)(
    'rejects every escalated %s operation',
    (kind) => {
      expect(decideReadOnlyPermission({
        sessionId: SESSION_ID,
        toolCall: { toolCallId: 'tool', kind },
        options,
      })).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    },
  );

  it('cancels when the provider offers no policy-compatible option', () => {
    expect(decideReadOnlyPermission({
      sessionId: SESSION_ID,
      toolCall: { toolCallId: 'tool', kind: 'edit' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_always' }],
    })).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('AcpCliAdapter', () => {
  it('exchanges a streamed turn with a real ACP subprocess', async () => {
    const fixturePath = fileURLToPath(new URL('./fixtures/fake-acp-agent.mjs', import.meta.url));
    const harness = new AcpCliAdapter({
      executable: process.execPath,
      args: [fixturePath],
      label: 'Fake ACP',
      validateSessionId: (id) => id === SESSION_ID,
    });
    const output: string[] = [];
    harness.on('data', (text) => output.push(text));

    await harness.start(process.cwd());
    await harness.send('hello');
    harness.stop();

    expect(output).toEqual(['real ACP response']);
  });

  it('creates a provider session and streams only agent text', async () => {
    let client: acp.Client;
    const connection = makeConnection({
      prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
        await client.sessionUpdate({
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'Hello from Copilot' },
          },
        });
        return { stopReason: 'end_turn' };
      }),
    });
    const fixture = makeHarness(connection);
    const sessions: string[] = [];
    const output: string[] = [];
    fixture.harness.on('session', (id) => sessions.push(id));
    fixture.harness.on('data', (text) => output.push(text));

    const start = fixture.harness.start('C:\\workspace');
    client = fixture.getClient();
    await start;
    await fixture.harness.send('Explain this repo');

    expect(sessions).toEqual([SESSION_ID]);
    expect(output).toEqual(['Hello from Copilot']);
    expect(connection.newSession).toHaveBeenCalledWith({ cwd: 'C:\\workspace', mcpServers: [] });
    expect(connection.prompt).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      prompt: [{ type: 'text', text: 'Explain this repo' }],
    });
  });

  it('loads an existing session without replaying its history into the persisted chat', async () => {
    let client: acp.Client;
    const connection = makeConnection({
      loadSession: vi.fn(async () => {
        await client.sessionUpdate({
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'old replayed answer' },
          },
        });
        return {};
      }),
    });
    const fixture = makeHarness(connection);
    const output: string[] = [];
    fixture.harness.on('data', (text) => output.push(text));

    const start = fixture.harness.start('C:\\workspace', { id: SESSION_ID, resume: true });
    client = fixture.getClient();
    await start;

    expect(connection.loadSession).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      cwd: 'C:\\workspace',
      mcpServers: [],
    });
    expect(connection.newSession).not.toHaveBeenCalled();
    expect(output).toEqual([]);
  });

  it('turns ACP authentication failures into login guidance', async () => {
    const connection = makeConnection({
      newSession: vi.fn().mockRejectedValue(new Error('auth_required')),
    });
    const { harness } = makeHarness(connection);
    const errors: string[] = [];
    harness.on('error', (error: Error) => errors.push(error.message));

    await harness.start('C:\\workspace');

    expect(errors).toEqual([
      'GitHub Copilot CLI is not signed in. Run `copilot login` in a terminal, then try again.',
    ]);
  });

  it('rejects invalid provider session ids before exposing them to the renderer', async () => {
    const connection = makeConnection({
      newSession: vi.fn().mockResolvedValue({ sessionId: 'not-the-expected-id' }),
    });
    const { harness } = makeHarness(connection);
    const errors: string[] = [];
    harness.on('error', (error: Error) => errors.push(error.message));

    await harness.start('C:\\workspace');

    expect(errors[0]).toMatch(/invalid session id/i);
  });

  it('handles agent_thought_chunk as active turn activity and streams thought tokens', async () => {
    let client: acp.Client;
    const connection = makeConnection({
      prompt: vi.fn(async (): Promise<acp.PromptResponse> => {
        await client.sessionUpdate({
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            content: { type: 'text', text: 'Thinking about the solution...' },
          },
        });
        return { stopReason: 'end_turn' };
      }),
    });
    const fixture = makeHarness(connection);
    const output: string[] = [];
    const errors: string[] = [];
    fixture.harness.on('data', (text) => output.push(text));
    fixture.harness.on('error', (error: Error) => errors.push(error.message));

    const start = fixture.harness.start('C:\\workspace');
    client = fixture.getClient();
    await start;
    await fixture.harness.send('Think about this');

    expect(output).toEqual(['Thinking about the solution...']);
    expect(errors).toEqual([]);
  });

  it('reports a successful turn with no recognizable message', async () => {
    const { harness } = makeHarness(makeConnection());
    const errors: string[] = [];
    harness.on('error', (error: Error) => errors.push(error.message));
    await harness.start('C:\\workspace');

    await harness.send('Say something');

    expect(errors).toEqual([
      'GitHub Copilot CLI ended without a recognizable response. Update the harness and try again.',
    ]);
  });

  it('cancels the active ACP turn before closing the transport', async () => {
    let finishPrompt!: (response: acp.PromptResponse) => void;
    const connection = makeConnection({
      prompt: vi.fn(() => new Promise<acp.PromptResponse>((resolve) => {
        finishPrompt = resolve;
      })),
    });
    const { harness } = makeHarness(connection);
    await harness.start('C:\\workspace');
    const sending = harness.send('Long task');
    await vi.waitFor(() => expect(connection.prompt).toHaveBeenCalled());

    harness.stop();
    await vi.waitFor(() => expect(connection.cancel).toHaveBeenCalledWith({ sessionId: SESSION_ID }));
    finishPrompt({ stopReason: 'cancelled' });
    await sending;
  });

  it('does not publish idle for a process failure until the active prompt settles', async () => {
    let rejectPrompt!: (error: Error) => void;
    const connection = makeConnection({
      prompt: vi.fn(() => new Promise<acp.PromptResponse>((_resolve, reject) => {
        rejectPrompt = reject;
      })),
    });
    const { harness, child } = makeHarness(connection);
    const errors: string[] = [];
    const idle: number[] = [];
    harness.on('error', (error: Error) => errors.push(error.message));
    harness.on('idle', () => idle.push(1));
    await harness.start('C:\\workspace');
    const sending = harness.send('Long task');
    await vi.waitFor(() => expect(connection.prompt).toHaveBeenCalled());

    child.emit('error', new Error('transport broke'));

    expect(errors).toEqual(['GitHub Copilot CLI failed: transport broke']);
    expect(idle).toEqual([]);

    rejectPrompt(new Error('connection closed'));
    await sending;

    expect(errors).toEqual(['GitHub Copilot CLI failed: transport broke']);
    expect(idle).toHaveLength(1);
  });

  it('emits approval_request and resolves via respondToApproval when listener is attached', async () => {
    const connection = makeConnection();
    const { harness, getClient } = makeHarness(connection);
    await harness.start('C:\\workspace');

    const client = getClient();
    const requests: any[] = [];
    harness.on('approval_request', (req) => {
      requests.push(req);
      harness.respondToApproval(req.requestId, 'allow');
    });

    const permissionPromise = client.requestPermission({
      options: [
        { kind: 'allow_once', optionId: 'opt-allow' },
        { kind: 'reject_once', optionId: 'opt-deny' },
      ],
      toolCall: { title: 'Terminal Command', kind: 'execute' } as any,
    } as any);

    const response = await permissionPromise;
    expect(requests).toHaveLength(1);
    expect(requests[0].tool).toBe('Terminal Command');
    expect(response).toEqual({
      outcome: { outcome: 'selected', optionId: 'opt-allow' },
    });
  });
});

describe('isSafeAcpSessionId', () => {
  it('accepts bounded opaque ids and rejects control characters', () => {
    expect(isSafeAcpSessionId('ses_abc-123')).toBe(true);
    expect(isSafeAcpSessionId('ses_abc\n123')).toBe(false);
    expect(isSafeAcpSessionId('x'.repeat(201))).toBe(false);
  });
});

describe('CopilotAcpAdapter session id validation', () => {
  it('accepts UUID and safe opaque ACP session IDs, rejecting unsafe IDs', () => {
    const adapter = new CopilotAcpAdapter();
    const validate = (adapter as any).options.validateSessionId;
    expect(validate('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(validate('ses_abc-123')).toBe(true);
    expect(validate('session-xyz_999')).toBe(true);
    expect(validate('invalid\nsession')).toBe(false);
    expect(validate('')).toBe(false);
  });
});
