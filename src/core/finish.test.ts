import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finishWorkspace } from './finish.js';
import * as status from './status.js';
import * as commit from './commit.js';
import * as multiGit from '../utils/multi-git.js';
import * as pr from '../utils/pr.js';
import * as policy from './progression-policy.js';
import * as workspaceState from './workspace-state.js';
import type { RepoStatusReport, WorkspaceStatusReport } from './status.js';
import type { WorkspaceState } from '../types.js';

vi.mock('./status.js');
vi.mock('./commit.js');
vi.mock('../utils/multi-git.js');
vi.mock('../utils/pr.js');
vi.mock('./workspace-state.js');
vi.mock('./progression-policy.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./progression-policy.js')>()),
  evaluateProgression: vi.fn(),
  recordVerificationOverride: vi.fn(),
}));

const READY = { ready: true, repos: [], blockers: [] };
const STALE = {
  ready: false,
  repos: [{ name: 'api', state: 'stale' as const, ready: false, detail: 'api has changes that were made after it was verified. Verify again.' }],
  blockers: ['api has changes that were made after it was verified. Verify again.'],
};
let state: WorkspaceState;

function repo(overrides: Partial<RepoStatusReport>): RepoStatusReport {
  return {
    name: 'api',
    path: '/ws/api',
    branch: 'feat',
    expectedBranch: 'feat',
    onExpectedBranch: true,
    dirty: false,
    changedFiles: [],
    ahead: 0,
    behind: 0,
    remoteUrl: 'https://github.com/o/api.git',
    defaultBranch: 'main',
    access: 'worktree',
    editable: true,
    sourcePath: '/src/api',
    ...overrides,
  };
}

function report(repos: RepoStatusReport[]): WorkspaceStatusReport {
  return {
    workspacePath: '/ws',
    branchName: 'feat',
    repos,
    allClean: repos.every((r) => !r.dirty),
    allPushed: repos.every((r) => r.ahead === 0),
  };
}

describe('finishWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pr.parseRemoteUrl).mockReturnValue({ host: 'github.com', owner: 'o', repo: 'api', kind: 'github' });
    vi.mocked(pr.buildCompareUrl).mockReturnValue('https://github.com/o/api/compare/main...feat?expand=1');
    vi.mocked(pr.detectGh).mockResolvedValue({ installed: false, authenticated: false });
    vi.mocked(multiGit.pushRepo).mockResolvedValue({ success: true, message: 'pushed' });
    vi.mocked(policy.evaluateProgression).mockResolvedValue(READY);
    state = { workspacePath: '/ws', repos: {}, updatedAt: '' };
    vi.mocked(workspaceState.loadWorkspaceState).mockImplementation(async () => structuredClone(state));
    vi.mocked(workspaceState.mutateWorkspaceState).mockImplementation(async (_path, mutate) => mutate(state));
  });

  it('does nothing to a clean, pushed repo and reports safe to cleanup', async () => {
    const clean = report([repo({ dirty: false, ahead: 0 })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(clean);

    const result = await finishWorkspace('/ws', {});

    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(multiGit.pushRepo).not.toHaveBeenCalled();
    expect(result.safeToCleanup).toBe(true);
    expect(result.repos[0].compareUrl).toContain('/compare/main...feat');
  });

  it('commits a dirty repo when given a message, then pushes', async () => {
    const dirty = report([repo({ dirty: true, ahead: 0 })]);
    const after = report([repo({ dirty: false, ahead: 0 })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValueOnce(dirty).mockResolvedValueOnce(after);
    vi.mocked(commit.commitWorkspace).mockResolvedValue({
      repos: [{ name: 'api', success: true, committed: true, pushed: false, branch: 'feat', commitHash: 'abc1234', filesChanged: 2, message: 'ok' }],
      skipped: [],
      committedCount: 1,
      failedCount: 0,
    });

    const result = await finishWorkspace('/ws', { message: 'wip' });

    expect(commit.commitWorkspace).toHaveBeenCalledWith('/ws', 'wip', { noPush: true, repos: ['api'] });
    expect(multiGit.pushRepo).toHaveBeenCalledWith('/ws/api', 'feat');
    expect(result.repos[0]).toMatchObject({ committed: true, commitHash: 'abc1234', pushed: true });
    expect(result.safeToCleanup).toBe(true);
  });

  it('errors on a dirty repo when no message is provided', async () => {
    const dirty = report([repo({ dirty: true })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(dirty);

    const result = await finishWorkspace('/ws', {});

    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(result.repos[0].error).toMatch(/no commit message/i);
    expect(result.safeToCleanup).toBe(false);
  });

  it('skips a repo checked out on the wrong branch', async () => {
    const wrong = report([repo({ branch: 'main', onExpectedBranch: false, dirty: true })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(wrong);

    const result = await finishWorkspace('/ws', { message: 'wip' });

    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(multiGit.pushRepo).not.toHaveBeenCalled();
    expect(result.repos[0].skipped).toMatch(/not the feature branch/i);
  });

  it('pushes a never-pushed branch (ahead === null)', async () => {
    const unpushed = report([repo({ dirty: false, ahead: null })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(unpushed);

    const result = await finishWorkspace('/ws', {});

    expect(multiGit.pushRepo).toHaveBeenCalledWith('/ws/api', 'feat');
    expect(result.repos[0].pushed).toBe(true);
  });

  it('falls back to a compare URL when gh is unavailable and does not create a PR', async () => {
    const unpushed = report([repo({ dirty: false, ahead: 2 })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(unpushed);

    const result = await finishWorkspace('/ws', { createPrs: true });

    expect(result.ghUsed).toBe(false);
    expect(pr.createPrWithGh).not.toHaveBeenCalled();
    expect(result.repos[0].compareUrl).toContain('/compare/main...feat');
    expect(result.repos[0].prUrl).toBeUndefined();
  });

  it('creates a PR via gh when authenticated', async () => {
    const unpushed = report([repo({ dirty: false, ahead: 2 })]);
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(unpushed);
    vi.mocked(pr.detectGh).mockResolvedValue({ installed: true, authenticated: true });
    vi.mocked(pr.createPrWithGh).mockResolvedValue({ url: 'https://github.com/o/api/pull/7' });

    const result = await finishWorkspace('/ws', { createPrs: true });

    expect(result.ghUsed).toBe(true);
    expect(result.repos[0].prUrl).toBe('https://github.com/o/api/pull/7');
  });

  it('refuses without changing anything when verification evidence is stale', async () => {
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(report([repo({ dirty: true, ahead: 1 })]));
    vi.mocked(policy.evaluateProgression).mockResolvedValue(STALE);

    const result = await finishWorkspace('/ws', { message: 'wip', createPrs: true });

    expect(result.blocked).toBe(true);
    expect(result.policy.blockers[0]).toMatch(/Verify again/);
    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(multiGit.pushRepo).not.toHaveBeenCalled();
    expect(pr.createPrWithGh).not.toHaveBeenCalled();
    expect(state.lastFinish).toBeUndefined();
  });

  it('proceeds under an explicit override, records it and returns it', async () => {
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(report([repo({ ahead: 1 })]));
    vi.mocked(policy.evaluateProgression).mockResolvedValue(STALE);
    const record = { at: 'now', operation: 'finish' as const, reason: 'hotfix approved by owner', blockers: STALE.blockers };
    vi.mocked(policy.recordVerificationOverride).mockResolvedValue(record);

    const result = await finishWorkspace('/ws', { override: { reason: 'hotfix approved by owner' } });

    expect(result.blocked).toBe(false);
    expect(result.override).toEqual(record);
    expect(policy.recordVerificationOverride).toHaveBeenCalledWith('/ws', { reason: 'hotfix approved by owner' }, STALE);
    expect(multiGit.pushRepo).toHaveBeenCalled();
    expect(state.lastFinish?.override).toEqual(record);
  });

  it('rejects an override without a real reason', async () => {
    await expect(finishWorkspace('/ws', { override: { reason: 'yes' } })).rejects.toThrow(/reason/);
    expect(status.getWorkspaceStatusReport).not.toHaveBeenCalled();
  });

  it('never commits or pushes a read-only reference repo', async () => {
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(report([
      repo({ name: 'host', path: '/src/host', access: 'reference', editable: false, dirty: true, ahead: 3 }),
    ]));

    const result = await finishWorkspace('/ws', { message: 'wip' });

    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(multiGit.pushRepo).not.toHaveBeenCalled();
    expect(result.repos[0].skipped).toMatch(/read-only reference/);
    // Nothing editable is outstanding, and the reference is not the workspace's to clean up.
    expect(result.safeToCleanup).toBe(true);
  });

  it('dry run previews commit, push and PR target without any effect', async () => {
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue(report([repo({ dirty: true, ahead: 0 })]));

    const result = await finishWorkspace('/ws', { message: 'wip', dryRun: true, createPrs: true });

    expect(result.dryRun).toBe(true);
    expect(result.repos[0]).toMatchObject({ wouldCommit: true, wouldPush: true, branch: 'feat', remoteUrl: 'https://github.com/o/api.git' });
    expect(result.repos[0].compareUrl).toContain('/compare/main...feat');
    expect(commit.commitWorkspace).not.toHaveBeenCalled();
    expect(multiGit.pushRepo).not.toHaveBeenCalled();
    expect(state.lastFinish).toBeUndefined();
  });

  it('records a failed push as partial, and a re-run resumes by pushing without committing again', async () => {
    const dirty = report([repo({ dirty: true, ahead: 0 })]);
    const committedNotPushed = report([repo({ dirty: false, ahead: 1 })]);
    vi.mocked(status.getWorkspaceStatusReport)
      .mockResolvedValueOnce(dirty).mockResolvedValueOnce(committedNotPushed)
      .mockResolvedValueOnce(committedNotPushed).mockResolvedValueOnce(report([repo({ ahead: 0 })]));
    vi.mocked(commit.commitWorkspace).mockResolvedValue({
      repos: [{ name: 'api', success: true, committed: true, pushed: false, branch: 'feat', commitHash: 'abc1234', filesChanged: 1, message: 'ok' }],
      skipped: [],
      committedCount: 1,
      failedCount: 0,
    });
    vi.mocked(multiGit.pushRepo).mockResolvedValueOnce({ success: false, message: 'remote rejected' });

    const first = await finishWorkspace('/ws', { message: 'wip' });
    expect(first.repos[0]).toMatchObject({ committed: true, commitHash: 'abc1234', pushed: false, error: 'remote rejected' });
    expect(state.lastFinish).toMatchObject({ status: 'partial', safeToCleanup: false });
    expect(state.lastFinish?.repos[0]).toMatchObject({ commitHash: 'abc1234', error: 'remote rejected' });

    const second = await finishWorkspace('/ws', { message: 'wip' });
    expect(second.resumedFrom).toBe('partial');
    expect(commit.commitWorkspace).toHaveBeenCalledTimes(1);
    expect(second.repos[0]).toMatchObject({ committed: false, pushed: true });
    expect(state.lastFinish).toMatchObject({ status: 'completed', safeToCleanup: true });
  });
});
