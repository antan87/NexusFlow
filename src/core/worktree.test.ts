import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorktree, removeWorktree } from './worktree.js';

/** These tests drive real git; skip cleanly where git is unavailable. */
const hasGit = (() => {
  try {
    execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
}

/** Initializes a git repo on branch `main` with one commit. */
async function initRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(dir, 'README.md'), '# test\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'init');
}

describe.skipIf(!hasGit)('createWorktree / removeWorktree (real git)', () => {
  let base = '';
  let mainRepo = '';
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    base = path.join(os.tmpdir(), `nexusflow-wt-test-${process.pid}-${counter}`);
    mainRepo = path.join(base, 'main');
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('creates a worktree and a new branch from the local base (remote-less repo)', async () => {
    await initRepo(mainRepo);
    const target = path.join(base, 'wt');

    const result = await createWorktree(mainRepo, target, 'feature/x', 'main');

    expect(result.createdBranch).toBe(true);
    await expect(fs.access(path.join(target, '.git'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(target, 'README.md'))).resolves.toBeUndefined();
    expect(await git(mainRepo, 'branch', '--list', 'feature/x')).toContain('feature/x');
  });

  it('reuses an existing branch instead of creating one', async () => {
    await initRepo(mainRepo);
    await git(mainRepo, 'branch', 'feature/x');
    const target = path.join(base, 'wt');

    const result = await createWorktree(mainRepo, target, 'feature/x', 'main');

    expect(result.createdBranch).toBe(false);
    await expect(fs.access(path.join(target, '.git'))).resolves.toBeUndefined();
  });

  it('bases the new branch on origin/<base> when a remote exists', async () => {
    // Bare "remote" seeded from an initial repo.
    const seed = path.join(base, 'seed');
    await initRepo(seed);
    const remote = path.join(base, 'remote.git');
    await git(base, 'clone', '--bare', seed, remote);

    // The working repo clones the remote, then the remote gains a new commit.
    await git(base, 'clone', remote, mainRepo);
    await git(mainRepo, 'config', 'user.email', 'test@example.com');
    await git(mainRepo, 'config', 'user.name', 'Test');
    const pusher = path.join(base, 'pusher');
    await git(base, 'clone', remote, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(pusher, 'NEW.md'), 'new\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'remote change');
    await git(pusher, 'push', 'origin', 'main');

    const target = path.join(base, 'wt');
    const result = await createWorktree(mainRepo, target, 'feature/x', 'main');

    expect(result.createdBranch).toBe(true);
    // The worktree started from origin/main (post-fetch), so it has the new file.
    await expect(fs.access(path.join(target, 'NEW.md'))).resolves.toBeUndefined();
  }, 15000);

  it('checks out a remote-only branch as a local tracking branch', async () => {
    // Bare "remote" seeded from an initial repo.
    const seed = path.join(base, 'seed');
    await initRepo(seed);
    const remote = path.join(base, 'remote.git');
    await git(base, 'clone', '--bare', seed, remote);

    // The working repo clones the remote; another clone pushes a branch that
    // the working repo never checks out locally.
    await git(base, 'clone', remote, mainRepo);
    const pusher = path.join(base, 'pusher');
    await git(base, 'clone', remote, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await git(pusher, 'checkout', '-b', 'feature/existing');
    await fs.writeFile(path.join(pusher, 'EXISTING.md'), 'existing\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'existing branch change');
    await git(pusher, 'push', 'origin', 'feature/existing');

    const target = path.join(base, 'wt');
    const result = await createWorktree(mainRepo, target, 'feature/existing', 'main', { mustExist: true });

    // A new local ref was created (from the remote branch), with its content.
    expect(result.createdBranch).toBe(true);
    await expect(fs.access(path.join(target, 'EXISTING.md'))).resolves.toBeUndefined();
    // The local branch tracks origin/feature/existing.
    const upstream = await git(target, 'rev-parse', '--abbrev-ref', 'feature/existing@{upstream}');
    expect(upstream.trim()).toBe('origin/feature/existing');
  }, 15000);

  it('mustExist fails when the branch exists neither locally nor on origin', async () => {
    await initRepo(mainRepo);
    const target = path.join(base, 'wt');

    await expect(
      createWorktree(mainRepo, target, 'feature/nope', 'main', { mustExist: true }),
    ).rejects.toThrow(/does not exist locally or on origin/);
    // Nothing was created.
    await expect(fs.access(target)).rejects.toBeTruthy();
  });

  it('mustExist checks out an existing local branch', async () => {
    await initRepo(mainRepo);
    await git(mainRepo, 'branch', 'feature/x');
    const target = path.join(base, 'wt');

    const result = await createWorktree(mainRepo, target, 'feature/x', 'main', { mustExist: true });

    expect(result.createdBranch).toBe(false);
    await expect(fs.access(path.join(target, '.git'))).resolves.toBeUndefined();
  });

  it('still creates from the local base when fetch fails (bad remote)', async () => {
    await initRepo(mainRepo);
    await git(mainRepo, 'remote', 'add', 'origin', path.join(base, 'does-not-exist.git'));
    const target = path.join(base, 'wt');

    const result = await createWorktree(mainRepo, target, 'feature/x', 'main');

    expect(result.createdBranch).toBe(true);
    await expect(fs.access(path.join(target, 'README.md'))).resolves.toBeUndefined();
  });

  it('removeWorktree removes the worktree and leaves the main repo intact', async () => {
    await initRepo(mainRepo);
    const target = path.join(base, 'wt');
    await createWorktree(mainRepo, target, 'feature/x', 'main');

    await removeWorktree(mainRepo, target);

    await expect(fs.access(target)).rejects.toBeTruthy();
    await expect(fs.access(path.join(mainRepo, 'README.md'))).resolves.toBeUndefined();
  });

  it('removeWorktree needs force to remove a dirty worktree', async () => {
    await initRepo(mainRepo);
    const target = path.join(base, 'wt');
    await createWorktree(mainRepo, target, 'feature/x', 'main');
    await fs.writeFile(path.join(target, 'dirty.txt'), 'uncommitted\n');

    await expect(removeWorktree(mainRepo, target, false)).rejects.toBeTruthy();
    await removeWorktree(mainRepo, target, true);
    await expect(fs.access(target)).rejects.toBeTruthy();
  });
});
