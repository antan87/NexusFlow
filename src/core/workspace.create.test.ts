import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { createWorkspace, deleteWorkspace, addRepoToWorkspace } from './workspace.js';
import * as worktree from './worktree.js';
import type { Feature, RepoInfo, RepoSelection } from '../types.js';
import { PRIMARY_MANIFEST_FILE } from './constants.js';

vi.mock('execa');
vi.mock('./worktree.js');
vi.mock('./storage.js', () => ({
  deleteWorkspaceFiles: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../generators/index.js', () => ({
  generateContextFiles: vi.fn().mockResolvedValue(undefined),
}));

let workspacePath = '';

function feature(repos: RepoInfo[]): Feature {
  return {
    id: 'feat-branch',
    branchName: 'feat-branch',
    description: 'test',
    repos: repos.map((r) => path.join(workspacePath, r.name)),
    originalRepos: repos.map((r) => r.path),
    assistants: ['claude'],
    workspacePath,
    createdAt: '2026-07-04T00:00:00.000Z',
  };
}

function repoInfos(...names: string[]): RepoInfo[] {
  return names.map((name) => ({ name, path: path.join('/src', name), defaultBranch: 'main' }));
}

/** Args of every recorded `git` execa call. */
function gitCalls(): string[][] {
  return vi.mocked(execa).mock.calls.map((c) => c[1] as string[]);
}

describe('createWorkspace rollback', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-create-test-'));
    // Non-worktree git calls (init, branch -D, prune) just succeed.
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    vi.mocked(worktree.removeWorktree).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('creates worktrees for all repos and saves the manifest on success', async () => {
    vi.mocked(worktree.createWorktree).mockResolvedValue({ createdBranch: true });
    const repos = repoInfos('api', 'web');

    await createWorkspace(feature(repos), repos);

    expect(worktree.createWorktree).toHaveBeenCalledTimes(2);
    expect(worktree.removeWorktree).not.toHaveBeenCalled();
    const manifest = await fs.readFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), 'utf-8');
    expect(JSON.parse(manifest).branchName).toBe('feat-branch');
  });

  it('rolls back created worktrees and branches when a later worktree fails', async () => {
    vi.mocked(worktree.createWorktree)
      .mockResolvedValueOnce({ createdBranch: true }) // api ok
      .mockRejectedValueOnce(new Error('fatal: worktree add failed')); // web fails
    const repos = repoInfos('api', 'web');

    await expect(createWorkspace(feature(repos), repos)).rejects.toThrow(/worktree add failed/);

    // Only the successfully-created worktree (api) is removed.
    expect(worktree.removeWorktree).toHaveBeenCalledTimes(1);
    expect(worktree.removeWorktree).toHaveBeenCalledWith(path.join('/src', 'api'), path.join(workspacePath, 'api'), true);
    // Its run-created branch is deleted.
    expect(gitCalls()).toContainEqual(['branch', '-D', 'feat-branch']);
    // The workspace directory is gone.
    await expect(fs.access(workspacePath)).rejects.toBeTruthy();
  });

  it('does not delete a branch that already existed (was only checked out)', async () => {
    vi.mocked(worktree.createWorktree)
      .mockResolvedValueOnce({ createdBranch: false }) // api reused an existing branch
      .mockRejectedValueOnce(new Error('boom'));
    const repos = repoInfos('api', 'web');

    await expect(createWorkspace(feature(repos), repos)).rejects.toThrow(/boom/);

    expect(worktree.removeWorktree).toHaveBeenCalledTimes(1);
    expect(gitCalls().some((c) => c[0] === 'branch' && c[1] === '-D')).toBe(false);
  });

  it('fails fast when the workspace directory already exists and is non-empty', async () => {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.writeFile(path.join(workspacePath, 'existing.txt'), 'x', 'utf-8');
    const repos = repoInfos('api');

    await expect(createWorkspace(feature(repos), repos)).rejects.toThrow(/already exists and is not empty/);
    expect(worktree.createWorktree).not.toHaveBeenCalled();
  });

  it('checks out a per-repo existing branch (mustExist) instead of the feature branch', async () => {
    vi.mocked(worktree.createWorktree).mockResolvedValue({ createdBranch: false });
    const repos: RepoSelection[] = repoInfos('api', 'web');
    repos[0]!.existingBranch = 'legacy/branch';

    await createWorkspace(feature(repos), repos);

    expect(worktree.createWorktree).toHaveBeenCalledWith(
      path.join('/src', 'api'),
      path.join(workspacePath, 'api'),
      'legacy/branch',
      'main',
      { mustExist: true },
    );
    expect(worktree.createWorktree).toHaveBeenCalledWith(
      path.join('/src', 'web'),
      path.join(workspacePath, 'web'),
      'feat-branch',
      'main',
      { mustExist: false },
    );
  });

  it('rollback deletes the per-repo override branch, not the feature branch', async () => {
    // The override branch was remote-only, so a local ref was created for it.
    vi.mocked(worktree.createWorktree)
      .mockResolvedValueOnce({ createdBranch: true }) // api on 'legacy/branch'
      .mockRejectedValueOnce(new Error('boom')); // web fails
    const repos: RepoSelection[] = repoInfos('api', 'web');
    repos[0]!.existingBranch = 'legacy/branch';

    await expect(createWorkspace(feature(repos), repos)).rejects.toThrow(/boom/);

    expect(gitCalls()).toContainEqual(['branch', '-D', 'legacy/branch']);
    expect(gitCalls()).not.toContainEqual(['branch', '-D', 'feat-branch']);
  });

  it('in-place mode creates no worktrees and points the workspace at the source repos', async () => {
    const repos = repoInfos('api', 'web');
    const inPlaceFeature: Feature = {
      ...feature(repos),
      id: 'my-feature',
      branchName: 'my-feature',
      mode: 'in-place',
      repos: repos.map((r) => r.path),
    };

    await createWorkspace(inPlaceFeature, repos);

    // No git worktrees. The artifact repo still ignores ephemeral NexusFlow state,
    // but it must not ignore source repos because in-place repos live elsewhere.
    expect(worktree.createWorktree).not.toHaveBeenCalled();
    const gitignore = await fs.readFile(path.join(workspacePath, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('/.nexusflow-analysis-cache.json');
    expect(gitignore).not.toContain('/api/');

    // The manifest records the mode and the source repo paths.
    const manifest = JSON.parse(await fs.readFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), 'utf-8'));
    expect(manifest.mode).toBe('in-place');
    expect(manifest.repos).toEqual([path.join('/src', 'api'), path.join('/src', 'web')]);

    // The .code-workspace references the source repos by absolute path.
    const wsName = path.basename(workspacePath);
    const codeWorkspace = JSON.parse(
      await fs.readFile(path.join(workspacePath, `${wsName}.code-workspace`), 'utf-8'),
    );
    expect(codeWorkspace.folders).toContainEqual({ path: path.join('/src', 'api'), name: 'api' });
  });

  it('completes rollback even when removeWorktree fails (prunes and removes the dir)', async () => {
    vi.mocked(worktree.createWorktree)
      .mockResolvedValueOnce({ createdBranch: true })
      .mockRejectedValueOnce(new Error('kaboom'));
    vi.mocked(worktree.removeWorktree).mockRejectedValue(new Error('worktree locked'));
    const repos = repoInfos('api', 'web');

    await expect(createWorkspace(feature(repos), repos)).rejects.toThrow(/kaboom/);

    // Falls back to `git worktree prune` when removal fails.
    expect(gitCalls()).toContainEqual(['worktree', 'prune']);
    await expect(fs.access(workspacePath)).rejects.toBeTruthy();
  });
});

describe('deleteWorkspace (in-place)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-delete-test-'));
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('removes only the workspace dir and never touches the source repos', async () => {
    // A stand-in source repo that must survive the delete.
    const sourceRepo = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-delete-test-src-'));
    await fs.writeFile(path.join(sourceRepo, 'precious.txt'), 'keep me', 'utf-8');

    try {
      await fs.mkdir(workspacePath, { recursive: true });
      const manifest: Feature = {
        id: 'my-fix',
        mode: 'in-place',
        branchName: 'my-fix',
        description: 'in-place delete test',
        repos: [sourceRepo],
        originalRepos: [sourceRepo],
        assistants: ['claude'],
        workspacePath,
        createdAt: '2026-07-04T00:00:00.000Z',
      };
      await fs.writeFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), JSON.stringify(manifest), 'utf-8');

      await deleteWorkspace(workspacePath);

      // No worktree removal was attempted against the source repo.
      expect(worktree.removeWorktree).not.toHaveBeenCalled();
      // The source repo and its content are intact.
      expect(await fs.readFile(path.join(sourceRepo, 'precious.txt'), 'utf-8')).toBe('keep me');
      // The workspace dir itself is gone.
      await expect(fs.access(workspacePath)).rejects.toBeTruthy();
    } finally {
      await fs.rm(sourceRepo, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('addRepoToWorkspace rollback', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-addrepo-test-'));
    vi.mocked(execa).mockResolvedValue({ stdout: '' } as any);
    vi.mocked(worktree.removeWorktree).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('rolls back created worktree and branch if a subsequent step fails', async () => {
    const { generateContextFiles } = await import('../generators/index.js');
    vi.mocked(generateContextFiles).mockRejectedValueOnce(new Error('Generator failed'));

    await fs.mkdir(workspacePath, { recursive: true });
    const initialManifest: Feature = {
      id: 'my-feature',
      mode: 'worktree',
      branchName: 'my-feature',
      description: 'test',
      repos: [path.join(workspacePath, 'api')],
      originalRepos: ['/src/api'],
      assistants: ['claude'],
      workspacePath,
      createdAt: '2026-07-04T00:00:00.000Z',
    };
    await fs.writeFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), JSON.stringify(initialManifest), 'utf-8');

    // createWorktree succeeds and creates a branch
    vi.mocked(worktree.createWorktree).mockResolvedValue({ createdBranch: true });

    await expect(addRepoToWorkspace(workspacePath, '/src/web')).rejects.toThrow(/Generator failed/);

    // Verify rollback was invoked for the created worktree
    expect(worktree.removeWorktree).toHaveBeenCalledWith('/src/web', path.join(workspacePath, 'web'), true);
    // Verify run-created branch was cleaned up
    expect(gitCalls()).toContainEqual(['branch', '-D', 'my-feature']);
    // Verify workspace directory still exists (not destroyed like in createWorkspace)
    expect(await fs.access(workspacePath).then(() => true).catch(() => false)).toBe(true);

    // Verify manifest was reverted on disk to its original state (B2)
    const manifestContent = await fs.readFile(path.join(workspacePath, PRIMARY_MANIFEST_FILE), 'utf-8');
    const restoredManifest = JSON.parse(manifestContent);
    expect(restoredManifest.repos).toEqual([path.join(workspacePath, 'api')]);
    expect(restoredManifest.originalRepos).toEqual(['/src/api']);
  });
});

