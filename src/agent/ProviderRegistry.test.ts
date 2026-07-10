import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from './ProviderRegistry.js';
import type { ProviderAdapter, AgentHarness } from './ProviderRegistry.js';

class MockAgentHarness implements AgentHarness {
  public started = false;
  async start(cwd: string) {
    this.started = true;
  }
  async send(data: string) {}
  stop() {}
  on(event: string, listener: any) { return this; }
}

// The registry is a shared singleton without a reset method, so each test
// registers its own uniquely-named provider to stay order-independent.
function makeProvider(id: string, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id,
    name: 'Mock',
    isConfigured: () => true,
    getStatusMessage: () => undefined,
    createInstance: () => new MockAgentHarness(),
    ...overrides
  };
}

describe('ProviderRegistry', () => {
  it('should register and retrieve a provider', () => {
    ProviderRegistry.register(makeProvider('mock-retrieve'));

    const retrieved = ProviderRegistry.getProvider('mock-retrieve');
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe('mock-retrieve');
    expect(retrieved?.name).toBe('Mock');
  });

  it('should list all statuses correctly', () => {
    ProviderRegistry.register(makeProvider('mock-unconfigured', {
      name: 'Unconfigured',
      isConfigured: () => false,
      getStatusMessage: () => 'Missing API Key'
    }));

    const statuses = ProviderRegistry.getAllStatus();
    const unconfiguredStatus = statuses.find(s => s.id === 'mock-unconfigured');

    expect(unconfiguredStatus).toBeDefined();
    expect(unconfiguredStatus?.isConfigured).toBe(false);
    expect(unconfiguredStatus?.message).toBe('Missing API Key');
  });

  it('should create an instance correctly', () => {
    ProviderRegistry.register(makeProvider('mock-instance'));

    const provider = ProviderRegistry.getProvider('mock-instance');
    expect(provider).toBeDefined();

    if (provider) {
      const instance = provider.createInstance() as MockAgentHarness;
      expect(instance).toBeDefined();
      expect(instance.started).toBe(false);
      instance.start('/');
      expect(instance.started).toBe(true);
    }
  });
});
