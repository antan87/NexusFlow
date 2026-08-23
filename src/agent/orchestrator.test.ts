import { describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { MultiAgentOrchestrator, type TeamAgentSpec } from './orchestrator.js';
import type { AgentHarness } from './ProviderRegistry.js';

class MockHarness extends EventEmitter implements AgentHarness {
  public startedWithCwd = '';
  public sentPrompts: string[] = [];
  public stopped = false;
  private readonly assignedSessionId: string;
  private readonly assignedUsage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  private readonly autoComplete: boolean;
  private readonly failWithError?: string;

  constructor(
    sessionId: string,
    usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
    autoComplete = true,
    failWithError?: string,
  ) {
    super();
    this.assignedSessionId = sessionId;
    this.assignedUsage = usage;
    this.autoComplete = autoComplete;
    this.failWithError = failWithError;
  }

  async start(cwd: string): Promise<void> {
    this.startedWithCwd = cwd;
  }

  async send(prompt: string): Promise<void> {
    this.sentPrompts.push(prompt);
    this.emit('session', this.assignedSessionId);
    if (this.failWithError) {
      setTimeout(() => {
        this.emit('usage', this.assignedUsage);
        this.emit('error', new Error(this.failWithError));
        this.emit('close', 1);
      }, 10);
    } else if (this.autoComplete) {
      setTimeout(() => {
        this.emit('data', `Done: ${prompt}`);
        this.emit('usage', this.assignedUsage);
        this.emit('idle');
      }, 10);
    }
  }

  stop(): void {
    this.stopped = true;
    this.emit('close', 0);
  }
}

describe('MultiAgentOrchestrator (Phase 3)', () => {
  it('throws when less than 2 agents are specified for teamwork', async () => {
    const orchestrator = new MultiAgentOrchestrator('/dev/test-ws');
    await expect(
      orchestrator.runTeam([
        { id: 'lead', name: 'Lead', role: 'lead', prompt: 'Plan work' },
      ]),
    ).rejects.toThrow(/requires at least 2 agents/);
  });

  it('throws when duplicate agent IDs are present in spec', async () => {
    const orchestrator = new MultiAgentOrchestrator('/dev/test-ws');
    await expect(
      orchestrator.runTeam([
        { id: 'agent-1', name: 'Lead', role: 'lead', prompt: 'Plan work' },
        { id: 'agent-1', name: 'Dev', role: 'developer', prompt: 'Write code' },
      ]),
    ).rejects.toThrow(/Duplicate agent ID detected/);
  });

  it('executes >= 2 agents concurrently with independent session contexts and usage aggregation', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-orch-test-'));
    try {
      const claudeMock = new MockHarness('claude-session-uuid-1', {
        inputTokens: 150,
        outputTokens: 50,
        cachedInputTokens: 30,
      });
      const codexMock = new MockHarness('codex-session-uuid-2', {
        inputTokens: 200,
        outputTokens: 75,
        cachedInputTokens: 60,
      });

      const orchestrator = new MultiAgentOrchestrator(tmpDir, {
        claudeAdapterFactory: () => claudeMock,
        codexAdapterFactory: () => codexMock,
      });

      const specs: TeamAgentSpec[] = [
        {
          id: 'planner',
          name: 'Lead Planner',
          role: 'lead',
          vendor: 'claude-code',
          prompt: 'Analyze repos and create implementation plan',
        },
        {
          id: 'coder',
          name: 'Code Implementer',
          role: 'developer',
          vendor: 'codex',
          prompt: 'Implement test and features in repo',
        },
      ];

      const result = await orchestrator.runTeam(specs);

      expect(result.workspacePath).toBe(tmpDir);
      expect(result.agents).toHaveLength(2);
      expect(result.success).toBe(true);
      expect(result.partialSuccess).toBe(false);

      // Verify independent session IDs
      expect(result.agents[0]!.id).toBe('planner');
      expect(result.agents[0]!.sessionId).toBe('claude-session-uuid-1');
      expect(result.agents[0]!.status).toBe('completed');

      expect(result.agents[1]!.id).toBe('coder');
      expect(result.agents[1]!.sessionId).toBe('codex-session-uuid-2');
      expect(result.agents[1]!.status).toBe('completed');

      // Verify total usage aggregation
      expect(result.totalUsage).toEqual({
        inputTokens: 350,
        outputTokens: 125,
        cachedInputTokens: 90,
        costUsdEstimate: undefined,
      });

      // Verify lock was released after run
      const lockPath = path.join(tmpDir, '.nexusflow-mutation.lock');
      await expect(fs.stat(lockPath)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('interrupts all running agents on interruptAll()', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-orch-abort-'));
    try {
      const mockHarness1 = new MockHarness('agent-1-uuid', { inputTokens: 10, outputTokens: 10 }, false);
      const mockHarness2 = new MockHarness('agent-2-uuid', { inputTokens: 10, outputTokens: 10 }, false);

      const orchestrator = new MultiAgentOrchestrator(tmpDir, {
        claudeAdapterFactory: () => mockHarness1,
        codexAdapterFactory: () => mockHarness2,
      });

      const specs: TeamAgentSpec[] = [
        {
          id: 'agent-1',
          name: 'Agent 1',
          role: 'lead',
          vendor: 'claude-code',
          prompt: 'Task 1',
        },
        {
          id: 'agent-2',
          name: 'Agent 2',
          role: 'developer',
          vendor: 'codex',
          prompt: 'Task 2',
        },
      ];

      const runPromise = orchestrator.runTeam(specs);
      await vi.waitFor(() => {
        if (mockHarness1.sentPrompts.length === 0 || mockHarness2.sentPrompts.length === 0) {
          throw new Error('Waiting for agents to start');
        }
      });

      await orchestrator.interruptAll();
      const result = await runPromise;

      expect(result.agents).toHaveLength(2);
      expect(mockHarness1.stopped).toBe(true);
      expect(mockHarness2.stopped).toBe(true);
      expect(result.agents[0]!.status).toBe('cancelled');
      expect(result.agents[1]!.status).toBe('cancelled');
      expect(result.success).toBe(false);

      // Verify lock is released and releasable
      const lockPath = path.join(tmpDir, '.nexusflow-mutation.lock');
      await expect(fs.stat(lockPath)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('runs sequential pipeline mode and skips downstream phases if upstream fails', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-orch-pipe-'));
    try {
      const plannerMock = new MockHarness('planner-uuid', { inputTokens: 50, outputTokens: 20 }, true, 'Compilation syntax error in plan');
      const coderMock = new MockHarness('coder-uuid', { inputTokens: 50, outputTokens: 20 });
      const reviewerMock = new MockHarness('reviewer-uuid', { inputTokens: 50, outputTokens: 20 });

      let callCount = 0;
      const orchestrator = new MultiAgentOrchestrator(tmpDir, {
        claudeAdapterFactory: () => {
          callCount++;
          if (callCount === 1) return plannerMock;
          return reviewerMock;
        },
        codexAdapterFactory: () => coderMock,
      });

      const specs: TeamAgentSpec[] = [
        { id: 'plan', name: 'Planner', role: 'lead', vendor: 'claude-code', prompt: 'Plan task' },
        { id: 'impl', name: 'Implementer', role: 'developer', vendor: 'codex', prompt: 'Implement task' },
        { id: 'rev', name: 'Reviewer', role: 'reviewer', vendor: 'claude-code', prompt: 'Review task' },
      ];

      const result = await orchestrator.runTeam(specs, { mode: 'pipeline' });

      expect(result.success).toBe(false);
      expect(result.partialSuccess).toBe(false);
      expect(result.agents[0]!.status).toBe('failed');
      expect(result.agents[0]!.error).toContain('Compilation syntax error');

      // Downstream phases skipped safely
      expect(result.agents[1]!.status).toBe('cancelled');
      expect(result.agents[1]!.error).toContain('Skipped due to upstream phase failure');
      expect(result.agents[2]!.status).toBe('cancelled');
      expect(result.agents[2]!.error).toContain('Skipped due to upstream phase failure');

      expect(coderMock.sentPrompts).toHaveLength(0);
      expect(result.failureReason).toContain('Compilation syntax error');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('reports partialSuccess when some agents succeed and others fail', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-orch-partial-'));
    try {
      const agent1Mock = new MockHarness('agent1-uuid', { inputTokens: 100, outputTokens: 20 }, true);
      const agent2Mock = new MockHarness('agent2-uuid', { inputTokens: 50, outputTokens: 10 }, true, 'Agent 2 network timeout');

      const orchestrator = new MultiAgentOrchestrator(tmpDir, {
        claudeAdapterFactory: () => agent1Mock,
        codexAdapterFactory: () => agent2Mock,
      });

      const specs: TeamAgentSpec[] = [
        { id: 'agent-1', name: 'Agent 1', role: 'lead', vendor: 'claude-code', prompt: 'Task 1' },
        { id: 'agent-2', name: 'Agent 2', role: 'developer', vendor: 'codex', prompt: 'Task 2' },
      ];

      const result = await orchestrator.runTeam(specs, { mode: 'parallel' });

      expect(result.success).toBe(false);
      expect(result.partialSuccess).toBe(true);
      expect(result.agents[0]!.status).toBe('completed');
      expect(result.agents[1]!.status).toBe('failed');
      expect(result.failureReason).toContain('network timeout');
      expect(result.totalUsage.inputTokens).toBe(150);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
