import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWorkspaceStatusReport } from './status.js';
import * as multiGit from '../utils/multi-git.js';
import { execa } from 'execa';

vi.mock('../utils/multi-git.js');
vi.mock('execa');

describe('getWorkspaceStatusReport — collision detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports allClean and no collisions when repositories are clean', async () => {
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([
      { name: 'repo-1', path: '/repo-1', branchName: 'main', defaultBranch: 'main' },
    ]);
    vi.mocked(multiGit.getRepoBranch).mockResolvedValue('main');
    vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [], changedFiles: [], summary: 'clean' });
    vi.mocked(multiGit.getRemoteUrl).mockResolvedValue('git@github.com:org/repo-1.git');
    vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 });
    vi.mocked(execa).mockResolvedValue({ stdout: 'abc1234\n' } as any);

    const report = await getWorkspaceStatusReport('/ws');

    expect(report.allClean).toBe(true);
    expect(report.allPushed).toBe(true);
    expect(report.hasCollisions).toBe(false);
    expect(report.collisionWarning).toBeUndefined();
    expect(report.repos[0]!.collisions).toBeUndefined();
  });

  it('does NOT report collisions for normal dirty working tree edits by the current developer', async () => {
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([
      { name: 'repo-1', path: '/repo-1', branchName: 'main', defaultBranch: 'main' },
    ]);
    vi.mocked(multiGit.getRepoBranch).mockResolvedValue('main');
    vi.mocked(multiGit.getRepoStatus).mockResolvedValue({
      hasChanges: true,
      files: [{ path: 'src/feature.ts', code: ' M' }],
      changedFiles: ['src/feature.ts'],
      summary: '1 file changed',
    });
    vi.mocked(multiGit.getRemoteUrl).mockResolvedValue('git@github.com:org/repo-1.git');
    vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 1, behind: 0 });

    vi.mocked(execa).mockImplementation(async (cmd, args) => {
      if (args && args[0] === 'rev-parse') return { stdout: 'commit123\n' } as any;
      if (args && args[0] === 'config' && args[1] === 'user.name') return { stdout: 'Alice\n' } as any;
      if (args && args[0] === 'config' && args[1] === 'user.email') return { stdout: 'alice@example.com\n' } as any;
      if (args && args[0] === 'log') {
        // Recent commit was by Alice (current user)
        return { stdout: 'sha1|Alice|alice@example.com|feat: my work|2026-09-11T10:00:00Z\n' } as any;
      }
      return { stdout: '' } as any;
    });

    const report = await getWorkspaceStatusReport('/ws');

    expect(report.allClean).toBe(false);
    expect(report.repos[0]!.dirty).toBe(true);
    expect(report.hasCollisions).toBe(false);
    expect(report.collisionWarning).toBeUndefined();
    expect(report.repos[0]!.collisions).toBeUndefined();
  });

  it('detects file collisions when a recent commit by another collaborator touches dirty files', async () => {
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([
      { name: 'repo-1', path: '/repo-1', branchName: 'main', defaultBranch: 'main' },
    ]);
    vi.mocked(multiGit.getRepoBranch).mockResolvedValue('main');
    vi.mocked(multiGit.getRepoStatus).mockResolvedValue({
      hasChanges: true,
      files: [{ path: 'src/shared.ts', code: ' M' }],
      changedFiles: ['src/shared.ts'],
      summary: '1 file changed',
    });
    vi.mocked(multiGit.getRemoteUrl).mockResolvedValue('git@github.com:org/repo-1.git');
    vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 1, behind: 0 });

    vi.mocked(execa).mockImplementation(async (cmd, args) => {
      if (args && args[0] === 'rev-parse') return { stdout: 'commit123\n' } as any;
      if (args && args[0] === 'config' && args[1] === 'user.name') return { stdout: 'Alice\n' } as any;
      if (args && args[0] === 'config' && args[1] === 'user.email') return { stdout: 'alice@example.com\n' } as any;
      if (args && args[0] === 'log') {
        // Recent commit by Bob (collaborator)
        return { stdout: 'collab123|Bob Dev|bob@example.com|fix: shared method|2026-09-11T10:00:00Z\n' } as any;
      }
      if (args && args[0] === 'diff-tree') {
        // Bob's commit touched src/shared.ts
        return { stdout: 'src/shared.ts\n' } as any;
      }
      return { stdout: '' } as any;
    });

    const report = await getWorkspaceStatusReport('/ws');

    expect(report.allClean).toBe(false);
    expect(report.hasCollisions).toBe(true);
    expect(report.collisionWarning).toContain('post_workroom_handoff');
    expect(report.repos[0]!.dirty).toBe(true);
    expect(report.repos[0]!.collisions).toBeDefined();
    expect(report.repos[0]!.collisions?.length).toBe(1);
    expect(report.repos[0]!.collisions![0]!.filePath).toBe('src/shared.ts');
    expect(report.repos[0]!.collisions![0]!.lastCommittedBy).toBe('Bob Dev <bob@example.com>');
    expect(report.repos[0]!.collisions![0]!.collisionHint).toContain('post_workroom_handoff');
    expect(report.repos[0]!.collisionWarning).toContain('Bob Dev <bob@example.com>');
    expect(report.repos[0]!.collisionWarning).toContain('post_workroom_handoff');
  });

  it('detects merge conflicts as immediate collisions', async () => {
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([
      { name: 'repo-1', path: '/repo-1', branchName: 'main', defaultBranch: 'main' },
    ]);
    vi.mocked(multiGit.getRepoBranch).mockResolvedValue('main');
    vi.mocked(multiGit.getRepoStatus).mockResolvedValue({
      hasChanges: true,
      files: [{ path: 'src/conflict.ts', code: 'UU' }],
      changedFiles: ['src/conflict.ts'],
      summary: '1 conflict',
    });
    vi.mocked(multiGit.getRemoteUrl).mockResolvedValue('git@github.com:org/repo-1.git');
    vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 });
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const report = await getWorkspaceStatusReport('/ws');

    expect(report.hasCollisions).toBe(true);
    expect(report.repos[0]!.collisions).toBeDefined();
    expect(report.repos[0]!.collisions![0]!.filePath).toBe('src/conflict.ts');
    expect(report.repos[0]!.collisions![0]!.collisionHint).toContain('unresolved merge conflict state');
  });

  it('ignores newly created untracked files and does not report them as collisions', async () => {
    vi.mocked(multiGit.getWorkspaceRepos).mockResolvedValue([
      { name: 'repo-1', path: '/repo-1', branchName: 'main', defaultBranch: 'main' },
    ]);
    vi.mocked(multiGit.getRepoBranch).mockResolvedValue('main');
    vi.mocked(multiGit.getRepoStatus).mockResolvedValue({
      hasChanges: true,
      files: [{ path: 'src/new-file.ts', code: '??' }],
      changedFiles: ['src/new-file.ts'],
      summary: '1 untracked file',
    });
    vi.mocked(multiGit.getRemoteUrl).mockResolvedValue('git@github.com:org/repo-1.git');
    vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 });
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);

    const report = await getWorkspaceStatusReport('/ws');

    expect(report.hasCollisions).toBe(false);
    expect(report.repos[0]!.collisions).toBeUndefined();
    expect(report.collisionWarning).toBeUndefined();
  });
});
