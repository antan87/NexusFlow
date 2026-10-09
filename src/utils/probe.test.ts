import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

import { PROBE_TIMEOUT_MS, probeCommand } from './probe.js';

vi.mock('execa');

describe('probeCommand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('bounds every probe and reports success', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

    await expect(probeCommand('tool', ['--version'], { shell: false })).resolves.toBe('ok');
    expect(execa).toHaveBeenCalledWith('tool', ['--version'], { reject: false, timeout: PROBE_TIMEOUT_MS, shell: false });
  });

  it('distinguishes a command that timed out from one that failed', async () => {
    vi.mocked(execa).mockResolvedValueOnce({ exitCode: undefined, timedOut: true } as any);
    await expect(probeCommand('slow', ['--version'])).resolves.toBe('timed-out');

    vi.mocked(execa).mockResolvedValueOnce({ exitCode: 2 } as any);
    await expect(probeCommand('broken', ['--version'])).resolves.toBe('failed');

    vi.mocked(execa).mockRejectedValueOnce(Object.assign(new Error('spawn missing ENOENT'), { code: 'ENOENT' }));
    await expect(probeCommand('missing', ['--version'])).resolves.toBe('failed');
  });

  it('really stops a command that never answers', async () => {
    const { execa: realExeca } = await vi.importActual<typeof import('execa')>('execa');
    vi.mocked(execa).mockImplementationOnce(((cmd: string, args: string[], opts: object) =>
      realExeca(cmd, args, { ...opts, timeout: 200 })) as any);

    const started = Date.now();
    await expect(probeCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])).resolves.toBe('timed-out');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
