import { describe, expect, it, vi } from 'vitest';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import type { HarnessAdapter, SessionHandle } from '../harness/interface.js';
import type { HarnessEvent } from '../harness/types.js';

function createMockHandle(events: HarnessEvent[], sessionIdVal = '11111111-1111-1111-1111-111111111111'): {
  handle: SessionHandle;
  approvals: Array<{ requestId: string; decision: any }>;
} {
  const approvals: Array<{ requestId: string; decision: any }> = [];
  const handle: SessionHandle = {
    vendor: 'claude-code',
    sessionId: () => Promise.resolve(sessionIdVal),
    events: (async function* () {
      for (const ev of events) {
        yield ev;
      }
    })(),
    send: vi.fn(),
    interrupt: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    respondToApproval: vi.fn((requestId, decision) => {
      approvals.push({ requestId, decision });
    }),
  };
  return { handle, approvals };
}

function createMockAdapter(handle: SessionHandle): HarnessAdapter {
  return {
    vendor: 'claude-code',
    authStatus: vi.fn().mockResolvedValue({ configured: true, method: 'api-key' }),
    start: vi.fn().mockResolvedValue(handle),
    resume: vi.fn().mockResolvedValue(handle),
    listSessions: vi.fn().mockResolvedValue([]),
  };
}

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

  it('deduplicates session ID emissions between promise and session_started event', async () => {
    const sessionId = '12345678-1234-1234-1234-123456789abc';
    const { handle } = createMockHandle([
      { type: 'session_started', sessionId },
      { type: 'text_delta', text: 'Hello' },
      { type: 'turn_completed', usage: { inputTokens: 10, outputTokens: 5 } },
    ], sessionId);

    const mockAdapter = createMockAdapter(handle);
    const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);

    const emittedSessions: string[] = [];
    const usageEvents: any[] = [];
    let idleCount = 0;

    adapter.on('session', (id) => emittedSessions.push(id));
    adapter.on('usage', (usage) => usageEvents.push(usage));
    adapter.on('idle', () => { idleCount++; });

    await adapter.start('C:/test/workspace');
    await adapter.send('Hi');

    await vi.waitFor(() => {
      expect(emittedSessions).toEqual([sessionId]);
      expect(usageEvents).toEqual([{ inputTokens: 10, outputTokens: 5 }]);
      expect(idleCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('enforces tool-class approval gating in workspace-write profile (Issue #173)', async () => {
    const { handle, approvals } = createMockHandle([
      { type: 'approval_required', requestId: 'req-1', tool: 'Edit', input: { path: 'file.ts' } },
      { type: 'approval_required', requestId: 'req-2', tool: 'Write', input: { path: 'new.ts' } },
      { type: 'approval_required', requestId: 'req-3', tool: 'LS', input: { path: '.' } },
      { type: 'approval_required', requestId: 'req-4', tool: 'Bash', input: { command: 'rm -rf /' } },
    ]);

    const mockAdapter = createMockAdapter(handle);
    const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);

    const systemMessages: string[] = [];
    adapter.on('system', (msg) => systemMessages.push(msg));

    await adapter.start('C:/test/workspace');
    await adapter.send('Edit files and run commands', 'workspace-write');

    await vi.waitFor(() => {
      expect(approvals).toHaveLength(4);
    });

    // Allowed file & fs tools
    expect(approvals[0]).toEqual({ requestId: 'req-1', decision: { behavior: 'allow' } });
    expect(approvals[1]).toEqual({ requestId: 'req-2', decision: { behavior: 'allow' } });
    expect(approvals[2]).toEqual({ requestId: 'req-3', decision: { behavior: 'allow' } });
    // Denied shell execution with clear actionable explanation
    expect(approvals[3]).toEqual({
      requestId: 'req-4',
      decision: {
        behavior: 'deny',
        message: "Tool 'Bash' requires approval and is unavailable in embedded chat. Run in CLI or full terminal.",
      },
    });
    expect(systemMessages).toContain("Denied 'Bash' execution: unavailable in embedded chat.");
  });

  it('denies all tool approvals in review execution profile', async () => {
    const { handle, approvals } = createMockHandle([
      { type: 'approval_required', requestId: 'req-1', tool: 'Edit', input: { path: 'file.ts' } },
    ]);

    const mockAdapter = createMockAdapter(handle);
    const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);

    await adapter.start('C:/test/workspace');
    await adapter.send('Edit files', 'review');

    await vi.waitFor(() => {
      expect(approvals).toEqual([
        {
          requestId: 'req-1',
          decision: {
            behavior: 'deny',
            message: 'Action denied: active execution profile is review-only.',
          },
        },
      ]);
    });
  });

  it('emits idle on silent stream termination (prevents turn gate lock)', async () => {
    const { handle } = createMockHandle([
      { type: 'text_delta', text: 'Partial output' },
      // Stream terminates without turn_completed
    ]);

    const mockAdapter = createMockAdapter(handle);
    const adapter = new ClaudeSdkAdapter(undefined, mockAdapter);

    let idleFired = false;
    adapter.on('idle', () => { idleFired = true; });

    await adapter.start('C:/test/workspace');
    await adapter.send('Hi');

    await vi.waitFor(() => {
      expect(idleFired).toBe(true);
    });
  });
});
