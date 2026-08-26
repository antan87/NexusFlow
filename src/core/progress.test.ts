import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

import { getWorkspaceProgress } from './progress.js';
import * as status from './status.js';
import * as pr from '../utils/pr.js';

vi.mock('./status.js');
vi.mock('../utils/pr.js');
vi.mock('execa');

describe('live workspace progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue({
      workspacePath: '/ws', branchName: 'feat', allClean: true, allPushed: true,
      repos: [{
        name: 'api', path: '/ws/api', branch: 'feat', headSha: 'abc', expectedBranch: 'feat', onExpectedBranch: true,
        dirty: false, changedFiles: [], ahead: 0, behind: 0, remoteUrl: 'https://github.com/acme/api.git', defaultBranch: 'main',
      }],
    });
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '' } as never);
  });

  it('derives branch, clean, and pushed state without inventing unavailable PR state', async () => {
    vi.mocked(pr.detectGh).mockResolvedValue({ installed: false, authenticated: false });
    const report = await getWorkspaceProgress('/ws');
    expect(report.repos[0]).toMatchObject({ branchExists: true, onExpectedBranch: true, clean: true, pushed: true });
    expect(report.repos[0]?.pullRequest).toBeUndefined();
  });

  it('includes PR state only when the authenticated forge adapter returns it', async () => {
    vi.mocked(pr.detectGh).mockResolvedValue({ installed: true, authenticated: true });
    vi.mocked(pr.parseRemoteUrl).mockReturnValue({ host: 'github.com', owner: 'acme', repo: 'api', kind: 'github' });
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: '{"state":"MERGED","url":"https://example.test/pr/1"}' } as never);
    const report = await getWorkspaceProgress('/ws');
    expect(report.repos[0]?.pullRequest).toEqual({ state: 'merged', url: 'https://example.test/pr/1' });
  });

  it('does not claim pushed or PR progress while checked out on the wrong branch', async () => {
    vi.mocked(status.getWorkspaceStatusReport).mockResolvedValue({
      workspacePath: '/ws', branchName: 'feat', allClean: true, allPushed: false,
      repos: [{
        name: 'api', path: '/ws/api', branch: 'main', headSha: 'abc', expectedBranch: 'feat', onExpectedBranch: false,
        dirty: false, changedFiles: [], ahead: 0, behind: 0, remoteUrl: 'https://github.com/acme/api.git', defaultBranch: 'main',
      }],
    });
    vi.mocked(pr.detectGh).mockResolvedValue({ installed: true, authenticated: true });
    vi.mocked(pr.parseRemoteUrl).mockReturnValue({ host: 'github.com', owner: 'acme', repo: 'api', kind: 'github' });
    vi.mocked(execa).mockResolvedValue({ exitCode: 1, stdout: '' } as never);

    const report = await getWorkspaceProgress('/ws');

    expect(report.repos[0]).toMatchObject({ branchExists: false, onExpectedBranch: false });
    expect(report.repos[0]?.pushed).toBeUndefined();
    expect(report.repos[0]?.pullRequest).toBeUndefined();
    expect(execa).not.toHaveBeenCalledWith('gh', expect.anything(), expect.anything());
  });
});
