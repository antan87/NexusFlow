import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { refreshWorkspace } from './refresh.js';
import * as workspace from './workspace.js';
import * as analyzers from '../analyzers/index.js';
import * as generators from '../generators/index.js';
import * as handoff from '../commands/handoff.js';

vi.mock('node:fs/promises');
vi.mock('./workspace.js');
vi.mock('../analyzers/index.js');
vi.mock('../generators/index.js');
vi.mock('../commands/handoff.js');

const feature = {
  id: 'feat',
  branchName: 'feat',
  description: 'd',
  repos: ['/ws/a', '/ws/b'],
  assistants: ['claude'],
  workspacePath: '/ws',
  createdAt: '2026-07-04T00:00:00Z',
} as any;

describe('refreshWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue(feature);
    vi.mocked(workspace.resolveRepoInfos).mockResolvedValue([
      { name: 'a', path: '/ws/a', defaultBranch: 'main' },
      { name: 'b', path: '/ws/b', defaultBranch: 'main' },
    ]);
    vi.mocked(analyzers.analyzeAllReposCached).mockResolvedValue({ analysis: new Map(), analyzed: ['a'], reused: ['b'] } as any);
    vi.mocked(generators.generateContextFiles).mockResolvedValue(undefined);
    vi.mocked(handoff.handoffCommand).mockResolvedValue(undefined);
    // No handoff bundle by default.
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
  });

  it('throws when the workspace manifest is missing', async () => {
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue(null);
    await expect(refreshWorkspace('/ws')).rejects.toThrow(/Failed to load workspace configuration/);
  });

  it('passes analyzed/reused through to the report', async () => {
    const report = await refreshWorkspace('/ws');
    expect(report.analyzedRepos).toEqual(['a']);
    expect(report.reusedRepos).toEqual(['b']);
  });

  it('limits map regeneration to changed repos by default', async () => {
    await refreshWorkspace('/ws');
    // 6th arg (changedRepos) is the analyzed list when not forcing.
    expect(generators.generateContextFiles).toHaveBeenCalledWith(
      expect.any(Object), feature.assistants, '/ws', undefined, undefined, ['a'],
    );
  });

  it('passes undefined changed-repos filter when force is set', async () => {
    await refreshWorkspace('/ws', { force: true });
    expect(generators.generateContextFiles).toHaveBeenCalledWith(
      expect.any(Object), feature.assistants, '/ws', undefined, undefined, undefined,
    );
  });

  it('refreshes the handoff bundle when it exists and not baseOnly', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined); // handoff file exists

    const report = await refreshWorkspace('/ws');

    expect(handoff.handoffCommand).toHaveBeenCalledWith('/ws');
    expect(report.refreshedHandoff).toBe(true);
  });

  it('does not touch the handoff bundle when baseOnly', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    const report = await refreshWorkspace('/ws', { baseOnly: true });

    expect(handoff.handoffCommand).not.toHaveBeenCalled();
    expect(report.refreshedHandoff).toBe(false);
  });
});
