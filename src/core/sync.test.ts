import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncWorkspace } from './sync.js';
import * as workspace from './workspace.js';
import * as workspaceState from './workspace-state.js';
import * as multiGit from '../utils/multi-git.js';
import * as analyzers from '../analyzers/index.js';
import * as generators from '../generators/index.js';
import type { RebaseResult, WorkspaceRepo } from '../utils/multi-git.js';
import type { SyncStatus } from '../types.js';

vi.mock('./workspace.js');
vi.mock('./workspace-state.js');
vi.mock('../utils/multi-git.js');
vi.mock('../analyzers/index.js');
vi.mock('../generators/index.js');

const feature = {
  id: 'feat',
  branchName: 'feat',
  description: 'd',
  repos: ['/ws/a', '/ws/b'],
  assistants: ['claude'],
  workspacePath: '/ws',
  createdAt: '2026-07-04T00:00:00Z',
} as any;

function wsRepo(name: string): WorkspaceRepo {
  return { name, path: `/ws/${name}`, branchName: 'feat', defaultBranch: 'main' };
}

function rebase(status: SyncStatus): RebaseResult {
  return { success: status !== 'conflict' && status !== 'error', status, message: status };
}

describe('syncWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue(feature);
    vi.mocked(workspace.resolveRepoInfos).mockResolvedValue([
      { name: 'a', path: '/ws/a', defaultBranch: 'main' },
      { name: 'b', path: '/ws/b', defaultBranch: 'main' },
    ]);
    vi.mocked(workspaceState.recordRepoSync).mockResolvedValue(undefined as any);
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([wsRepo('a'), wsRepo('b')]);
    vi.mocked(analyzers.analyzeAllReposCached).mockResolvedValue({ analysis: new Map(), analyzed: ['a'], reused: ['b'] } as any);
    vi.mocked(generators.generateContextFiles).mockResolvedValue(undefined);
  });

  it('throws when the workspace manifest is missing', async () => {
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue(null);
    await expect(syncWorkspace('/ws')).rejects.toThrow(/Failed to load workspace configuration/);
  });

  it('classifies per-repo outcomes into counts', async () => {
    vi.mocked(multiGit.rebaseRepo)
      .mockResolvedValueOnce(rebase('conflict'))
      .mockResolvedValueOnce(rebase('error'));

    const report = await syncWorkspace('/ws');

    expect(report.conflictCount).toBe(1);
    expect(report.errorCount).toBe(1);
    expect(report.syncedCount).toBe(0);
    expect(report.repos.map((r) => r.status)).toEqual(['conflict', 'error']);
  });

  it('records each repo sync outcome to workspace state', async () => {
    vi.mocked(multiGit.rebaseRepo).mockResolvedValue(rebase('up-to-date'));

    await syncWorkspace('/ws');

    expect(workspaceState.recordRepoSync).toHaveBeenCalledTimes(2);
    expect(workspaceState.recordRepoSync).toHaveBeenCalledWith('/ws', 'a', expect.objectContaining({ status: 'up-to-date' }));
  });

  it('does not regenerate context when every repo is up to date', async () => {
    vi.mocked(multiGit.rebaseRepo).mockResolvedValue(rebase('up-to-date'));

    const report = await syncWorkspace('/ws');

    expect(report.contextRefreshed).toBe(false);
    expect(analyzers.analyzeAllReposCached).not.toHaveBeenCalled();
    expect(generators.generateContextFiles).not.toHaveBeenCalled();
  });

  it('regenerates context when a repo was rebased', async () => {
    vi.mocked(multiGit.rebaseRepo)
      .mockResolvedValueOnce(rebase('rebased'))
      .mockResolvedValueOnce(rebase('up-to-date'));

    const report = await syncWorkspace('/ws');

    expect(report.contextRefreshed).toBe(true);
    expect(analyzers.analyzeAllReposCached).toHaveBeenCalled();
    expect(generators.generateContextFiles).toHaveBeenCalled();
  });

  it('tolerates a generator failure without failing the sync', async () => {
    vi.mocked(multiGit.rebaseRepo).mockResolvedValue(rebase('rebased'));
    vi.mocked(generators.generateContextFiles).mockRejectedValue(new Error('gen boom'));

    const report = await syncWorkspace('/ws');

    // The rebases already happened; a regen failure just leaves contextRefreshed false.
    expect(report.contextRefreshed).toBe(false);
    expect(report.syncedCount).toBe(2);
  });
});
