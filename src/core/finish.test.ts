import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finishWorkspace } from './finish.js';
import * as status from './status.js';
import * as commit from './commit.js';
import * as multiGit from '../utils/multi-git.js';
import * as pr from '../utils/pr.js';
import type { RepoStatusReport, WorkspaceStatusReport } from './status.js';

vi.mock('./status.js');
vi.mock('./commit.js');
vi.mock('../utils/multi-git.js');
vi.mock('../utils/pr.js');

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
      repos: [{ name: 'api', success: true, commitHash: 'abc1234', filesChanged: 2, message: 'ok' }],
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
});
