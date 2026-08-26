import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncWorkspace } from './sync.js';
import * as workspace from './workspace.js';
import * as workspaceState from './workspace-state.js';
import * as multiGit from '../utils/multi-git.js';
import * as analyzers from '../analyzers/index.js';
import * as generators from '../generators/index.js';
import * as generationLock from './generation-lock.js';
import * as refresh from './refresh.js';
import type { RebaseResult, WorkspaceRepo } from '../utils/multi-git.js';
import type { SyncStatus } from '../types.js';

vi.mock('./workspace.js');
vi.mock('./workspace-state.js');
vi.mock('../utils/multi-git.js');
vi.mock('../analyzers/index.js');
vi.mock('../generators/index.js');
vi.mock('./generation-lock.js');
vi.mock('./refresh.js');

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
    vi.mocked(generationLock.checkGenerationLock).mockResolvedValue({ fresh: true, lock: null, drift: [] });
    vi.mocked(refresh.refreshWorkspace).mockResolvedValue({ workspacePath: '/ws', analyzedRepos: [], reusedRepos: [], refreshedHandoff: false });
  });

  it('throws when the workspace manifest is missing', async () => {
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue(null);
    await expect(syncWorkspace('/ws')).rejects.toThrow(/Failed to load workspace configuration/);
  });

  it('is a no-op for in-place workspaces (never rebases the source repos)', async () => {
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      ...feature,
      mode: 'in-place',
      repos: ['/src/a', '/src/b'],
    });

    const report = await syncWorkspace('/ws');

    expect(multiGit.rebaseRepo).not.toHaveBeenCalled();
    expect(workspaceState.recordRepoSync).not.toHaveBeenCalled();
    expect(report.syncedCount).toBe(0);
    expect(report.conflictCount).toBe(0);
    expect(report.errorCount).toBe(0);
    expect(report.repos.map((r) => r.status)).toEqual(['up-to-date', 'up-to-date']);
    expect(report.repos[0].message).toContain('In-place workspace');
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

  it('reconciles stale generated views even when repos are already current', async () => {
    vi.mocked(multiGit.rebaseRepo).mockResolvedValue(rebase('up-to-date'));
    vi.mocked(generationLock.checkGenerationLock).mockResolvedValue({ fresh: false, lock: null, drift: [{ kind: 'missing-lock', name: 'nexusflow.lock', message: 'missing' }] });
    const report = await syncWorkspace('/ws');
    expect(refresh.refreshWorkspace).toHaveBeenCalledWith('/ws');
    expect(report.contextRefreshed).toBe(true);
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
