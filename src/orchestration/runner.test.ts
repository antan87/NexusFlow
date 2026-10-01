import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import { execa } from 'execa';
import * as path from 'node:path';

import {
  getPm2List,
  loadRunningState,
  parsePm2Json,
  pm2AppName,
  pm2Prefix,
  serviceExecutable,
  serviceLogFile,
  showLogs,
  startService,
  startServices,
  stopService,
  stopServices,
} from './runner.js';
import type { RunningState, ServiceConfig } from '../types.js';
import { findExecutable } from '../utils/user-paths.js';

vi.mock('node:fs/promises');
vi.mock('execa');
vi.mock('../utils/user-paths.js', () => ({ findExecutable: vi.fn(() => '/usr/bin/npm') }));

function service(name: string, cwd: string): ServiceConfig {
  return {
    name,
    command: 'npm',
    args: ['run', 'dev'],
    cwd,
    source: 'manual',
  };
}

describe('orchestration runner PM2 state handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parsePm2Json', () => {
    it('parses clean PM2 JSON output', () => {
      expect(parsePm2Json('[{"name":"api"}]')).toEqual([{ name: 'api' }]);
    });

    it('extracts the JSON array when npx emits preamble output', () => {
      const output = 'npm warn exec installing pm2\n[{"name":"api","pid":123}]\n';

      expect(parsePm2Json(output)).toEqual([{ name: 'api', pid: 123 }]);
    });

    it('returns an empty list for invalid output', () => {
      expect(parsePm2Json('not json')).toEqual([]);
    });
  });

  it('getPm2List uses the defensive parser and returns an empty list on failure', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce({ stdout: 'noise\n[{"name":"api"}]' } as any)
      .mockRejectedValueOnce(new Error('pm2 unavailable'));

    await expect(getPm2List()).resolves.toEqual([{ name: 'api' }]);
    await expect(getPm2List()).resolves.toEqual([]);
  });

  it('loadRunningState can use a pre-fetched PM2 list without spawning PM2 per workspace', async () => {
    const workspacePath = path.join(process.cwd(), 'feature-a');
    const state: RunningState = {
      workspacePath,
      services: [
        {
          name: 'api',
          pid: 111,
          config: service('api', workspacePath),
          startedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          name: 'web',
          pid: 222,
          config: service('web', workspacePath),
          startedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);

    const runningState = await loadRunningState(workspacePath, [
      { name: pm2AppName(workspacePath, 'api'), pid: 333, pm2_env: { status: 'online' } },
      { name: pm2AppName(workspacePath, 'web'), pid: 444, pm2_env: { status: 'stopped' } },
    ]);

    expect(runningState?.services).toHaveLength(1);
    expect(runningState?.services[0]?.name).toBe('api');
    expect(runningState?.services[0]?.pid).toBe(333);
    expect(execa).not.toHaveBeenCalled();
  });

  it('loadRunningState keeps one-shot orchestrators (no PM2 app to verify)', async () => {
    const workspacePath = path.join(process.cwd(), 'feature-b');
    const state: RunningState = {
      workspacePath,
      services: [],
      orchestrators: [
        { id: 'docker-compose:docker-compose.yml', tool: 'docker-compose', configPath: 'x', mode: 'oneshot', startedAt: '2026-01-01T00:00:00.000Z' },
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);

    const running = await loadRunningState(workspacePath, []);
    expect(running?.orchestrators).toHaveLength(1);
    expect(running?.orchestrators?.[0]?.tool).toBe('docker-compose');
  });

  it('loadRunningState drops pm2-mode orchestrators whose PM2 app is offline, keeps online ones', async () => {
    const workspacePath = path.join(process.cwd(), 'feature-c');
    const state: RunningState = {
      workspacePath,
      services: [],
      orchestrators: [
        { id: 'tilt:a/Tiltfile', tool: 'tilt', configPath: 'a/Tiltfile', mode: 'pm2', pm2Name: 'contextspace-feature-c-orch-tilt-a-tiltfile', logName: 'orch-tilt-a-tiltfile', startedAt: 'x' },
        { id: 'makefile:b/Makefile', tool: 'makefile', configPath: 'b/Makefile', mode: 'pm2', pm2Name: 'contextspace-feature-c-orch-makefile-b-makefile', logName: 'orch-makefile-b-makefile', startedAt: 'x' },
      ],
      updatedAt: 'x',
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);

    const running = await loadRunningState(workspacePath, [
      { name: 'contextspace-feature-c-orch-tilt-a-tiltfile', pm2_env: { status: 'online' } },
      { name: 'contextspace-feature-c-orch-makefile-b-makefile', pm2_env: { status: 'errored' } },
    ]);

    // The errored makefile orchestrator is dropped; the online tilt one stays.
    expect(running?.orchestrators?.map((o) => o.tool)).toEqual(['tilt']);
  });

  describe('per-service lifecycle', () => {
    it('pm2AppName and serviceLogFile derive workspace-scoped names', () => {
      const ws = path.join(process.cwd(), 'my-ws');
      expect(pm2AppName(ws, 'api')).toMatch(/^ctxspace-my-ws-[0-9a-f]{8}-api$/);
      expect(serviceLogFile('/logs', 'api')).toBe(path.join('/logs', 'api.log'));
    });

    it('startService deletes any existing app, starts PM2, resolves the PID and upserts state', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const expectedApp = pm2AppName(ws, 'api');
      // fs: mkdir (log dir), then mutateRunningState reads (ENOENT) + writes.
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any) // pm2 delete
        .mockResolvedValueOnce({ stdout: '' } as any) // pm2 start
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: expectedApp, pid: 4321, pm2_env: { status: 'online' } }]) } as any); // pm2 jlist

      const running = await startService(service('api', ws), ws, '/logs');

      expect(running).toEqual({ name: 'api', status: 'running', pid: 4321 });
      const calls = vi.mocked(execa).mock.calls;
      expect(calls[0]).toEqual(['npx', ['pm2', 'delete', expectedApp], { reject: false }]);
      expect(calls[1]?.[1]).toContain('start');
      expect(calls[1]?.[1]).toContain(expectedApp);
      // State written with the running service.
      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls.at(-1)?.[1] as string);
      expect(written.services.map((s: any) => s.name)).toEqual(['api']);
    });

    it('startService reports and records a failure when PM2 has no running process for it', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const expectedApp = pm2AppName(ws, 'api');
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any)
        .mockResolvedValueOnce({ stdout: '' } as any)
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: expectedApp, pid: 0, pm2_env: { status: 'errored' } }]) } as any);

      const result = await startService(service('api', ws), ws, '/logs');
      expect(result).toMatchObject({ name: 'api', status: 'failed', reason: expect.stringContaining('status: errored') });
      const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls.at(-1)?.[1] as string);
      expect(written.services).toEqual([]);
      expect(written.failures).toEqual([expect.objectContaining({ name: 'api', reason: result.reason })]);
    });

    it('does not hand a service to PM2 when its program is missing, and says which one', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      vi.mocked(findExecutable).mockReturnValueOnce(null);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      const declared: ServiceConfig = { ...service('app/worker', ws), command: '/bin/sh', args: ['-c', 'PORT=1 exec honcho start'], source: 'procfile', declared: true, declaredIn: { file: 'Procfile.dev', line: 2 }, display: 'PORT=1 exec honcho start' };

      const result = await startService(declared, ws, '/logs');
      expect(findExecutable).toHaveBeenLastCalledWith('honcho', process.env);
      expect(result).toMatchObject({ status: 'failed', reason: '"honcho" was not found on PATH. Install it, or change the command in Procfile.dev line 2.' });
      expect(execa).not.toHaveBeenCalled();
    });

    it('reports an occupied port before starting, but a restart skips that check', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const holder = net.createServer().listen(0, '127.0.0.1');
      await new Promise((resolve) => holder.once('listening', resolve));
      const port = (holder.address() as net.AddressInfo).port;
      try {
        vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
        vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
        vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
        const web = { ...service('web', ws), port };
        const result = await startService(web, ws, '/logs');
        expect(result).toMatchObject({ status: 'failed', reason: `Port ${port} is already in use by another process. Stop that process, or change the port.` });
        expect(execa).not.toHaveBeenCalled();

        vi.mocked(execa)
          .mockResolvedValueOnce({ stdout: '' } as any)
          .mockResolvedValueOnce({ stdout: '' } as any)
          .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: pm2AppName(ws, 'web'), pid: 9, pm2_env: { status: 'online' } }]) } as any);
        await expect(startService(web, ws, '/logs', { restart: true })).resolves.toMatchObject({ status: 'running' });
      } finally {
        holder.close();
      }
    });

    it('startServices keeps going after a failure and returns one result per service', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      vi.mocked(findExecutable).mockReturnValueOnce(null);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: '' } as any)
        .mockResolvedValueOnce({ stdout: '' } as any)
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: pm2AppName(ws, 'api'), pid: 5, pm2_env: { status: 'online' } }]) } as any);

      const results = await startServices([service('broken', ws), service('api', ws)], ws, '/logs');
      expect(results.map((r) => [r.name, r.status])).toEqual([['broken', 'failed'], ['api', 'running']]);
    });

    it('finds the program behind Procfile assignments and prefixes, and skips shell builtins', () => {
      const line = (display: string): ServiceConfig => ({ ...service('x', '/w'), source: 'procfile', display });
      expect(serviceExecutable(line('PORT=3000 NODE_ENV=dev exec node server.js'))).toBe('node');
      expect(serviceExecutable(line('env FOO=1 "./bin/web" --flag'))).toBe('./bin/web');
      expect(serviceExecutable(line('cd api && npm run dev'))).toBeUndefined();
      expect(serviceExecutable(service('y', '/w'))).toBe('npm');
    });

    it('stopService deletes the PM2 app and removes it from state', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const expectedApp = pm2AppName(ws, 'api');
      const state: RunningState = {
        workspacePath: ws,
        services: [{ name: 'api', pid: 1, config: service('api', ws), startedAt: 'x' }],
        updatedAt: 'x',
      };
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: expectedApp }]) } as any) // jlist
        .mockResolvedValueOnce({ stdout: '' } as any); // pm2 delete
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);
      vi.mocked(fs.unlink).mockResolvedValue(undefined as any);

      expect(await stopService(ws, 'api')).toBe(true);
      expect(vi.mocked(execa).mock.calls[1]).toEqual(['npx', ['pm2', 'delete', expectedApp], { reject: false }]);
      // Services now empty → state file removed.
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('stopService retains service in runningState and returns false when PM2 delete fails with non-zero exit', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const expectedApp = pm2AppName(ws, 'api');
      const state: RunningState = {
        workspacePath: ws,
        services: [{ name: 'api', pid: 1, config: service('api', ws), startedAt: 'x' }],
        updatedAt: 'x',
      };
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: JSON.stringify([{ name: expectedApp }]) } as any) // jlist
        .mockResolvedValueOnce({ exitCode: 1, failed: true, stdout: '', stderr: 'error' } as any); // pm2 delete fails
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);

      expect(await stopService(ws, 'api')).toBe(false);
      // Service was retained in state — unlink was NOT called.
      expect(fs.unlink).not.toHaveBeenCalled();
    });
  });

  describe('failures beside each service', () => {
    it('loadRunningState reports a recorded service that PM2 no longer runs as stopped unexpectedly', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const state: RunningState = {
        workspacePath: ws,
        services: [
          { name: 'api', pid: 1, config: service('api', ws), startedAt: 'x' },
          { name: 'web', pid: 2, config: service('web', ws), startedAt: 'x', logFile: '/logs/web.log' },
          { name: 'gone', pid: 3, config: service('gone', ws), startedAt: 'x' },
        ],
        failures: [{ name: 'worker', reason: 'Port 5000 is already in use by another process.', at: 'x' }],
        updatedAt: 'x',
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);
      const tail = Buffer.from('starting\nboom: missing DATABASE_URL\n');
      vi.mocked(fs.open).mockResolvedValue({
        stat: async () => ({ size: tail.length }),
        read: async (buffer: Buffer) => { tail.copy(buffer); return { bytesRead: tail.length, buffer }; },
        close: async () => {},
      } as any);
      const list = [
        { name: pm2AppName(ws, 'api'), pid: 11, pm2_env: { status: 'online' } },
        { name: pm2AppName(ws, 'web'), pid: 0, pm2_env: { status: 'errored' } },
      ];

      const loaded = await loadRunningState(ws, list);
      expect(loaded?.services.map((s) => s.name)).toEqual(['api']);
      expect(loaded?.failures).toEqual([
        expect.objectContaining({ name: 'worker', reason: expect.stringContaining('Port 5000') }),
        expect.objectContaining({ name: 'web', reason: 'Stopped unexpectedly (PM2 status: errored). Last output: "boom: missing DATABASE_URL". Start it again when fixed.' }),
        expect.objectContaining({ name: 'gone', reason: expect.stringContaining('no PM2 process remains') }),
      ]);
    });
  });

  describe('workspace ownership', () => {
    it('stop-all deletes only this workspace\'s PM2 apps, even when another workspace name is a prefix of it', async () => {
      const ws = path.join(process.cwd(), 'shop');
      const other = path.join(process.cwd(), 'shop-v2');
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        .mockResolvedValueOnce({ stdout: JSON.stringify([
          { name: pm2AppName(ws, 'api') },
          { name: pm2AppName(other, 'api') },
          { name: pm2AppName(other, 'web') },
        ]) } as any)
        .mockResolvedValue({ stdout: '' } as any);

      await stopServices(ws);

      const deleted = vi.mocked(execa).mock.calls
        .filter((c) => (c[1] as string[] | undefined)?.[1] === 'delete')
        .map((c) => (c[1] as string[])[2]);
      expect(deleted).toEqual([pm2AppName(ws, 'api')]);
    });
  });

  describe('stop-all carve-out', () => {
    it('stops orch-* named services but excludes recorded orchestrator apps', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const prefix = pm2Prefix(ws);
      const orchApp = `${prefix}orch-tilt-tiltfile`;
      const workerApp = `${prefix}orch-worker`;
      const apiApp = `${prefix}api`;
      const state: RunningState = {
        workspacePath: ws,
        services: [],
        orchestrators: [
          { id: 'tilt:Tiltfile', tool: 'tilt', configPath: 'Tiltfile', mode: 'pm2', pm2Name: orchApp, logName: 'orch-tilt-tiltfile', startedAt: 'x' },
        ],
        updatedAt: 'x',
      };
      // readRawRunningState + mutateRunningState both read the state file.
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(fs.unlink).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        // getPm2List (jlist): the real orchestrator, a SERVICE literally named
        // orch-worker, and a plain service.
        .mockResolvedValueOnce({
          stdout: JSON.stringify([
            { name: orchApp },
            { name: workerApp },
            { name: apiApp },
          ]),
        } as any)
        .mockResolvedValue({ stdout: '' } as any); // subsequent pm2 delete calls

      await stopServices(ws);

      const deleted = vi.mocked(execa).mock.calls
        .filter((c) => (c[1] as string[] | undefined)?.[1] === 'delete')
        .map((c) => (c[1] as string[])[2]);
      // The orch-* SERVICE and the plain service are stopped...
      expect(deleted).toContain(workerApp);
      expect(deleted).toContain(apiApp);
      // ...but the recorded orchestrator app is left running.
      expect(deleted).not.toContain(orchApp);
    });

    it('retains services in runningState if PM2 delete fails during stop-all', async () => {
      const ws = path.join(process.cwd(), 'my-ws');
      const prefix = pm2Prefix(ws);
      const apiApp = `${prefix}api`;
      const state: RunningState = {
        workspacePath: ws,
        services: [{ name: 'api', pid: 1, config: service('api', ws), startedAt: 'x' }],
        updatedAt: 'x',
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(state) as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
      vi.mocked(execa)
        .mockResolvedValueOnce({
          stdout: JSON.stringify([{ name: apiApp }]),
        } as any)
        .mockResolvedValueOnce({ exitCode: 1, failed: true, stdout: '', stderr: 'error' } as any); // pm2 delete fails

      await stopServices(ws);

      // Mutated state was written to disk preserving the failed service
      expect(fs.writeFile).toHaveBeenCalled();
      const writtenState = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string);
      expect(writtenState.services).toHaveLength(1);
      expect(writtenState.services[0].name).toBe('api');
    });
  });

  describe('showLogs', () => {
    it('finds and outputs logs from nested service directories', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logDir = path.join(process.cwd(), '.nexusflow-logs');

      // Mock recursive directory entries
      vi.mocked(fs.readdir).mockImplementation(async (dir: any, options?: any) => {
        if (dir === logDir) {
          return [
            { name: 'api.log', isFile: () => true, isDirectory: () => false },
            { name: 'repo-a', isFile: () => false, isDirectory: () => true },
          ] as any;
        }
        if (dir === path.join(logDir, 'repo-a')) {
          return [
            { name: 'nested.log', isFile: () => true, isDirectory: () => false },
          ] as any;
        }
        return [] as any;
      });

      vi.mocked(fs.readFile).mockImplementation(async (filePath: any) => {
        if (filePath.includes('nested.log')) {
          return 'nested service log line 1\nnested service log line 2';
        }
        return 'api service log output';
      });

      await showLogs('/fake/ws', logDir, 10);

      // Verify nested service log was read and formatted
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('repo-a/nested'));
      expect(consoleLogSpy).toHaveBeenCalledWith('nested service log line 1\nnested service log line 2');
      consoleLogSpy.mockRestore();
    });
  });
});

