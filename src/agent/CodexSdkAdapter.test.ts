import { describe, expect, it } from 'vitest';
import { CodexSdkAdapter } from './CodexSdkAdapter.js';

describe('CodexSdkAdapter', () => {
  it('instantiates and manages lifecycle', async () => {
    const adapter = new CodexSdkAdapter();
    expect(adapter).toBeDefined();

    await adapter.start('C:/test/workspace');
    expect(adapter).toBeDefined();

    let closed = false;
    adapter.on('close', () => { closed = true; });
    adapter.stop();
    expect(closed).toBe(true);
  });
});
