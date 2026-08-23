import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import { getAdapter } from '../harness/index.js';
import type { HarnessAdapter, SessionHandle } from '../harness/interface.js';
import type { NormalizedUsage } from '../harness/types.js';
import type { AgentExecutionProfile, AgentHarness } from './ProviderRegistry.js';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import { CodexSdkAdapter } from './CodexSdkAdapter.js';
import { acquireLock, type ReleaseLock } from '../core/locks.js';

export interface TeamAgentSpec {
  id: string;
  name: string;
  role: 'lead' | 'researcher' | 'developer' | 'reviewer';
  vendor?: 'claude-code' | 'codex';
  executionProfile?: AgentExecutionProfile;
  prompt: string;
  worktreePath?: string;
}

export interface AgentExecutionStatus {
  id: string;
  name: string;
  role: string;
  vendor: 'claude-code' | 'codex';
  sessionId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  usage?: NormalizedUsage;
  error?: string;
}

export interface MultiAgentOrchestratorOptions {
  claudeAdapterFactory?: () => AgentHarness;
  codexAdapterFactory?: () => AgentHarness;
}

export interface TeamworkResult {
  workspacePath: string;
  agents: AgentExecutionStatus[];
  totalUsage: NormalizedUsage;
}

/**
 * Multi-Agent Orchestrator (Phase 3).
 *
 * Coordinates concurrent agents across Claude and Codex harnesses:
 * - Claude: Programmatic subagent definitions or isolated SDK sessions with independent UUIDs.
 * - Codex: Orchestrator-level thread fan-out with independent thread sessions.
 * - Concurrency: Enforces workspace mutation locks and worktree branch isolation to prevent file clobbering.
 */
export class MultiAgentOrchestrator extends EventEmitter {
  private readonly workspacePath: string;
  private readonly options?: MultiAgentOrchestratorOptions;
  private readonly runningHandles: Map<string, SessionHandle | any> = new Map();
  private isInterrupted = false;

  constructor(workspacePath: string, options?: MultiAgentOrchestratorOptions) {
    super();
    this.workspacePath = workspacePath;
    this.options = options;
  }

  async runTeam(specs: TeamAgentSpec[]): Promise<TeamworkResult> {
    if (!specs || specs.length < 2) {
      throw new Error('Teamwork orchestration requires at least 2 agents (e.g. Lead Planner + Developer).');
    }

    // Verify unique agent IDs
    const idSet = new Set<string>();
    for (const spec of specs) {
      if (idSet.has(spec.id)) {
        throw new Error(`Duplicate agent ID detected in teamwork spec: "${spec.id}"`);
      }
      idSet.add(spec.id);
    }

    const statuses: Map<string, AgentExecutionStatus> = new Map();
    for (const spec of specs) {
      statuses.set(spec.id, {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        vendor: spec.vendor ?? 'claude-code',
        status: 'pending',
      });
    }

    // Enforce workspace-level mutation lock across concurrent agents in the same workspace root
    let releaseMutationLock: ReleaseLock | null = null;
    const isSharedWorktree = specs.every(s => !s.worktreePath || s.worktreePath === this.workspacePath);
    if (isSharedWorktree) {
      const lockPath = path.join(this.workspacePath, '.nexusflow-mutation.lock');
      releaseMutationLock = await acquireLock(lockPath, {
        staleMs: 60_000,
        timeoutMs: 10_000,
        timeoutMessage: 'Could not acquire multi-agent workspace mutation lock.',
      });
    }

    try {
      // Fan out agents concurrently with independent session contexts
      const promises = specs.map((spec) => this.executeAgent(spec, statuses));
      await Promise.allSettled(promises);
    } finally {
      if (releaseMutationLock) {
        await releaseMutationLock();
      }
    }

    const results = Array.from(statuses.values());
    const totalUsage = this.aggregateUsage(results);

    return {
      workspacePath: this.workspacePath,
      agents: results,
      totalUsage,
    };
  }

  async interruptAll(): Promise<void> {
    this.isInterrupted = true;
    const interrupts: Promise<void>[] = [];
    for (const handle of this.runningHandles.values()) {
      if (typeof handle.interrupt === 'function') {
        interrupts.push(handle.interrupt());
      } else if (typeof handle.stop === 'function') {
        handle.stop();
      }
    }
    await Promise.allSettled(interrupts);
  }

  private async executeAgent(
    spec: TeamAgentSpec,
    statuses: Map<string, AgentExecutionStatus>,
  ): Promise<void> {
    const status = statuses.get(spec.id)!;
    status.status = 'running';
    const targetCwd = spec.worktreePath ?? this.workspacePath;
    const vendor = spec.vendor ?? 'claude-code';

    if (this.isInterrupted) {
      status.status = 'cancelled';
      return;
    }

    const adapter = vendor === 'codex'
      ? (this.options?.codexAdapterFactory ? this.options.codexAdapterFactory() : new CodexSdkAdapter())
      : (this.options?.claudeAdapterFactory ? this.options.claudeAdapterFactory() : new ClaudeSdkAdapter());
    this.runningHandles.set(spec.id, adapter);

    try {
      await new Promise<void>((resolve, reject) => {
        adapter.on('session', (sessionId: string) => {
          status.sessionId = sessionId;
          this.emit('agent_session', { agentId: spec.id, sessionId });
        });

        adapter.on('usage', (usage: NormalizedUsage) => {
          status.usage = usage;
          this.emit('agent_usage', { agentId: spec.id, usage });
        });

        adapter.on('error', (err: Error) => {
          status.error = err.message;
        });

        adapter.on('idle', () => {
          status.status = 'completed';
          resolve();
        });

        adapter.on('close', () => {
          if (status.status === 'running') {
            status.status = this.isInterrupted ? 'cancelled' : 'completed';
          }
          resolve();
        });

        void (async () => {
          try {
            await adapter.start(targetCwd);
            await adapter.send(spec.prompt, spec.executionProfile ?? 'review');
          } catch (err: any) {
            status.status = 'failed';
            status.error = err.message;
            reject(err);
          }
        })();
      });
    } catch (err: any) {
      status.status = 'failed';
      status.error = err.message;
    } finally {
      this.runningHandles.delete(spec.id);
    }
  }

  private aggregateUsage(statuses: AgentExecutionStatus[]): NormalizedUsage {
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens: number | undefined = undefined;
    let costUsdEstimate: number | undefined = undefined;

    for (const status of statuses) {
      if (status.usage) {
        inputTokens += status.usage.inputTokens ?? 0;
        outputTokens += status.usage.outputTokens ?? 0;
        if (status.usage.cachedInputTokens !== undefined) {
          cachedInputTokens = (cachedInputTokens ?? 0) + status.usage.cachedInputTokens;
        }
        if (status.usage.costUsdEstimate !== undefined) {
          costUsdEstimate = (costUsdEstimate ?? 0) + status.usage.costUsdEstimate;
        }
      }
    }

    return {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costUsdEstimate,
    };
  }
}
