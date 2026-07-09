export interface ProviderStatus {
  id: string;
  name: string;
  isConfigured: boolean;
  message?: string;
  icon?: string;
}

export interface AgentHarness {
  start(prompt: string | undefined, cwd: string): Promise<void>;
  send(data: string): Promise<void>;
  stop(): void;
  on(event: 'data' | 'diff_proposal' | 'close' | 'error', listener: (...args: any[]) => void): this;
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
