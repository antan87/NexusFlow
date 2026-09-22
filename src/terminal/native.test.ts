import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { preparePtyHelper } from './native.js';
import { terminatePty, type PtyProcess } from './manager.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('native PTY platform compatibility', () => {
  it.skipIf(process.platform === 'win32')('repairs the shipped Darwin helper execute bits and preserves its contents', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cs-pty-permissions-'));
    const dir = path.join(root, 'prebuilds', 'darwin-arm64'); await mkdir(dir, { recursive: true });
    const helper = path.join(dir, 'spawn-helper'); await writeFile(helper, 'fixture', { mode: 0o644 });
    await preparePtyHelper('linux', root, 'arm64');
    expect((await stat(helper)).mode & 0o111).toBe(0);
    await preparePtyHelper('darwin', root, 'arm64');
    expect((await stat(helper)).mode & 0o777).toBe(0o755);
    expect((await stat(helper)).size).toBe(7);
  });
  it('closes Windows PTYs without an unsupported Unix signal', () => {
    const kill = vi.fn((signal?: string) => { if (signal) throw new Error('Signals not supported on windows.'); });
    terminatePty({ pid: 12345, kill } as unknown as PtyProcess, 'win32');
    expect(kill).toHaveBeenCalledWith(undefined);
  });
});
