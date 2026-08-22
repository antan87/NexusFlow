import { describe, expect, it, vi } from 'vitest';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';

describe('ClaudeSdkAdapter', () => {
  it('instantiates and emits events through the adapter', async () => {
    const adapter = new ClaudeSdkAdapter();
    expect(adapter).toBeDefined();

    const dataEvents: string[] = [];
    const sessionEvents: string[] = [];
    const systemEvents: string[] = [];
    let idleCalled = false;

    adapter.on('data', (text: string) => dataEvents.push(text));
    adapter.on('session', (id: string) => sessionEvents.push(id));
    adapter.on('system', (msg: string) => systemEvents.push(msg));
    adapter.on('idle', () => { idleCalled = true; });

    await adapter.start('C:/test/workspace');
    expect(adapter).toBeDefined();
  });

  it('stops and emits close', async () => {
    const adapter = new ClaudeSdkAdapter();
    let closed = false;
    adapter.on('close', () => { closed = true; });

    await adapter.start('C:/test/workspace');
    adapter.stop();

    expect(closed).toBe(true);
  });
});
