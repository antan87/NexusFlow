import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderRegistry } from './ProviderRegistry.js';
import type { ProviderAdapter, AgentHarness } from './ProviderRegistry.js';

class MockAgentHarness implements AgentHarness {
  public started = false;
  async start(prompt: string | undefined, cwd: string) {
    this.started = true;
  }
  async send(data: string) {}
  stop() {}
  on(event: string, listener: any) { return this; }
}

describe('ProviderRegistry', () => {
  beforeEach(() => {
    // We don't have a reset method, but we can verify existing behavior
  });

  it('should register and retrieve a provider', () => {
    const mockProvider: ProviderAdapter = {
      id: 'mock-provider',
      name: 'Mock',
      isConfigured: () => true,
      getStatusMessage: () => undefined,
      createInstance: () => new MockAgentHarness()
    };

    ProviderRegistry.register(mockProvider);

    const retrieved = ProviderRegistry.getProvider('mock-provider');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('mock-provider');
    expect(retrieved?.name).toBe('Mock');
  });

  it('should list all statuses correctly', () => {
    const mockUnconfigured: ProviderAdapter = {
      id: 'mock-unconfigured',
      name: 'Unconfigured',
      isConfigured: () => false,
      getStatusMessage: () => 'Missing API Key',
      createInstance: () => new MockAgentHarness()
    };

    ProviderRegistry.register(mockUnconfigured);

    const statuses = ProviderRegistry.getAllStatus();
    const unconfiguredStatus = statuses.find(s => s.id === 'mock-unconfigured');
    
    expect(unconfiguredStatus).toBeDefined();
    expect(unconfiguredStatus?.isConfigured).toBe(false);
    expect(unconfiguredStatus?.message).toBe('Missing API Key');
  });

  it('should create an instance correctly', () => {
    const provider = ProviderRegistry.getProvider('mock-provider');
    expect(provider).toBeDefined();
    
    if (provider) {
      const instance = provider.createInstance() as MockAgentHarness;
      expect(instance).toBeDefined();
      expect(instance.started).toBe(false);
      instance.start('test', '/');
      expect(instance.started).toBe(true);
    }
  });
});
