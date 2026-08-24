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
  off(event: string, listener: any) { return this; }
}

// The registry is a shared singleton without a reset method, so each test
// registers its own uniquely-named provider to stay order-independent.
function makeProvider(id: string, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id,
    name: 'Mock',
    capabilities: { transport: 'native-api', sessionIdentity: 'none', workspaceAccess: 'read-only' },
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
    expect(unconfiguredStatus?.capabilities.workspaceAccess).toBe('read-only');
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

  it('exposes closed setup recovery metadata and invalidates cached status on refresh', () => {
    let configured = false;
    let invalidations = 0;
    ProviderRegistry.register(makeProvider('mock-refreshable', {
      isConfigured: () => configured,
      getStatusMessage: () => configured ? undefined : 'Sign in.',
      getSetupHelp: () => configured ? undefined : {
        setupIssue: 'signed-out',
        recoveryCommand: 'mock auth login',
        recoveryLabel: 'Copy sign-in command',
      },
      invalidateStatus: () => {
        invalidations += 1;
        configured = true;
      },
    }));

    expect(ProviderRegistry.getAllStatus().find(status => status.id === 'mock-refreshable'))
      .toMatchObject({ isConfigured: false, setupIssue: 'signed-out' });

    expect(ProviderRegistry.getAllStatus({ refreshProviderId: 'mock-refreshable' }).find(status => status.id === 'mock-refreshable'))
      .toMatchObject({ isConfigured: true });
    ProviderRegistry.getAllStatus({ refreshProviderId: 'mock-refreshable' });
    expect(invalidations).toBe(1);
  });

  it('exposes provider-owned execution profiles and validates turn authorization', () => {
    const provider = makeProvider('mock-profiled', {
      executionProfiles: [
        { id: 'review', label: 'Review only', description: 'Read-only.' },
        { id: 'workspace-write', label: 'Edit workspace', description: 'Workspace edits.' },
      ],
      defaultExecutionProfile: 'review',
    });
    ProviderRegistry.register(provider);

    expect(ProviderRegistry.getAllStatus().find(status => status.id === 'mock-profiled'))
      .toMatchObject({
        defaultExecutionProfile: 'review',
        executionProfiles: [
          { id: 'review', label: 'Review only' },
          { id: 'workspace-write', label: 'Edit workspace' },
        ],
      });
    expect(ProviderRegistry.resolveExecutionProfile(provider, 'review')).toBe('review');
    expect(ProviderRegistry.resolveExecutionProfile(provider, 'workspace-write')).toBe('workspace-write');
    expect(ProviderRegistry.resolveExecutionProfile(provider, undefined)).toBeNull();
    expect(ProviderRegistry.resolveExecutionProfile(provider, 'danger-full-access')).toBeNull();
  });

  it('keeps legacy providers profile-free', () => {
    const provider = makeProvider('mock-legacy-profile');
    expect(ProviderRegistry.resolveExecutionProfile(provider, undefined)).toBeUndefined();
    expect(ProviderRegistry.resolveExecutionProfile(provider, 'review')).toBeNull();
  });

  it('exposes provider-owned models and rejects stale renderer selections', () => {
    const models = [
      { id: '', label: 'Automatic', description: 'Provider default.' },
      { id: 'current-model', label: 'Current', description: 'Current model.' },
    ] as const;
    const provider = makeProvider('mock-models', { models });
    ProviderRegistry.register(provider);

    expect(ProviderRegistry.getAllStatus().find(status => status.id === 'mock-models')?.models)
      .toEqual(models);
    expect(ProviderRegistry.resolveModel(provider, undefined)).toBeUndefined();
    expect(ProviderRegistry.resolveModel(provider, '')).toBeUndefined();
    expect(ProviderRegistry.resolveModel(provider, ' current-model ')).toBe('current-model');
    expect(ProviderRegistry.resolveModel(provider, 'retired-model')).toBeNull();
    expect(ProviderRegistry.resolveModel(provider, false)).toBeNull();
  });

  it('keeps custom providers without a catalog open to model overrides', () => {
    const provider = makeProvider('mock-open-models');
    expect(ProviderRegistry.resolveModel(provider, 'gateway/custom-model')).toBe('gateway/custom-model');
  });
});
