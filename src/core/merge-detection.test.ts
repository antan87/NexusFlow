import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';

import { checkMerged, fetchDefaultBranch, findMergedPullRequest } from './merge-detection.js';

const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout.trim();

describe('findMergedPullRequest', () => {
  const prs = [
    { url: 'https://github.com/o/r/pull/1', headRefOid: 'old', baseRefName: 'main' },
    { url: 'https://github.com/o/r/pull/2', headRefOid: 'tip', baseRefName: 'release' },
    { url: 'https://github.com/o/r/pull/3', headRefOid: 'tip', baseRefName: 'main' },
  ];

  it('accepts only a PR into the default branch whose head is exactly the tip', () => {
    expect(findMergedPullRequest(prs, 'tip', 'main')?.url).toBe('https://github.com/o/r/pull/3');
  });

  it('a PR merged from an earlier tip proves nothing about later commits', () => {
    expect(findMergedPullRequest(prs.slice(0, 2), 'tip', 'main')).toBeNull();
  });
});

describe('checkMerged (real git)', { timeout: 60_000 }, () => {
  let root: string;
  let repo: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cs-merge-')));
    const remote = path.join(root, 'r.git');
    await git(root, 'init', '--bare', '-b', 'main', remote);
    repo = path.join(root, 'r');
    await git(root, 'clone', remote, repo);
    await git(repo, 'config', 'user.name', 'Test');
    await git(repo, 'config', 'user.email', 'test@example.com');
    await fs.writeFile(path.join(repo, 'a.txt'), 'a\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'a');
    await git(repo, 'push', '-u', 'origin', 'main');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('proves fast-forward and merge-commit merges by ancestry, and nothing else', async () => {
    await git(repo, 'checkout', '-b', 'feat');
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'b');
    const tip = await git(repo, 'rev-parse', 'HEAD');

    expect(await checkMerged({ repoPath: repo, sha: tip, branch: 'feat', defaultBranch: 'main', usePullRequests: false }))
      .toMatchObject({ merged: false, evidence: 'none' });

    // Merge on the remote from another clone, then fetch only the default branch.
    const other = path.join(root, 'other');
    await git(root, 'clone', path.join(root, 'r.git'), other);
    await git(repo, 'push', 'origin', 'feat');
    await git(other, 'config', 'user.name', 'Test');
    await git(other, 'config', 'user.email', 'test@example.com');
    await git(other, 'fetch', 'origin');
    await git(other, 'merge', '--no-ff', '-m', 'merge', 'origin/feat');
    await git(other, 'push', 'origin', 'main');
    expect(await fetchDefaultBranch(repo, 'main')).toBeNull();

    expect(await checkMerged({ repoPath: repo, sha: tip, branch: 'feat', defaultBranch: 'main', usePullRequests: false }))
      .toMatchObject({ merged: true, evidence: 'ancestor' });
  });

  it('a squash merge is not proven without pull-request evidence', async () => {
    await git(repo, 'checkout', '-b', 'feat');
    await fs.writeFile(path.join(repo, 'b.txt'), 'b\n');
    await git(repo, 'add', '.');
    await git(repo, 'commit', '-m', 'b');
    const tip = await git(repo, 'rev-parse', 'HEAD');
    await git(repo, 'checkout', 'main');
    await git(repo, 'merge', '--squash', 'feat');
    await git(repo, 'commit', '-m', 'squashed');
    await git(repo, 'push', 'origin', 'main');

    // No GitHub remote, so no PR lookup: the branch must be kept.
    expect(await checkMerged({ repoPath: repo, sha: tip, branch: 'feat', defaultBranch: 'main', remoteUrl: path.join(root, 'r.git') }))
      .toMatchObject({ merged: false, evidence: 'none' });
  });

  it('reports a missing default branch instead of throwing, and a failed fetch as an error', async () => {
    const tip = await git(repo, 'rev-parse', 'HEAD');
    expect(await checkMerged({ repoPath: repo, sha: tip, defaultBranch: 'trunk', usePullRequests: false }))
      .toMatchObject({ merged: false, detail: 'default branch "trunk" not found' });
    expect(await fetchDefaultBranch(repo, 'trunk')).toMatch(/.+/);
  });
});
