import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execa } from 'execa';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  checkRepoFreshness,
  fastForwardBranch,
  checkReposFreshness,
  fastForwardRepos,
  resolveTrackingBranch,
} from './repo-freshness.js';

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

async function initRepo(dir: string, branch = 'main'): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', branch);
  await git(dir, 'config', 'user.email', 'test@example.com');
  await git(dir, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(dir, 'README.md'), '# test\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'initial commit');
}

describe.skipIf(!hasGit)('repo-freshness (real git)', () => {
  let tmpDir = '';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-freshness-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {});
  });

  it('detects untracked status on remote-less local repo', async () => {
    const local = path.join(tmpDir, 'local');
    await initRepo(local);

    const freshness = await checkRepoFreshness(local, 'main', { fetch: false });
    expect(freshness.hasRemote).toBe(false);
    expect(freshness.trackingBranch).toBeNull();
    expect(freshness.status).toBe('untracked');
    expect(freshness.ahead).toBe(0);
    expect(freshness.behind).toBe(0);
  });

  it('detects up-to-date repository', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    await fs.mkdir(bare, { recursive: true });
    await git(tmpDir, 'init', '--bare', bare);

    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    const freshness = await checkRepoFreshness(local, 'main');
    expect(freshness.hasRemote).toBe(true);
    expect(freshness.trackingBranch).toBe('origin/main');
    expect(freshness.status).toBe('up-to-date');
    expect(freshness.behind).toBe(0);
    expect(freshness.ahead).toBe(0);
  });

  it('detects behind status and counts commits', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    const pusher = path.join(tmpDir, 'pusher');

    await fs.mkdir(bare, { recursive: true });
    await git(tmpDir, 'init', '--bare', bare);

    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    await git(tmpDir, 'clone', bare, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');

    // Make 2 commits in pusher and push
    await fs.writeFile(path.join(pusher, 'file1.txt'), 'content 1\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'commit 1');
    await fs.writeFile(path.join(pusher, 'file2.txt'), 'content 2\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'commit 2');
    await git(pusher, 'push', 'origin', 'main');

    const freshness = await checkRepoFreshness(local, 'main');
    expect(freshness.status).toBe('behind');
    expect(freshness.behind).toBe(2);
    expect(freshness.ahead).toBe(0);
    expect(freshness.message).toContain('2 commits behind origin/main');
  });

  it('detects ahead and diverged status', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    const pusher = path.join(tmpDir, 'pusher');

    await git(tmpDir, 'init', '--bare', bare);
    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    // Local commit
    await fs.writeFile(path.join(local, 'local.txt'), 'local\n');
    await git(local, 'add', '.');
    await git(local, 'commit', '-m', 'local commit');

    const freshnessAhead = await checkRepoFreshness(local, 'main');
    expect(freshnessAhead.status).toBe('ahead');
    expect(freshnessAhead.ahead).toBe(1);
    expect(freshnessAhead.behind).toBe(0);

    // Remote commit via pusher
    await git(tmpDir, 'clone', bare, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(pusher, 'remote.txt'), 'remote\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'remote commit');
    await git(pusher, 'push', 'origin', 'main');

    const freshnessDiverged = await checkRepoFreshness(local, 'main');
    expect(freshnessDiverged.status).toBe('diverged');
    expect(freshnessDiverged.ahead).toBe(1);
    expect(freshnessDiverged.behind).toBe(1);
  });

  it('safely fast-forwards clean checked-out branch', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    const pusher = path.join(tmpDir, 'pusher');

    await git(tmpDir, 'init', '--bare', bare);
    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    await git(tmpDir, 'clone', bare, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(pusher, 'remote-feat.txt'), 'new feature\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'remote commit');
    await git(pusher, 'push', 'origin', 'main');

    const ffResult = await fastForwardBranch(local, 'main');
    expect(ffResult.success).toBe(true);
    expect(ffResult.status).toBe('fast-forwarded');
    expect(ffResult.message).toContain('Fast-forwarded "main" to origin/main (1 commit)');

    // Verify file exists in local working tree
    await expect(fs.access(path.join(local, 'remote-feat.txt'))).resolves.toBeUndefined();
  });

  it('refuses to fast-forward when checked-out branch has dirty working tree', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    const pusher = path.join(tmpDir, 'pusher');

    await git(tmpDir, 'init', '--bare', bare);
    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    await git(tmpDir, 'clone', bare, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(pusher, 'remote-feat.txt'), 'new feature\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'remote commit');
    await git(pusher, 'push', 'origin', 'main');

    // Dirty uncommitted modification in local
    await fs.writeFile(path.join(local, 'dirty.txt'), 'uncommitted\n');

    const ffResult = await fastForwardBranch(local, 'main');
    expect(ffResult.success).toBe(false);
    expect(ffResult.status).toBe('dirty');
    expect(ffResult.message).toContain('uncommitted changes');

    // Local uncommitted file must still exist
    const content = await fs.readFile(path.join(local, 'dirty.txt'), 'utf8');
    expect(content).toBe('uncommitted\n');
  });

  it('fast-forwards inactive base branch while another branch is checked out', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');
    const pusher = path.join(tmpDir, 'pusher');

    await git(tmpDir, 'init', '--bare', bare);
    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await git(tmpDir, 'clone', bare, local);
    await git(local, 'config', 'user.email', 'test@example.com');
    await git(local, 'config', 'user.name', 'Test');

    // Switch local to a feature branch
    await git(local, 'checkout', '-b', 'feature-work');

    await git(tmpDir, 'clone', bare, pusher);
    await git(pusher, 'config', 'user.email', 'test@example.com');
    await git(pusher, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(pusher, 'remote-feat.txt'), 'new remote feature\n');
    await git(pusher, 'add', '.');
    await git(pusher, 'commit', '-m', 'remote commit');
    await git(pusher, 'push', 'origin', 'main');

    const ffResult = await fastForwardBranch(local, 'main');
    expect(ffResult.success).toBe(true);
    expect(ffResult.status).toBe('fast-forwarded');

    // Check that local 'main' ref matches 'origin/main'
    const mainSha = (await git(local, 'rev-parse', 'main')).trim();
    const originMainSha = (await git(local, 'rev-parse', 'origin/main')).trim();
    expect(mainSha).toBe(originMainSha);

    // Current branch should still be feature-work
    const curBranch = (await git(local, 'branch', '--show-current')).trim();
    expect(curBranch).toBe('feature-work');
  });

  it('resolves tracking branch with custom remote name (upstream)', async () => {
    const bare = path.join(tmpDir, 'bare.git');
    const local = path.join(tmpDir, 'local');

    await git(tmpDir, 'init', '--bare', bare);
    const seed = path.join(tmpDir, 'seed');
    await initRepo(seed);
    await git(seed, 'remote', 'add', 'origin', bare);
    await git(seed, 'push', '-u', 'origin', 'main');

    await initRepo(local);
    await git(local, 'remote', 'add', 'upstream', bare);
    await git(local, 'fetch', 'upstream');

    const { trackingBranch, remoteName } = await resolveTrackingBranch(local, 'main');
    expect(remoteName).toBe('upstream');
    expect(trackingBranch).toBe('upstream/main');
  });

  it('runs batch checkReposFreshness and fastForwardRepos', async () => {
    const bare1 = path.join(tmpDir, 'bare1.git');
    const local1 = path.join(tmpDir, 'local1');
    await git(tmpDir, 'init', '--bare', bare1);
    const seed1 = path.join(tmpDir, 'seed1');
    await initRepo(seed1);
    await git(seed1, 'remote', 'add', 'origin', bare1);
    await git(seed1, 'push', '-u', 'origin', 'main');
    await git(tmpDir, 'clone', bare1, local1);

    const bare2 = path.join(tmpDir, 'bare2.git');
    const local2 = path.join(tmpDir, 'local2');
    await git(tmpDir, 'init', '--bare', bare2);
    const seed2 = path.join(tmpDir, 'seed2');
    await initRepo(seed2);
    await git(seed2, 'remote', 'add', 'origin', bare2);
    await git(seed2, 'push', '-u', 'origin', 'main');
    await git(tmpDir, 'clone', bare2, local2);

    const freshnessList = await checkReposFreshness([
      { path: local1, branch: 'main' },
      { path: local2, branch: 'main' },
    ]);
    expect(freshnessList).toHaveLength(2);
    expect(freshnessList[0].status).toBe('up-to-date');
    expect(freshnessList[1].status).toBe('up-to-date');

    const ffList = await fastForwardRepos([
      { path: local1, branch: 'main' },
      { path: local2, branch: 'main' },
    ]);
    expect(ffList).toHaveLength(2);
    expect(ffList[0].status).toBe('up-to-date');
    expect(ffList[1].status).toBe('up-to-date');
  });
});
