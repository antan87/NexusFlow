import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { commitCommand } from './commit.js';
import * as workspace from '../core/workspace.js';
import * as multiGit from '../utils/multi-git.js';

vi.mock('node:fs/promises');
vi.mock('../core/config.js');
vi.mock('../core/workspace.js');
vi.mock('../utils/multi-git.js');

describe('commitCommand --no-push handling (A1.1)', () => {
  const workspacePath = path.resolve('/mock/workspace');
  const repoPath = path.join(workspacePath, 'repo-1');

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: 'feature',
      branchName: 'feature-branch',
      description: 'test',
      repos: [repoPath],
      assistants: ['claude'],
      workspacePath,
    } as any);
    vi.spyOn(multiGit, 'getWorkspaceRepos').mockResolvedValue([
      { name: 'repo-1', path: repoPath, branchName: 'feature-branch' },
    ] as any);
    vi.spyOn(multiGit, 'getRepoStatus').mockResolvedValue({
      hasChanges: true,
      changedFiles: ['src/a.ts'],
      files: [{ code: ' M', path: 'src/a.ts' }],
      summary: '1 file changed',
    } as any);
    vi.spyOn(multiGit, 'getDiffSummary').mockResolvedValue({ additions: 1, deletions: 0 } as any);
    vi.spyOn(multiGit, 'commitAndPush').mockResolvedValue({
      success: true,
      commitHash: 'abc1234',
      message: 'ok',
    } as any);
  });

  it('suppresses push when commander reports push=false (--no-push)', async () => {
    await commitCommand('wip', workspacePath, { push: false });

    expect(multiGit.commitAndPush).toHaveBeenCalledWith(
      repoPath,
      'wip',
      'feature-branch',
      { noPush: true },
    );
  });

  it('pushes by default when the flag is absent (push defaults to true)', async () => {
    await commitCommand('wip', workspacePath, { push: true });

    expect(multiGit.commitAndPush).toHaveBeenCalledWith(
      repoPath,
      'wip',
      'feature-branch',
      { noPush: false },
    );
  });

  it('does not push during a dry run and never commits', async () => {
    await commitCommand('wip', workspacePath, { push: false, dryRun: true });

    expect(multiGit.commitAndPush).not.toHaveBeenCalled();
  });
});
