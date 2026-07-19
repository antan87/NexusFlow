import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';

import { startOrchestrator, stopOrchestrator, orchestratorPm2Name } from './orchestrator.js';
import type { OrchestrationDetection } from '../types.js';

vi.mock('node:fs/promises');
vi.mock('execa');

const WS = '/ws/feature-a';

function compose(): OrchestrationDetection {
  return {
    id: 'docker-compose:docker-compose.yml',
    tool: 'docker-compose',
    configPath: '/ws/feature-a/docker-compose.yml',
    startCommand: 'docker compose ... up -d',
    stopCommand: 'docker compose ... down',
    run: { command: 'docker', args: ['compose', '-f', '/ws/feature-a/docker-compose.yml', 'up', '-d'], cwd: '/ws/feature-a' },
    stopRun: { command: 'docker', args: ['compose', '-f', '/ws/feature-a/docker-compose.yml', 'down'], cwd: '/ws/feature-a' },
    mode: 'oneshot',
  };
}

function tilt(): OrchestrationDetection {
  return {
    id: 'tilt:Tiltfile',
    tool: 'tilt',
    configPath: '/ws/feature-a/Tiltfile',
    startCommand: 'tilt up',
    stopCommand: 'Stopped via NexusFlow',
    run: { command: 'tilt', args: ['up', '--file', '/ws/feature-a/Tiltfile'], cwd: '/ws/feature-a' },
    stopRun: { command: 'tilt', args: ['down', '--file', '/ws/feature-a/Tiltfile'], cwd: '/ws/feature-a' },
    mode: 'pm2',
  };
}

describe('orchestrator runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
    vi.mocked(fs.unlink).mockResolvedValue(undefined as any);
  });

  it('starts a one-shot compose tool by executing the structured run (no shell) and records state', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const running = await startOrchestrator(compose(), WS, '/logs');

    expect(running.mode).toBe('oneshot');
    expect(running.pm2Name).toBeUndefined();
    expect(vi.mocked(execa).mock.calls[0]).toEqual([
      'docker',
      ['compose', '-f', '/ws/feature-a/docker-compose.yml', 'up', '-d'],
      { cwd: '/ws/feature-a', shell: false },
    ]);
    const written = JSON.parse(vi.mocked(fs.writeFile).mock.calls.at(-1)?.[1] as string);
    expect(written.orchestrators[0].id).toBe('docker-compose:docker-compose.yml');
  });

  it('wraps a pm2-mode tool under a PM2 app named orch-<tool>', async () => {
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const running = await startOrchestrator(tilt(), WS, '/logs');

    expect(running.pm2Name).toBe(orchestratorPm2Name(WS, 'tilt'));
    // pm2 delete (idempotent) then pm2 start with the orch app name.
    const startCall = vi.mocked(execa).mock.calls.find((c) => (c[1] as string[] | undefined)?.includes('start'));
    expect(startCall?.[1] as string[]).toContain(orchestratorPm2Name(WS, 'tilt'));
  });

  it('stops a one-shot tool by running stopRun and clearing state', async () => {
    // State currently has the compose orchestrator recorded.
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        workspacePath: WS,
        services: [],
        orchestrators: [{ id: 'docker-compose:docker-compose.yml', tool: 'docker-compose', configPath: 'x', mode: 'oneshot', startedAt: 'x' }],
        updatedAt: 'x',
      }) as any,
    );
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    await stopOrchestrator(compose(), WS);

    expect(vi.mocked(execa).mock.calls[0]).toEqual([
      'docker',
      ['compose', '-f', '/ws/feature-a/docker-compose.yml', 'down'],
      { cwd: '/ws/feature-a', shell: false, reject: false },
    ]);
    // No services and no orchestrators left → state file removed.
    expect(fs.unlink).toHaveBeenCalled();
  });
});
