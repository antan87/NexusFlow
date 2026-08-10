import type { AgentSession } from './session.js';

export interface ProviderStatus {
  id: string;
  name: string;
  isConfigured: boolean;
  message?: string;
  icon?: string;
  accessLabel?: string;
  setupIssue?: ProviderSetupIssue;
  recoveryCommand?: string;
  recoveryLabel?: string;
  capabilities: ProviderCapabilities;
}

export type ProviderSetupIssue = 'missing-cli' | 'signed-out' | 'probe-failed';

export interface ProviderSetupHelp {
  setupIssue: ProviderSetupIssue;
  recoveryCommand: string;
  recoveryLabel: string;
}

export interface ProviderCapabilities {
  transport: 'native-api' | 'cli-print' | 'acp';
  sessionIdentity: 'none' | 'client-assigned' | 'provider-assigned';
  workspaceAccess: 'read-only' | 'workspace-write' | 'harness-managed';
  sessionIdFormat?: 'uuid' | 'opaque';
}

export type AgentEvent = 'data' | 'close' | 'error' | 'system' | 'idle' | 'session';

export interface AgentHarness {
  start(cwd: string, session?: AgentSession): Promise<void>;
  send(data: string): Promise<void>;
  stop(): void;
  on(event: AgentEvent, listener: (...args: any[]) => void): this;
  /**
   * Detaches a listener, so a caller that attaches per operation on a long-lived
   * harness can clean up rather than accumulating listener sets. Satisfied for
   * free by EventEmitter, which every adapter extends.
   *
   * Nothing in this package calls it today — the caller it was added for was the
   * workflow engine — but it belongs on the interface: `on` without `off` makes
   * any repeated use of a harness a leak.
   */
  off(event: AgentEvent, listener: (...args: any[]) => void): this;
}

export interface ProviderAdapter {
  id: string;
  name: string;
  icon?: string;
  accessLabel?: string;
  capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  getStatusMessage(): string | undefined;
  getSetupHelp?(): ProviderSetupHelp | undefined;
  invalidateStatus?(): void;
  createInstance(): AgentHarness;
}

class ProviderRegistryImpl {
  private providers: Map<string, ProviderAdapter> = new Map();
  private lastRefreshCompletedAt: Map<string, number> = new Map();

  register(provider: ProviderAdapter) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  getAllStatus(options: { refreshProviderId?: string } = {}): ProviderStatus[] {
    const providers = Array.from(this.providers.values());
    const refreshProvider = options.refreshProviderId
      ? this.providers.get(options.refreshProviderId)
      : undefined;
    const lastRefresh = options.refreshProviderId
      ? this.lastRefreshCompletedAt.get(options.refreshProviderId) ?? 0
      : 0;
    const shouldRefresh = Boolean(
      refreshProvider?.invalidateStatus
      && Date.now() - lastRefresh >= 1_000,
    );
    if (shouldRefresh) refreshProvider?.invalidateStatus?.();

    const statuses = providers.map(provider => {
      const setup = provider.getSetupHelp?.();
      return {
        id: provider.id,
        name: provider.name,
        icon: provider.icon,
        accessLabel: provider.accessLabel,
        capabilities: provider.capabilities,
        isConfigured: provider.isConfigured(),
        message: provider.getStatusMessage(),
        ...setup,
      };
    });
    // Timestamp after all synchronous probes finish so requests queued during
    // a slow refresh reuse its result instead of immediately spawning again.
    if (shouldRefresh && options.refreshProviderId) {
      this.lastRefreshCompletedAt.set(options.refreshProviderId, Date.now());
    }
    return statuses;
  }
}

export const ProviderRegistry = new ProviderRegistryImpl();
