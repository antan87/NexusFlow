import { ProviderRegistry, type AgentHarness, type ProviderAdapter, type AgentExecutionProfile } from './ProviderRegistry.js';
import { isValidSessionUuid, type AgentSession } from './session.js';
import type { NormalizedUsage, NormalizedRemainingQuota } from '../harness/types.js';

export interface TurnClient {
  send(data: string): void;
}

/** Per-session admission guard so a second prompt is rejected, never dropped. */
export class AgentTurnGate {
  private active = false;

  public tryBegin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  public settle(): void {
    this.active = false;
  }

  public isActive(): boolean {
    return this.active;
  }
}

export interface TurnSession {
  workspaceCwd: string;
  command: string;
  agent: AgentHarness;
  provider: ProviderAdapter;
  session?: AgentSession;
  turnGate: AgentTurnGate;
  isBusy: boolean;
  bufferedTurnEvents: Array<{ type: string; [key: string]: any }>;
  pendingApprovals: Map<string, any>;
  clients: Set<TurnClient>;
  disconnectTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActiveAt: number;
  cumulativeUsage: NormalizedUsage;
  latestQuota?: NormalizedRemainingQuota;
}

export interface StartSessionOptions {
  workspaceCwd: string;
  command: string;
  client: TurnClient;
  provider: ProviderAdapter;
  session?: AgentSession;
}

/** Validate and dispatch one renderer turn without letting malformed authority reach a harness. */
export function dispatchAgentInput(
  agent: AgentHarness,
  provider: ProviderAdapter,
  payload: { input?: unknown; executionProfile?: unknown },
): string | null {
  if (typeof payload.input !== 'string' || !payload.input.trim()) {
    return 'A non-empty input message is required.';
  }
  const executionProfile = ProviderRegistry.resolveExecutionProfile(provider, payload.executionProfile);
  if (executionProfile === null) {
    return 'Select a supported execution profile before sending this turn.';
  }
  void agent.send(payload.input, executionProfile);
  return null;
}

export class TurnSessionManager {
  private sessions = new Map<string, TurnSession>();
  private pendingStarts = new Map<string, Promise<TurnSession>>();

  public getSession(workspaceCwd: string): TurnSession | undefined {
    return this.sessions.get(workspaceCwd);
  }

  public hasActiveTurn(workspaceCwd: string): boolean {
    const session = this.sessions.get(workspaceCwd);
    return Boolean(session && session.isBusy);
  }

  public getAllSessions(): TurnSession[] {
    return Array.from(this.sessions.values());
  }

  public async startSession(options: StartSessionOptions): Promise<TurnSession> {
    const { workspaceCwd, command, client, provider, session } = options;

    // Check if a startup is already in flight for this workspace
    const inFlight = this.pendingStarts.get(workspaceCwd);
    if (inFlight) {
      const activeSession = await inFlight;
      if (activeSession.command === command) {
        activeSession.clients.add(client);
        client.send(JSON.stringify({
          type: 'usage_summary',
          cumulative: activeSession.cumulativeUsage,
          ...(activeSession.latestQuota ? { quota: activeSession.latestQuota } : {}),
        }));
        if (activeSession.isBusy) {
          client.send(JSON.stringify({ type: 'status', state: 'busy' }));
          for (const evt of activeSession.bufferedTurnEvents) {
            client.send(JSON.stringify(evt));
          }
          for (const approval of activeSession.pendingApprovals.values()) {
            client.send(JSON.stringify({
              type: 'approval_request',
              ...approval,
            }));
          }
        } else {
          client.send(JSON.stringify({ type: 'status', state: 'idle' }));
          if (activeSession.session?.id) {
            client.send(JSON.stringify({ type: 'session', id: activeSession.session.id }));
          }
        }
        return activeSession;
      }
    }

    const existing = this.sessions.get(workspaceCwd);

    if (existing) {
      if (existing.command === command) {
        // Same provider/command: cancel disconnect cleanup if pending
        if (existing.disconnectTimer) {
          clearTimeout(existing.disconnectTimer);
          existing.disconnectTimer = null;
        }
        existing.clients.add(client);

        client.send(JSON.stringify({
          type: 'usage_summary',
          cumulative: existing.cumulativeUsage,
          ...(existing.latestQuota ? { quota: existing.latestQuota } : {}),
        }));

        if (existing.isBusy) {
          // Reconnect to active running turn: replay current state
          client.send(JSON.stringify({ type: 'status', state: 'busy' }));
          for (const evt of existing.bufferedTurnEvents) {
            client.send(JSON.stringify(evt));
          }
          for (const approval of existing.pendingApprovals.values()) {
            client.send(JSON.stringify({
              type: 'approval_request',
              ...approval,
            }));
          }
        } else {
          client.send(JSON.stringify({ type: 'status', state: 'idle' }));
          if (existing.session?.id) {
            client.send(JSON.stringify({ type: 'session', id: existing.session.id }));
          }
        }
        return existing;
      }

      // Provider command changed: stop previous agent and re-initialize
      this.stopSession(workspaceCwd);
    }

    const startPromise = (async () => {
      const startedAgent = provider.createInstance();
      const turnSession: TurnSession = {
        workspaceCwd,
        command,
        agent: startedAgent,
        provider,
        session,
        turnGate: new AgentTurnGate(),
        isBusy: false,
        bufferedTurnEvents: [],
        pendingApprovals: new Map(),
        clients: new Set([client]),
        disconnectTimer: null,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        cumulativeUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
        },
      };

      const broadcast = (data: Record<string, any>) => {
        const msg = JSON.stringify(data);
        for (const c of turnSession.clients) {
          try { c.send(msg); } catch { /* ignore detached socket */ }
        }
      };

    startedAgent.on('data', (text: string) => {
      turnSession.lastActiveAt = Date.now();
      const evt = { type: 'stream', text };
      if (turnSession.isBusy) turnSession.bufferedTurnEvents.push(evt);
      broadcast(evt);
    });

    startedAgent.on('system', (message: string) => {
      turnSession.lastActiveAt = Date.now();
      const evt = { type: 'system', message };
      if (turnSession.isBusy) turnSession.bufferedTurnEvents.push(evt);
      broadcast(evt);
    });

    startedAgent.on('session', (id: string) => {
      if (isValidSessionUuid(id)) {
        turnSession.session = { ...(turnSession.session ?? { resume: true }), id };
        broadcast({ type: 'session', id });
      }
    });

    startedAgent.on('idle', () => {
      turnSession.isBusy = false;
      turnSession.bufferedTurnEvents = [];
      turnSession.pendingApprovals.clear();
      turnSession.turnGate.settle();
      broadcast({ type: 'status', state: 'idle' });

      // If all clients detached while this turn was running, transition from 10m headless watchdog to 2m idle countdown
      if (turnSession.clients.size === 0) {
        if (turnSession.disconnectTimer) {
          clearTimeout(turnSession.disconnectTimer);
        }
        turnSession.disconnectTimer = setTimeout(() => {
          this.stopSession(workspaceCwd);
        }, 120_000);
      }
    });

    startedAgent.on('close', (code: number) => {
      turnSession.turnGate.settle();
      broadcast({ type: 'close', code });
      if (turnSession.disconnectTimer) {
        clearTimeout(turnSession.disconnectTimer);
        turnSession.disconnectTimer = null;
      }
      this.sessions.delete(workspaceCwd);
    });

    startedAgent.on('usage', (usageData: any) => {
      turnSession.lastActiveAt = Date.now();
      const normalizedUsage: NormalizedUsage = usageData?.turn || usageData;
      const quota = usageData?.quota || usageData?.remainingQuota;
      if (quota) {
        turnSession.latestQuota = quota;
      }

      const input = typeof normalizedUsage?.inputTokens === 'number' ? normalizedUsage.inputTokens : 0;
      const output = typeof normalizedUsage?.outputTokens === 'number' ? normalizedUsage.outputTokens : 0;
      const cached = typeof normalizedUsage?.cachedInputTokens === 'number' ? normalizedUsage.cachedInputTokens : 0;
      const cacheRead = typeof normalizedUsage?.cacheReadInputTokens === 'number' ? normalizedUsage.cacheReadInputTokens : undefined;
      const cacheWrite = typeof normalizedUsage?.cacheWriteInputTokens === 'number' ? normalizedUsage.cacheWriteInputTokens : undefined;
      const reasoning = typeof normalizedUsage?.reasoningOutputTokens === 'number' ? normalizedUsage.reasoningOutputTokens : undefined;
      const cost = typeof normalizedUsage?.costUsdEstimate === 'number' ? normalizedUsage.costUsdEstimate : undefined;

      turnSession.cumulativeUsage.inputTokens += input;
      turnSession.cumulativeUsage.outputTokens += output;
      if (cached > 0 || (turnSession.cumulativeUsage.cachedInputTokens ?? 0) > 0) {
        turnSession.cumulativeUsage.cachedInputTokens =
          (turnSession.cumulativeUsage.cachedInputTokens ?? 0) + cached;
      }
      if (cacheRead !== undefined) {
        turnSession.cumulativeUsage.cacheReadInputTokens =
          (turnSession.cumulativeUsage.cacheReadInputTokens ?? 0) + cacheRead;
      }
      if (cacheWrite !== undefined) {
        turnSession.cumulativeUsage.cacheWriteInputTokens =
          (turnSession.cumulativeUsage.cacheWriteInputTokens ?? 0) + cacheWrite;
      }
      if (reasoning !== undefined) {
        turnSession.cumulativeUsage.reasoningOutputTokens =
          (turnSession.cumulativeUsage.reasoningOutputTokens ?? 0) + reasoning;
      }
      if (cost !== undefined) {
        turnSession.cumulativeUsage.costUsdEstimate =
          (turnSession.cumulativeUsage.costUsdEstimate ?? 0) + cost;
        turnSession.cumulativeUsage.costConfidence = normalizedUsage.costConfidence ?? 'estimated';
      }
      turnSession.cumulativeUsage.totalTokens =
        turnSession.cumulativeUsage.inputTokens + turnSession.cumulativeUsage.outputTokens;

      const evt: {
        type: 'usage';
        usage: NormalizedUsage;
        cumulative: NormalizedUsage;
        quota?: NormalizedRemainingQuota;
      } = {
        type: 'usage',
        usage: normalizedUsage,
        cumulative: turnSession.cumulativeUsage,
        ...(turnSession.latestQuota ? { quota: turnSession.latestQuota } : {}),
      };

      if (turnSession.isBusy) {
        turnSession.bufferedTurnEvents.push(evt);
      }
      broadcast(evt);
    });

    startedAgent.on('quota', (quotaData: any) => {
      turnSession.lastActiveAt = Date.now();
      if (quotaData) {
        turnSession.latestQuota = quotaData;
      }
      const evt = {
        type: 'quota',
        quota: turnSession.latestQuota,
      };
      if (turnSession.isBusy) {
        turnSession.bufferedTurnEvents.push(evt);
      }
      broadcast(evt);
    });

    startedAgent.on('approval_request', (approval: any) => {
      turnSession.pendingApprovals.set(approval.requestId, approval);
      const evt = {
        type: 'approval_request',
        requestId: approval.requestId,
        tool: approval.tool,
        input: approval.input,
        description: approval.description,
      };
      if (turnSession.isBusy) turnSession.bufferedTurnEvents.push(evt);
      broadcast(evt);
    });

    startedAgent.on('file_changed', (info: any) => {
      const evt = {
        type: 'file_changed',
        kind: info?.kind,
        paths: info?.paths,
      };
      if (turnSession.isBusy) turnSession.bufferedTurnEvents.push(evt);
      broadcast(evt);
    });

    startedAgent.on('error', (error: Error) => {
      turnSession.isBusy = false;
      turnSession.bufferedTurnEvents = [];
      turnSession.pendingApprovals.clear();
      turnSession.turnGate.settle();
      broadcast({ type: 'error', message: error?.message ?? String(error) });
    });

    try {
      await startedAgent.start(workspaceCwd, session);
      this.sessions.set(workspaceCwd, turnSession);
      return turnSession;
    } catch (err) {
      try {
        startedAgent.stop();
      } catch {
        // ignore
      }
      throw err;
    } finally {
      this.pendingStarts.delete(workspaceCwd);
    }
  })();

  this.pendingStarts.set(workspaceCwd, startPromise);
  return await startPromise;
}

  public dispatchInput(
    workspaceCwd: string,
    payload: { input?: unknown; executionProfile?: unknown; turnId?: string },
  ): { error?: string; accepted?: boolean; rejected?: boolean } {
    const session = this.sessions.get(workspaceCwd);
    if (!session) {
      return { error: 'No active agent session. Please start or reconnect the agent.' };
    }

    if (!session.turnGate.tryBegin()) {
      return { rejected: true };
    }

    session.isBusy = true;
    session.bufferedTurnEvents = [];
    session.pendingApprovals.clear();
    session.lastActiveAt = Date.now();

    const error = dispatchAgentInput(session.agent, session.provider, payload);
    if (error) {
      session.isBusy = false;
      session.turnGate.settle();
      return { error };
    }

    const turnId = isValidSessionUuid(payload.turnId) ? payload.turnId : undefined;
    const broadcast = (data: Record<string, any>) => {
      const msg = JSON.stringify(data);
      for (const c of session.clients) {
        try { c.send(msg); } catch {}
      }
    };

    broadcast({
      type: 'accepted',
      ...(turnId ? { turnId } : {}),
    });
    broadcast({ type: 'status', state: 'busy' });

    return { accepted: true };
  }

  public respondToApproval(
    workspaceCwd: string,
    requestId: string,
    decision: 'allow' | 'deny',
    message?: string,
  ): boolean {
    const session = this.sessions.get(workspaceCwd);
    if (!session) return false;
    session.pendingApprovals.delete(requestId);
    if (typeof session.agent.respondToApproval === 'function') {
      session.agent.respondToApproval(requestId, decision, message);
      return true;
    }
    return false;
  }

  public unregisterClient(workspaceCwd: string, client: TurnClient, idleGraceMs = 120_000): void {
    const session = this.sessions.get(workspaceCwd);
    if (!session) return;
    session.clients.delete(client);

    if (session.clients.size === 0) {
      if (session.isBusy) {
        // Headless turn in progress! Do not interrupt work.
        // Set a 10-minute safety timeout to prevent permanent leaks if harness hangs.
        if (!session.disconnectTimer) {
          session.disconnectTimer = setTimeout(() => {
            this.stopSession(workspaceCwd);
          }, 600_000);
        }
      } else {
        // Idle harness: clean up after idle grace period
        if (!session.disconnectTimer) {
          session.disconnectTimer = setTimeout(() => {
            this.stopSession(workspaceCwd);
          }, idleGraceMs);
        }
      }
    }
  }

  public stopSession(workspaceCwd: string): void {
    this.pendingStarts.delete(workspaceCwd);
    const session = this.sessions.get(workspaceCwd);
    if (!session) return;
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }
    session.turnGate.settle();
    session.isBusy = false;
    session.bufferedTurnEvents = [];
    session.pendingApprovals.clear();
    try {
      session.agent.stop();
    } catch {}
    this.sessions.delete(workspaceCwd);
  }

  public clear(): void {
    this.pendingStarts.clear();
    for (const cwd of this.sessions.keys()) {
      this.stopSession(cwd);
    }
    this.sessions.clear();
  }
}

export const defaultTurnSessionManager = new TurnSessionManager();
