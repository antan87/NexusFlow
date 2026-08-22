import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';

import { killTree } from './CliAdapterBase.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

describe('killTree', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops when child is null, exited, or has no PID', () => {
    expect(() => killTree(null)).not.toThrow();

    const exitedChild = {
      pid: 1234,
      exitCode: 0,
      killed: true,
      kill: vi.fn(),
    } as unknown as ChildProcess;

    killTree(exitedChild);
    expect(exitedChild.kill).not.toHaveBeenCalled();
  });

  it('spawns taskkill on Windows with windowsHide and proper flags', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32' });

    try {
      const child = {
        pid: 4321,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child);

      expect(childProcess.spawn).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '4321', '/T', '/F'],
        { stdio: 'ignore', windowsHide: true },
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('signals process group with SIGTERM and escalates to SIGKILL if still alive on POSIX when detached', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

    try {
      const child = {
        pid: 5678,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child, { detached: true, gracePeriodMs: 3000 });

      // Initial SIGTERM sent to process group -pid
      expect(killSpy).toHaveBeenCalledWith(-5678, 'SIGTERM');

      // Advance time before grace period — no SIGKILL yet
      vi.advanceTimersByTime(2999);
      expect(killSpy).not.toHaveBeenCalledWith(-5678, 'SIGKILL');

      // Advance past grace period — liveness check (0) followed by SIGKILL
      vi.advanceTimersByTime(1);
      expect(killSpy).toHaveBeenCalledWith(5678, 0);
      expect(killSpy).toHaveBeenCalledWith(-5678, 'SIGKILL');
    } finally {
      killSpy.mockRestore();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('does not escalate to SIGKILL if process has exited during grace period on POSIX', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    let isAlive = true;
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
      if (signal === 0 && !isAlive) {
        const err = new Error('ESRCH') as any;
        err.code = 'ESRCH';
        throw err;
      }
      return true as any;
    });

    try {
      const child = {
        pid: 9999,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child, { detached: false, gracePeriodMs: 3000 });

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Process exits during grace period
      isAlive = false;

      vi.advanceTimersByTime(3000);

      expect(killSpy).toHaveBeenCalledWith(9999, 0);
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');
    } finally {
      killSpy.mockRestore();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
