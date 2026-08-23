import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';

import { EventEmitter } from 'node:events';

import { CliAdapterBase, killTree } from './CliAdapterBase.js';

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

  it('escalates to child.kill(SIGKILL) when non-detached child survives SIGTERM', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);

    try {
      const child = {
        pid: 7777,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child, { detached: false, gracePeriodMs: 3000 });

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Advance past grace period while process is still alive
      vi.advanceTimersByTime(3000);

      expect(killSpy).toHaveBeenCalledWith(7777, 0);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      killSpy.mockRestore();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('treats EPERM error on process.kill(pid, 0) as alive and escalates to SIGKILL', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
      if (signal === 0) {
        const err = new Error('EPERM') as any;
        err.code = 'EPERM';
        throw err;
      }
      return true as any;
    });

    try {
      const child = {
        pid: 8888,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child, { detached: true, gracePeriodMs: 3000 });

      vi.advanceTimersByTime(3000);

      expect(killSpy).toHaveBeenCalledWith(8888, 0);
      expect(killSpy).toHaveBeenCalledWith(-8888, 'SIGKILL');
    } finally {
      killSpy.mockRestore();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('falls back to child.kill on both SIGTERM and SIGKILL if process-group signaling throws', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: any) => {
      if (pid < 0) {
        const err = new Error('ESRCH') as any;
        err.code = 'ESRCH';
        throw err;
      }
      return true as any;
    });

    try {
      const child = {
        pid: 6543,
        exitCode: null,
        killed: false,
        kill: vi.fn(),
      } as unknown as ChildProcess;

      killTree(child, { detached: true, gracePeriodMs: 3000 });

      // Group signal threw, fallback to child.kill('SIGTERM')
      expect(killSpy).toHaveBeenCalledWith(-6543, 'SIGTERM');
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Grace period expires
      vi.advanceTimersByTime(3000);

      // Liveness probe succeeded, group SIGKILL threw, fallback to child.kill('SIGKILL')
      expect(killSpy).toHaveBeenCalledWith(6543, 0);
      expect(killSpy).toHaveBeenCalledWith(-6543, 'SIGKILL');
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      killSpy.mockRestore();
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});

class FakeStdinStream extends EventEmitter {
  write = vi.fn((_data: any) => {
    // Simulate immediate EPIPE if desired
    return true;
  });
  end = vi.fn();
}

class FakeTestProcess extends EventEmitter {
  stdin = new FakeStdinStream();
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode: number | null = null;
  pid = 12345;
}

class TestStdinAdapter extends CliAdapterBase {
  readonly label = 'TestAdapter';
  readonly binary = 'test-cli';
  protected promptViaStdin = true;
  public fakeProcess = new FakeTestProcess();

  protected buildArgs(_isFirstTurn: boolean, _data: string): string[] {
    return ['--turn'];
  }

  protected spawnProcess(_args: string[]): ChildProcess {
    return this.fakeProcess as unknown as ChildProcess;
  }
}

describe('CliAdapterBase promptViaStdin error handling', () => {
  it('attaches an error handler to stdin and does not crash when stdin emits error', async () => {
    const adapter = new TestStdinAdapter();
    await adapter.start('/fake/cwd');

    let errorEmitted = false;
    adapter.on('error', () => {
      errorEmitted = true;
    });

    await adapter.send('hello world');

    // Verify stdin had error listener attached
    expect(adapter.fakeProcess.stdin.listenerCount('error')).toBeGreaterThan(0);

    // Emitting error on stdin directly should not throw unhandled exception
    expect(() => {
      adapter.fakeProcess.stdin.emit('error', new Error('EPIPE: broken pipe'));
    }).not.toThrow();

    // Settle the process with exit code 1
    adapter.fakeProcess.emit('close', 1);
    expect(errorEmitted).toBe(true);
  });
});

