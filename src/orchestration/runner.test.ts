import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import * as path from 'node:path';

import { getPm2List, loadRunningState, parsePm2Json } from './runner.js';
import type { RunningState, ServiceConfig } from '../types.js';

vi.mock('node:fs/promises');
vi.mock('execa');

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
      { name: 'nexusflow-feature-a-api', pid: 333, pm2_env: { status: 'online' } },
      { name: 'nexusflow-feature-a-web', pid: 444, pm2_env: { status: 'stopped' } },
    ]);

    expect(runningState?.services).toHaveLength(1);
    expect(runningState?.services[0]?.name).toBe('api');
    expect(runningState?.services[0]?.pid).toBe(333);
    expect(execa).not.toHaveBeenCalled();
  });
});
