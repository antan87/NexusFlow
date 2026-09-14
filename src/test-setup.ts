import { beforeAll } from 'vitest';

// Load samples after test-module mocks are registered. Domain administration now
// depends on filesystem helpers, which must not be cached ahead of vi.mock().
beforeAll(async () => {
  const { registerSampleDomainPacks } = await import('./core/domain-packs.js');
  registerSampleDomainPacks();
});
