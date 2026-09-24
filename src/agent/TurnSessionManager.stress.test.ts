import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TurnSessionManager, type TurnClient } from './TurnSessionManager.js';
import { EventEmitter } from 'node:events';
import type { ProviderAdapter, AgentHarness } from './ProviderRegistry.js';
import type { NormalizedUsage, NormalizedRemainingQuota } from '../harness/types.js';

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

describe('TurnSessionManager Stress & Adversarial Tests', () => {
  let manager: TurnSessionManager;
  let mockHarness: MockAgentHarness;
  let mockProvider: ProviderAdapter;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new TurnSessionManager();
    mockHarness = new MockAgentHarness();
    mockProvider = {
      id: 'stress-mock-provider',
      name: 'Stress Mock Provider',
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

  describe('Reconnection Replay with Rapid Disconnects & Reconnects', () => {
    it('survives 100 rapid sequential client disconnects and reconnects during an active busy turn with interleaved telemetry', async () => {
      const initialClient: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-reconnect',
        command: 'stress-mock-provider',
        client: initialClient,
        provider: mockProvider,
      });

      // Dispatch a busy turn
      const dispatch = manager.dispatchInput('/ws/stress-reconnect', {
        input: 'Run multi-stage complex refactoring',
        executionProfile: 'workspace-write',
      });
      expect(dispatch.accepted).toBe(true);
      expect(session.isBusy).toBe(true);

      // Pre-seed some telemetry in the busy turn
      mockHarness.emit('data', 'Initializing pipeline...');
      mockHarness.emit('usage', {
        inputTokens: 50_000,
        outputTokens: 1_200,
        cachedInputTokens: 35_000,
        costUsdEstimate: 0.15,
      });
      mockHarness.emit('approval_request', {
        requestId: 'req-perm-1',
        tool: 'git',
        input: { args: ['push', '--force'] },
        description: 'Force push branch',
      });
      mockHarness.emit('quota', {
        tokens: { unit: 'tokens', remaining: 4_500_000, limit: 5_000_000, status: 'ok' },
        planType: 'per-token',
      });

      // Rapidly disconnect and reconnect 100 different clients
      let currentClient = initialClient;
      for (let i = 1; i <= 100; i++) {
        // Disconnect previous
        manager.unregisterClient('/ws/stress-reconnect', currentClient);

        // Every 10 iterations, harness emits more data or a usage update while disconnected/reconnecting
        if (i % 10 === 0) {
          mockHarness.emit('data', `Stream chunk at iteration ${i}`);
          mockHarness.emit('usage', {
            inputTokens: 10_000,
            outputTokens: 500,
            cachedInputTokens: 8_000,
            costUsdEstimate: 0.03,
          });
        }

        // New client reconnects
        const receivedMessages: string[] = [];
        const nextClient: TurnClient = {
          send: (d) => receivedMessages.push(d),
        };

        const reconnected = await manager.startSession({
          workspaceCwd: '/ws/stress-reconnect',
          command: 'stress-mock-provider',
          client: nextClient,
          provider: mockProvider,
        });

        expect(reconnected).toBe(session);
        expect(reconnected.isBusy).toBe(true);
        expect(mockHarness.stopped).toBe(false);

        // Verify message protocol order:
        // Message 0 MUST be 'usage_summary'
        const parsedMsgs = receivedMessages.map((m) => JSON.parse(m));
        expect(parsedMsgs[0].type).toBe('usage_summary');
        expect(parsedMsgs[0].cumulative.inputTokens).toBe(session.cumulativeUsage.inputTokens);
        expect(parsedMsgs[0].cumulative.outputTokens).toBe(session.cumulativeUsage.outputTokens);
        expect(parsedMsgs[0].quota).toBeDefined();

        // Message 1 MUST be status: busy
        expect(parsedMsgs[1]).toEqual({ type: 'status', state: 'busy' });

        // Subsequent messages MUST contain all bufferedTurnEvents in sequence
        const eventTypes = parsedMsgs.slice(2).map((m) => m.type);
        expect(eventTypes).toContain('stream');
        expect(eventTypes).toContain('usage');
        expect(eventTypes).toContain('quota');
        expect(eventTypes).toContain('approval_request');

        currentClient = nextClient;
      }

      // Ensure that disconnectTimer was cleared upon reconnection
      expect(session.disconnectTimer).toBeNull();

      // Finally end the turn
      mockHarness.emit('idle');
      expect(session.isBusy).toBe(false);
      expect(session.bufferedTurnEvents).toHaveLength(0);
      expect(session.pendingApprovals.size).toBe(0);

      // Reconnect after turn idle
      const postIdleMessages: string[] = [];
      const postIdleClient: TurnClient = { send: (d) => postIdleMessages.push(d) };
      await manager.startSession({
        workspaceCwd: '/ws/stress-reconnect',
        command: 'stress-mock-provider',
        client: postIdleClient,
        provider: mockProvider,
      });

      const parsedPostIdle = postIdleMessages.map((m) => JSON.parse(m));
      expect(parsedPostIdle[0].type).toBe('usage_summary');
      expect(parsedPostIdle[0].cumulative.inputTokens).toBe(session.cumulativeUsage.inputTokens);
      expect(parsedPostIdle[1]).toEqual({ type: 'status', state: 'idle' });
      // No buffered events replayed when idle
      expect(parsedPostIdle).toHaveLength(2);
    });

    it('isolates broken or throwing client sockets without terminating broadcasts to other live clients', async () => {
      const deadClient: TurnClient = {
        send: () => {
          throw new Error('EPIPE: Broken pipe / socket closed abruptly');
        },
      };
      const liveMessages: string[] = [];
      const liveClient: TurnClient = {
        send: (data) => liveMessages.push(data),
      };

      await manager.startSession({
        workspaceCwd: '/ws/dead-socket-test',
        command: 'stress-mock-provider',
        client: deadClient,
        provider: mockProvider,
      });

      await manager.startSession({
        workspaceCwd: '/ws/dead-socket-test',
        command: 'stress-mock-provider',
        client: liveClient,
        provider: mockProvider,
      });

      manager.dispatchInput('/ws/dead-socket-test', {
        input: 'Test broadcast resilience',
        executionProfile: 'workspace-write',
      });

      // Emit usage event — deadClient will throw inside broadcast()
      expect(() => {
        mockHarness.emit('usage', { inputTokens: 100, outputTokens: 50 });
      }).not.toThrow();

      // Live client must have received the usage broadcast despite dead client throwing
      const parsed = liveMessages.map((m) => JSON.parse(m));
      const usageBroadcast = parsed.find((m) => m.type === 'usage');
      expect(usageBroadcast).toBeDefined();
      expect(usageBroadcast.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });
  });

  describe('Cumulative Token Accumulation under Extreme Metrics and High Turn Counts', () => {
    it('accurately accumulates metrics across 100 distinct turns with millions of tokens, mixed cache breakdowns, and micro costs', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-100-turns',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      let expectedInput = 0;
      let expectedOutput = 0;
      let expectedCached = 0;
      let expectedCacheRead = 0;
      let expectedCacheWrite = 0;
      let expectedReasoning = 0;
      let expectedCost = 0;

      for (let turn = 1; turn <= 100; turn++) {
        manager.dispatchInput('/ws/stress-100-turns', {
          input: `Turn ${turn}`,
          executionProfile: 'workspace-write',
        });

        // Generate diverse metrics for each turn
        const inTok = 500_000 + turn * 1_000;
        const outTok = 50_000 + turn * 100;
        const cRead = turn % 2 === 0 ? 200_000 + turn * 500 : undefined;
        const cWrite = turn % 3 === 0 ? 50_000 + turn * 200 : undefined;
        const cached = (cRead ?? 0) + (cWrite ?? 0);
        const reasoning = turn % 4 === 0 ? 20_000 + turn * 50 : undefined;
        const cost = 0.0035 + (turn * 0.0001);

        expectedInput += inTok;
        expectedOutput += outTok;
        expectedCached += cached;
        if (cRead !== undefined) expectedCacheRead += cRead;
        if (cWrite !== undefined) expectedCacheWrite += cWrite;
        if (reasoning !== undefined) expectedReasoning += reasoning;
        expectedCost += cost;

        const quotaWindowRemaining = Math.max(0, 10_000_000 - expectedInput);
        const quotaStatus = quotaWindowRemaining < 1_000_000 ? 'approaching_limit' : 'ok';

        const usageData: NormalizedUsage = {
          inputTokens: inTok,
          outputTokens: outTok,
          cachedInputTokens: cached > 0 ? cached : undefined,
          cacheReadInputTokens: cRead,
          cacheWriteInputTokens: cWrite,
          reasoningOutputTokens: reasoning,
          costUsdEstimate: cost,
          costConfidence: 'estimated',
          remainingQuota: {
            tokens: {
              unit: 'tokens',
              remaining: quotaWindowRemaining,
              limit: 10_000_000,
              status: quotaStatus,
            },
          },
        };

        mockHarness.emit('usage', usageData);
        mockHarness.emit('idle');
      }

      // Assert cumulative results
      expect(session.cumulativeUsage.inputTokens).toBe(expectedInput);
      expect(session.cumulativeUsage.outputTokens).toBe(expectedOutput);
      expect(session.cumulativeUsage.totalTokens).toBe(expectedInput + expectedOutput);
      expect(session.cumulativeUsage.cachedInputTokens).toBe(expectedCached);
      expect(session.cumulativeUsage.cacheReadInputTokens).toBe(expectedCacheRead);
      expect(session.cumulativeUsage.cacheWriteInputTokens).toBe(expectedCacheWrite);
      expect(session.cumulativeUsage.reasoningOutputTokens).toBe(expectedReasoning);
      expect(session.cumulativeUsage.costUsdEstimate).toBeCloseTo(expectedCost, 4);
      expect(session.cumulativeUsage.costConfidence).toBe('estimated');

      // Verify scale (millions of tokens accumulated safely without overflow or NaN)
      expect(session.cumulativeUsage.inputTokens).toBeGreaterThan(50_000_000);
      expect(session.cumulativeUsage.totalTokens).toBeGreaterThan(55_000_000);
      expect(Number.isFinite(session.cumulativeUsage.inputTokens)).toBe(true);
      expect(Number.isFinite(session.cumulativeUsage.outputTokens)).toBe(true);
      expect(Number.isFinite(session.cumulativeUsage.costUsdEstimate!)).toBe(true);

      // Verify latest quota is retained
      expect(session.latestQuota?.tokens?.remaining).toBe(Math.max(0, 10_000_000 - expectedInput));
    });

    it('handles near Number.MAX_SAFE_INTEGER token counts gracefully', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-huge-numbers',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      const hugeInput = 4_000_000_000_000_000; // 4 quadrillion
      const hugeOutput = 2_000_000_000_000_000; // 2 quadrillion

      manager.dispatchInput('/ws/stress-huge-numbers', { input: 'Big', executionProfile: 'workspace-write' });
      mockHarness.emit('usage', {
        inputTokens: hugeInput,
        outputTokens: hugeOutput,
        cachedInputTokens: hugeInput / 2,
      });
      mockHarness.emit('idle');

      expect(session.cumulativeUsage.inputTokens).toBe(hugeInput);
      expect(session.cumulativeUsage.outputTokens).toBe(hugeOutput);
      expect(session.cumulativeUsage.totalTokens).toBe(hugeInput + hugeOutput);
      expect(session.cumulativeUsage.totalTokens).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });

    it('resiliently handles empty, missing, or malformed usage payloads without throwing or poisoning cumulative counts with NaN', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-malformed-usage',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      manager.dispatchInput('/ws/stress-malformed-usage', { input: 'Test', executionProfile: 'workspace-write' });

      // Valid turn first
      mockHarness.emit('usage', { inputTokens: 100, outputTokens: 50, costUsdEstimate: 0.01 });

      // Malformed emissions: undefined, null, non-number tokens
      expect(() => {
        mockHarness.emit('usage', undefined);
        mockHarness.emit('usage', null);
        mockHarness.emit('usage', {});
        mockHarness.emit('usage', { inputTokens: '1000' as any, outputTokens: null as any });
        mockHarness.emit('usage', { costUsdEstimate: 'expensive' as any });
      }).not.toThrow();

      // Cumulative should not be NaN
      expect(session.cumulativeUsage.inputTokens).toBe(100);
      expect(session.cumulativeUsage.outputTokens).toBe(50);
      expect(session.cumulativeUsage.totalTokens).toBe(150);
      expect(session.cumulativeUsage.costUsdEstimate).toBe(0.01);
      expect(Number.isNaN(session.cumulativeUsage.inputTokens)).toBe(false);
      expect(Number.isNaN(session.cumulativeUsage.costUsdEstimate!)).toBe(false);
    });
  });

  describe('Memory Draining and Buffer Lifecycle Bounding', () => {
    it('buffers up to 10,000 turn events during a heavy busy turn and strictly drains buffer on turn completion', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-buffer-drain',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      manager.dispatchInput('/ws/stress-buffer-drain', { input: 'Stream 10k events', executionProfile: 'workspace-write' });
      expect(session.isBusy).toBe(true);

      // Emit 10,000 stream events + 500 intermediate usage events
      for (let i = 0; i < 10_000; i++) {
        mockHarness.emit('data', `chunk-${i}`);
        if (i % 20 === 0) {
          mockHarness.emit('usage', { inputTokens: 1, outputTokens: 1 });
        }
      }

      // Check bufferedTurnEvents size
      expect(session.bufferedTurnEvents.length).toBe(10_000 + 500);

      // Reconnect a client mid-turn: must replay all 10,500 events without crash or stack overflow
      const replayedMessages: string[] = [];
      const reconnectClient: TurnClient = { send: (d) => replayedMessages.push(d) };

      await manager.startSession({
        workspaceCwd: '/ws/stress-buffer-drain',
        command: 'stress-mock-provider',
        client: reconnectClient,
        provider: mockProvider,
      });

      // 1 usage_summary + 1 status:busy + 10,500 buffered events = 10,502 messages
      expect(replayedMessages.length).toBe(10_502);

      // End turn
      mockHarness.emit('idle');
      expect(session.isBusy).toBe(false);
      // STRICT DRAIN VERIFICATION: buffer must be completely cleared
      expect(session.bufferedTurnEvents).toHaveLength(0);
      expect(session.bufferedTurnEvents).toEqual([]);
    });

    it('drains bufferedTurnEvents and settles turnGate immediately on agent error', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-error-drain',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      manager.dispatchInput('/ws/stress-error-drain', { input: 'Error test', executionProfile: 'workspace-write' });
      expect(session.isBusy).toBe(true);

      mockHarness.emit('data', 'Working...');
      mockHarness.emit('usage', { inputTokens: 50, outputTokens: 10 });
      expect(session.bufferedTurnEvents.length).toBe(2);

      // Agent throws/emits error
      mockHarness.emit('error', new Error('Harness process crashed with SIGSEGV'));

      // Buffer must be cleared immediately, busy status cleared, turnGate settled
      expect(session.isBusy).toBe(false);
      expect(session.bufferedTurnEvents).toHaveLength(0);
      expect(session.turnGate.isActive()).toBe(false);

      // Verify that next turn can be dispatched immediately without being blocked
      const nextTurn = manager.dispatchInput('/ws/stress-error-drain', {
        input: 'Recovered turn',
        executionProfile: 'workspace-write',
      });
      expect(nextTurn.accepted).toBe(true);
    });

    it('prevents disconnectTimer leaks across rapid disconnect/reconnect cycles', async () => {
      const client: TurnClient = { send: vi.fn() };
      const session = await manager.startSession({
        workspaceCwd: '/ws/stress-timer-leaks',
        command: 'stress-mock-provider',
        client,
        provider: mockProvider,
      });

      manager.dispatchInput('/ws/stress-timer-leaks', { input: 'Run long task', executionProfile: 'workspace-write' });

      for (let i = 0; i < 20; i++) {
        // Disconnect
        manager.unregisterClient('/ws/stress-timer-leaks', client);
        expect(session.disconnectTimer).not.toBeNull();

        // Reconnect before timeout fires
        await manager.startSession({
          workspaceCwd: '/ws/stress-timer-leaks',
          command: 'stress-mock-provider',
          client,
          provider: mockProvider,
        });
        expect(session.disconnectTimer).toBeNull();
      }

      // Fast forward 15 minutes: session must NOT have been killed by lingering timers
      vi.advanceTimersByTime(900_000);
      expect(mockHarness.stopped).toBe(false);
      expect(manager.getSession('/ws/stress-timer-leaks')).toBeDefined();
    });

    it('maintains strict isolation between multiple concurrent workspaces under high usage load', async () => {
      const harnessA = new MockAgentHarness();
      const harnessB = new MockAgentHarness();

      const providerA: ProviderAdapter = { ...mockProvider, createInstance: () => harnessA };
      const providerB: ProviderAdapter = { ...mockProvider, createInstance: () => harnessB };

      const clientA: TurnClient = { send: vi.fn() };
      const clientB: TurnClient = { send: vi.fn() };

      const sessionA = await manager.startSession({
        workspaceCwd: '/ws/repo-a',
        command: 'stress-mock-provider',
        client: clientA,
        provider: providerA,
      });

      const sessionB = await manager.startSession({
        workspaceCwd: '/ws/repo-b',
        command: 'stress-mock-provider',
        client: clientB,
        provider: providerB,
      });

      // Interleave turns between repo A and repo B
      manager.dispatchInput('/ws/repo-a', { input: 'Turn A', executionProfile: 'workspace-write' });
      manager.dispatchInput('/ws/repo-b', { input: 'Turn B', executionProfile: 'workspace-write' });

      harnessA.emit('usage', { inputTokens: 50_000, outputTokens: 10_000 });
      harnessB.emit('usage', { inputTokens: 100_000, outputTokens: 20_000 });

      harnessA.emit('data', 'Repo A data');
      harnessB.emit('data', 'Repo B data');

      expect(sessionA.cumulativeUsage.inputTokens).toBe(50_000);
      expect(sessionA.cumulativeUsage.outputTokens).toBe(10_000);
      expect(sessionB.cumulativeUsage.inputTokens).toBe(100_000);
      expect(sessionB.cumulativeUsage.outputTokens).toBe(20_000);

      expect(sessionA.bufferedTurnEvents).toHaveLength(2);
      expect(sessionB.bufferedTurnEvents).toHaveLength(2);

      // Finish A, keep B busy
      harnessA.emit('idle');
      expect(sessionA.isBusy).toBe(false);
      expect(sessionA.bufferedTurnEvents).toHaveLength(0);
      expect(sessionB.isBusy).toBe(true);
      expect(sessionB.bufferedTurnEvents).toHaveLength(2);

      // Finish B
      harnessB.emit('idle');
      expect(sessionB.isBusy).toBe(false);
      expect(sessionB.bufferedTurnEvents).toHaveLength(0);
    });

    it('cleans up and resets turn state when provider/command is swapped on the same workspace', async () => {
      const harnessOld = new MockAgentHarness();
      const harnessNew = new MockAgentHarness();

      const providerOld: ProviderAdapter = { ...mockProvider, id: 'prov-old', createInstance: () => harnessOld };
      const providerNew: ProviderAdapter = { ...mockProvider, id: 'prov-new', createInstance: () => harnessNew };

      const client: TurnClient = { send: vi.fn() };

      const sessionOld = await manager.startSession({
        workspaceCwd: '/ws/swap-test',
        command: 'prov-old',
        client,
        provider: providerOld,
      });

      manager.dispatchInput('/ws/swap-test', { input: 'Old turn', executionProfile: 'workspace-write' });
      harnessOld.emit('usage', { inputTokens: 500, outputTokens: 100 });
      expect(sessionOld.cumulativeUsage.inputTokens).toBe(500);

      // Swapping command should stop old agent and create new session
      const sessionNew = await manager.startSession({
        workspaceCwd: '/ws/swap-test',
        command: 'prov-new',
        client,
        provider: providerNew,
      });

      expect(harnessOld.stopped).toBe(true);
      expect(sessionNew).not.toBe(sessionOld);
      expect(sessionNew.cumulativeUsage.inputTokens).toBe(0); // Brand new session counters
      expect(sessionNew.isBusy).toBe(false);
      expect(sessionNew.bufferedTurnEvents).toHaveLength(0);
    });
  });
});

