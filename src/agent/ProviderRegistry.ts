import type { AgentSession } from './session.js';

export interface ProviderStatus {
  id: string;
  name: string;
  isConfigured: boolean;
  message?: string;
  icon?: string;
}

export type AgentEvent = 'data' | 'close' | 'error' | 'system' | 'idle';

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
  isConfigured(): boolean;
  getStatusMessage(): string | undefined;
  createInstance(): AgentHarness;
}

class ProviderRegistryImpl {
  private providers: Map<string, ProviderAdapter> = new Map();

  register(provider: ProviderAdapter) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id: string): ProviderAdapter | undefined {
    return this.providers.get(id);
  }

  getAllStatus(): ProviderStatus[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      isConfigured: p.isConfigured(),
      message: p.getStatusMessage()
    }));
  }
}

export const ProviderRegistry = new ProviderRegistryImpl();
