import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalManager, type PtyProcess, type TerminalClient } from './manager.js';

function fixture(grace = 5000) {
  let output: (data: string) => void = () => {};
  let exit: (event: { exitCode: number }) => void = () => {};
  const pty = { pid: 123456, write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), kill: vi.fn(), onData: vi.fn(fn => { output = fn; return { dispose() {} }; }), onExit: vi.fn(fn => { exit = fn; return { dispose() {} }; }) } as unknown as PtyProcess;
  const factory = vi.fn(async () => pty), terminate = vi.fn();
  const manager = new TerminalManager(factory, terminate, grace);
  const input = { owner: 'alice', workspace: 'workspace', cwd: '/workspace', target: 'shell', launchId: 'nonce', launch: { file: '/bin/sh', args: [], env: {}, label: 'Shell' } };
  const messages: Record<string, any>[] = [];
  const client: TerminalClient = { send: data => messages.push(JSON.parse(data)), close: vi.fn() };
  return { manager, input, client, factory, pty, terminate, messages, output: (data: string) => output(data), exit: (code: number) => exit({ exitCode: code }) };
}
afterEach(() => vi.useRealTimers());
describe('backend-owned terminals', () => {
  it('makes concurrent duplicate starts idempotent and prevents foreign control', async () => {
    const f = fixture();
    const [a, b] = await Promise.all([f.manager.create(f.input), f.manager.create(f.input)]);
    expect(a.id).toBe(b.id); expect(f.factory).toHaveBeenCalledTimes(1);
    expect(Date.parse(a.startedAt)).not.toBeNaN();
    expect(f.manager.list('alice', 'workspace')[0]?.startedAt).toBe(a.startedAt);
    expect(() => f.manager.attach('bob', 'workspace', a.id, f.client)).toThrow('not found');
    expect(() => f.manager.stop('alice', 'other', a.id)).toThrow('not found');
    expect(f.manager.list('bob', 'workspace')).toEqual([]);
    f.manager.dispose();
  });
  it('preserves process and output through detach/reconnect, with one writer', async () => {
    const f = fixture(); const { id } = await f.manager.create(f.input);
    f.manager.attach('alice', 'workspace', id, f.client);
    const other = { send: vi.fn(), close: vi.fn() };
    f.output('hello'); f.manager.attach('alice', 'workspace', id, other);
    expect(f.client.close).toHaveBeenCalledOnce();
    expect(() => f.manager.control('alice', 'workspace', id, f.client, { type: 'input', data: 'stale' })).toThrow('no longer owns');
    f.manager.detach('alice', 'workspace', id, other); f.output(' while hidden');
    expect(f.terminate).not.toHaveBeenCalled();
    const returned = { send: vi.fn(), close: vi.fn() };
    f.manager.attach('alice', 'workspace', id, returned);
    expect(returned.send.mock.calls.flat().join('')).toContain(' while hidden');
    expect(() => f.manager.control('alice', 'workspace', id, other, { type: 'input', data: 'stale' })).toThrow('no longer owns');
    f.manager.control('alice', 'workspace', id, returned, { type: 'input', data: 'pwd\r' });
    expect(f.pty.write).toHaveBeenCalledWith('pwd\r');
    expect(f.factory).toHaveBeenCalledTimes(1); f.manager.dispose();
  });
  it('bounds replay and pauses a slow client until its output is acknowledged', async () => {
    const f = fixture(); const { id } = await f.manager.create(f.input);
    f.output('x'.repeat(600_000));
    f.manager.attach('alice', 'workspace', id, f.client);
    expect(f.messages[0].truncated).toBe(true);
    const chunks = f.messages.filter(m => m.type === 'output');
    const length = chunks.reduce((n, m) => n + m.data.length, 0);
    expect(length).toBeLessThanOrEqual(512 * 1024); expect(f.pty.pause).toHaveBeenCalledOnce();
    for (const chunk of chunks) f.manager.control('alice', 'workspace', id, f.client, { type: 'ack', count: chunk.data.length });
    expect(f.pty.resume).toHaveBeenCalledOnce();
    expect(() => f.manager.control('alice', 'workspace', id, f.client, { type: 'resize', cols: 999999, rows: -1 })).toThrow();
    expect(() => f.manager.control('alice', 'workspace', id, f.client, { type: 'input', data: 'x'.repeat(20_000) })).toThrow();
    f.manager.dispose();
  });
  it('expires abandoned sessions and terminates live processes on shutdown', async () => {
    vi.useFakeTimers(); const f = fixture(1000); const { id } = await f.manager.create(f.input);
    f.manager.attach('alice', 'workspace', id, f.client); await vi.advanceTimersByTimeAsync(1200);
    expect(f.terminate).not.toHaveBeenCalled();
    f.manager.detach('alice', 'workspace', id, f.client); await vi.advanceTimersByTimeAsync(1200);
    expect(f.terminate).toHaveBeenCalledOnce(); expect(f.manager.list('alice', 'workspace')).toEqual([]);
    await f.manager.create({ ...f.input, launchId: 'second' }); f.manager.dispose(); expect(f.terminate).toHaveBeenCalledTimes(2);
  });
  it('releases failed launches and rejects concurrent resumes by another owner', async () => {
    const f = fixture(); f.factory.mockRejectedValueOnce(new Error('native load failed'));
    await expect(f.manager.create(f.input)).rejects.toThrow('native load');
    await expect(f.manager.create(f.input)).resolves.toHaveProperty('id');
    const resume = { ...f.input, target: 'codex', sessionId: 'saved', launchId: 'resume' };
    const starting = f.manager.create(resume);
    await expect(f.manager.create({ ...resume, owner: 'bob', launchId: 'other' })).rejects.toThrow('already starting');
    const saved = await starting;
    expect((await f.manager.create({ ...resume, launchId: 'again' })).id).toBe(saved.id);
    f.manager.dispose();
  });
  it('does not write to an exited process', async () => {
    const f = fixture(); const { id } = await f.manager.create(f.input); f.manager.attach('alice', 'workspace', id, f.client);
    f.exit(7); expect(f.messages.at(-1)).toMatchObject({ type: 'exit', exitCode: 7 });
    expect(() => f.manager.control('alice', 'workspace', id, f.client, { type: 'input', data: 'lost' })).toThrow('exited');
    f.manager.dispose(); expect(f.terminate).not.toHaveBeenCalled();
  });
});
