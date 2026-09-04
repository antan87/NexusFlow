import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnSessionManager, type TurnClient } from './TurnSessionManager.js';
import { EventEmitter } from 'node:events';
import type { ProviderAdapter, AgentHarness } from './ProviderRegistry.js';

class MockAgentHarness extends EventEmitter implements AgentHarness {
  public started = false;
  public stopped = false;
  public cwd = '';
  public lastInput = '';
  public lastProfile?: any;
  public approvalDecisions: Array<{ requestId: string; decision: string; message?: string }> = [];

  async start(cwd: string) {
    this.started = true;
    this.cwd = cwd;
  }

  async send(data: string, profile?: any) {
    this.lastInput = data;
    this.lastProfile = profile;
  }

  respondToApproval(requestId: string, decision: 'allow' | 'deny', message?: string) {
    this.approvalDecisions.push({ requestId, decision, message });
  }

  stop() {
    this.stopped = true;
  }
}

describe('TurnSessionManager', () => {
  let manager: TurnSessionManager;
  let mockHarness: MockAgentHarness;
  let mockProvider: ProviderAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TurnSessionManager();
    mockHarness = new MockAgentHarness();
    mockProvider = {
      id: 'mock-provider',
      name: 'Mock Provider',
      capabilities: {
        transport: 'sdk',
        sessionIdentity: 'provider-assigned',
        workspaceAccess: 'workspace-write',
      },
      executionProfiles: [
        { id: 'workspace-write', label: 'Write', description: 'Write files' },
        { id: 'review', label: 'Review', description: 'Review only' },
      ],
      isConfigured: () => true,
      getStatusMessage: () => 'Ready',
      createInstance: () => mockHarness,
    };
  });

  afterEach(() => {
    manager.clear();
    vi.useRealTimers();
  });

  it('starts a new session and broadcasts events to connected clients', async () => {
    const messages: string[] = [];
    const client: TurnClient = {
      send: (data) => messages.push(data),
    };

    const session = await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client,
      provider: mockProvider,
    });

    expect(session.isBusy).toBe(false);
    expect(mockHarness.started).toBe(true);
    expect(mockHarness.cwd).toBe('/ws/repo1');

    mockHarness.emit('data', 'hello chunk');
    expect(messages).toHaveLength(1);
    expect(JSON.parse(messages[0])).toEqual({ type: 'stream', text: 'hello chunk' });

    mockHarness.emit('system', 'test note');
    expect(JSON.parse(messages[1])).toEqual({ type: 'system', message: 'test note' });

    mockHarness.emit('usage', { inputTokens: 10, outputTokens: 20 });
    expect(JSON.parse(messages[2])).toEqual({ type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } });
  });

  it('buffers events during active turn and replays to reconnected client', async () => {
    const client1Msgs: string[] = [];
    const client1: TurnClient = { send: (d) => client1Msgs.push(d) };

    await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client: client1,
      provider: mockProvider,
    });

    // Start a turn
    const dispatch = manager.dispatchInput('/ws/repo1', {
      input: 'Run task',
      executionProfile: 'workspace-write',
    });
    expect(dispatch.accepted).toBe(true);

    // Harness streams data and asks for tool approval
    mockHarness.emit('data', 'Thinking...');
    mockHarness.emit('approval_request', {
      requestId: 'req-1',
      tool: 'bash',
      input: { command: 'rm -rf' },
      description: 'Dangerous',
    });
    mockHarness.emit('file_changed', { kind: 'modify', paths: ['src/index.ts'] });

    // Client 1 disconnects
    manager.unregisterClient('/ws/repo1', client1);
    expect(mockHarness.stopped).toBe(false); // Does NOT kill agent while busy!

    // Client 2 connects to the active turn
    const client2Msgs: string[] = [];
    const client2: TurnClient = { send: (d) => client2Msgs.push(d) };

    const reconnected = await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client: client2,
      provider: mockProvider,
    });

    expect(reconnected.isBusy).toBe(true);
    const parsed = client2Msgs.map((m) => JSON.parse(m));
    expect(parsed).toEqual(
      expect.arrayContaining([
        { type: 'status', state: 'busy' },
        { type: 'stream', text: 'Thinking...' },
        expect.objectContaining({ type: 'approval_request', requestId: 'req-1', tool: 'bash' }),
        { type: 'file_changed', kind: 'modify', paths: ['src/index.ts'] },
      ]),
    );

    // Client 2 responds to approval
    const handled = manager.respondToApproval('/ws/repo1', 'req-1', 'allow');
    expect(handled).toBe(true);
    expect(mockHarness.approvalDecisions).toEqual([
      { requestId: 'req-1', decision: 'allow', message: undefined },
    ]);
  });

  it('rejects concurrent turn when session is already busy', async () => {
    const client: TurnClient = { send: () => {} };
    await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client,
      provider: mockProvider,
    });

    const first = manager.dispatchInput('/ws/repo1', {
      input: 'Task 1',
      executionProfile: 'workspace-write',
    });
    expect(first.accepted).toBe(true);

    const second = manager.dispatchInput('/ws/repo1', {
      input: 'Task 2',
      executionProfile: 'workspace-write',
    });
    expect(second.rejected).toBe(true);

    // Turn completes
    mockHarness.emit('idle');
    expect(manager.getSession('/ws/repo1')?.isBusy).toBe(false);

    // Now second turn can be dispatched
    const third = manager.dispatchInput('/ws/repo1', {
      input: 'Task 3',
      executionProfile: 'workspace-write',
    });
    expect(third.accepted).toBe(true);
  });

  it('stops idle session after grace period when all clients disconnect', async () => {
    const client: TurnClient = { send: () => {} };
    await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client,
      provider: mockProvider,
    });

    manager.unregisterClient('/ws/repo1', client, 5000);
    expect(mockHarness.stopped).toBe(false);

    // Fast-forward past idle timeout
    vi.advanceTimersByTime(5001);
    expect(mockHarness.stopped).toBe(true);
    expect(manager.getSession('/ws/repo1')).toBeUndefined();
  });

  it('stops session immediately upon stopSession', async () => {
    const client: TurnClient = { send: () => {} };
    await manager.startSession({
      workspaceCwd: '/ws/repo1',
      command: 'mock-provider',
      client,
      provider: mockProvider,
    });

    manager.stopSession('/ws/repo1');
    expect(mockHarness.stopped).toBe(true);
    expect(manager.getSession('/ws/repo1')).toBeUndefined();
  });

  it('serializes concurrent startSession calls without creating duplicate agents for the same workspace', async () => {
    let startCallCount = 0;
    const delayedHarness = new MockAgentHarness();
    const delayedProvider: ProviderAdapter = {
      ...mockProvider,
      createInstance: () => {
        startCallCount++;
        return delayedHarness;
      },
    };

    let finishStart!: () => void;
    delayedHarness.start = () => new Promise<void>((resolve) => {
      finishStart = resolve;
    });

    const clientA: TurnClient = { send: vi.fn() };
    const clientB: TurnClient = { send: vi.fn() };

    // Launch two startSession calls simultaneously for the same workspace
    const pA = manager.startSession({
      workspaceCwd: '/ws/repo-concurrent',
      command: 'mock-provider',
      client: clientA,
      provider: delayedProvider,
    });
    const pB = manager.startSession({
      workspaceCwd: '/ws/repo-concurrent',
      command: 'mock-provider',
      client: clientB,
      provider: delayedProvider,
    });

    // Before startup resolves, createInstance should only have been called ONCE
    expect(startCallCount).toBe(1);

    // Resolve startup
    finishStart();

    const [sessionA, sessionB] = await Promise.all([pA, pB]);

    // Both should receive the exact same session instance
    expect(sessionA).toBe(sessionB);
    expect(startCallCount).toBe(1);
    expect(sessionA.clients.has(clientA)).toBe(true);
    expect(sessionA.clients.has(clientB)).toBe(true);
  });
});
