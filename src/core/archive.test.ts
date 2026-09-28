/**
 * Real-Git coverage for archive: worktrees go only when their work is safe,
 * the record stays, the user's checkouts never change, and an interrupted
 * archive resumes.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';

import { ArchivedWorkspaceError, archiveWorkspace, planArchive, unarchiveWorkspace } from './archive.js';
import { commitWorkspace } from './commit.js';
import { finishWorkspace } from './finish.js';
import { isolateWorkspaceRepo } from './isolate.js';
import { syncWorkspace } from './sync.js';
import { verifyWorkspace } from './verify.js';
import { listWorkspaces, loadFeatureConfig, saveFeatureConfig } from './workspace.js';
import { loadWorkspaceState } from './workspace-state.js';
import type { Feature } from '../types.js';

const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout.trim();

async function initRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.name', 'Test');
  await git(dir, 'config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(dir, 'README.md'), '# repo\n');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'initial');
}

async function configure(repo: string): Promise<void> {
  await git(repo, 'config', 'user.name', 'Test');
  await git(repo, 'config', 'user.email', 'test@example.com');
}

/** A bare remote, the user's own clone of it, and a second clone that plays the forge. */
async function hostWithRemote(root: string, name: string): Promise<{ host: string; remote: string; forge: string }> {
  const remote = path.join(root, `${name}.git`);
  const seed = path.join(root, `${name}-seed`);
  await initRepo(seed);
  await git(root, 'init', '--bare', '-b', 'main', remote);
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  const host = path.join(root, name);
  await git(root, 'clone', remote, host);
  await configure(host);
  const forge = path.join(root, `${name}-forge`);
  await git(root, 'clone', remote, forge);
  await configure(forge);
  return { host, remote, forge };
}

/** Everything about a checkout that "unchanged" has to cover. */
async function checkoutIdentity(repo: string) {
  return {
    head: await git(repo, 'rev-parse', 'HEAD'),
    branch: await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status: await git(repo, 'status', '--porcelain'),
    refs: await git(repo, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'),
  };
}

async function inPlaceWorkspace(root: string, repos: string[]): Promise<string> {
  const workspacePath = path.join(root, 'ws');
  await fs.mkdir(workspacePath, { recursive: true });
  const feature: Feature = {
    id: 'ws',
    mode: 'in-place',
    branchName: 'feat/archive',
    description: 'archive',
    repos,
    originalRepos: repos,
    assistants: [],
    workspacePath,
    createdAt: new Date().toISOString(),
  };
  await saveFeatureConfig(workspacePath, feature);
  await fs.writeFile(path.join(workspacePath, 'contextspace-milestones.md'), '# notes\n');
  return workspacePath;
}

/** Commit a file in a worktree and push its branch. */
async function commitAndPush(worktree: string, file: string, branch: string): Promise<string> {
  await fs.writeFile(path.join(worktree, file), `${file}\n`);
  await git(worktree, 'add', file);
  await git(worktree, 'commit', '-m', `add ${file}`);
  await git(worktree, 'push', '-u', 'origin', branch);
  return git(worktree, 'rev-parse', 'HEAD');
}

/** Merge a pushed branch into main the way a forge would (merge commit). */
async function mergeOnForge(forge: string, branch: string): Promise<void> {
  await git(forge, 'fetch', 'origin');
  await git(forge, 'checkout', 'main');
  await git(forge, 'pull', '--ff-only', 'origin', 'main');
  await git(forge, 'merge', '--no-ff', '-m', `Merge ${branch}`, `origin/${branch}`);
  await git(forge, 'push', 'origin', 'main');
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

describe('archiveWorkspace (real git)', { timeout: 90_000 }, () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cs-archive-')));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('removes a merged worktree, keeps the record and the branch, and never changes the checkout', async () => {
    const { host, forge } = await hostWithRemote(root, 'api');
    const workspacePath = await inPlaceWorkspace(root, [host]);
    const { worktreePath } = await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/archive' });
    const tip = await commitAndPush(worktreePath, 'feature.txt', 'feat/archive');
    await mergeOnForge(forge, 'feat/archive');
    const before = await checkoutIdentity(host);

    const preview = await planArchive(workspacePath, { dryRun: true });
    expect(preview.ready).toBe(true);
    expect(preview.repos[0]).toMatchObject({ action: 'remove-worktree', branchState: 'merged', mergeEvidence: 'ancestor' });
    expect(preview.kept).toContain('contextspace-milestones.md');
    expect(preview.kept).not.toContain('api');
    expect(await exists(worktreePath)).toBe(true);

    const report = await archiveWorkspace(workspacePath);

    expect(report).toMatchObject({ archived: true, ready: true, errors: [] });
    expect(await exists(worktreePath)).toBe(false);
    expect(await checkoutIdentity(host)).toEqual(before);
    expect(await git(host, 'rev-parse', 'refs/heads/feat/archive')).toBe(tip);
    expect(await git(host, 'worktree', 'list', '--porcelain')).not.toContain(worktreePath);
    expect(await fs.readFile(path.join(workspacePath, 'contextspace-milestones.md'), 'utf-8')).toBe('# notes\n');

    const feature = (await loadFeatureConfig(workspacePath))!;
    expect(feature.archivedAt).toBe(report.archivedAt);
    expect(feature.mode).toBe('in-place');
    expect(feature.repos).toEqual([host]);
    expect(feature.isolatedRepos).toBeUndefined();
    expect(feature.archive?.repos[0]).toMatchObject({
      name: 'api', access: 'isolated', branch: 'feat/archive', headSha: tip, branchState: 'merged', worktreePath,
    });
    expect((await loadWorkspaceState(workspacePath)).lastArchive?.status).toBe('completed');
    const listed = await listWorkspaces(root);
    expect(listed.find((w) => w.id === 'ws')?.archivedAt).toBe(report.archivedAt);
  });

  it('blocks dirty, unpushed and never-pushed work and removes nothing', async () => {
    const a = await hostWithRemote(root, 'dirty');
    const b = await hostWithRemote(root, 'unpushed');
    const c = await hostWithRemote(root, 'local');
    const workspacePath = await inPlaceWorkspace(root, [a.host, b.host, c.host]);
    const dirty = (await isolateWorkspaceRepo(workspacePath, 'dirty', { branchName: 'feat/archive' })).worktreePath;
    const unpushed = (await isolateWorkspaceRepo(workspacePath, 'unpushed', { branchName: 'feat/archive' })).worktreePath;
    const local = (await isolateWorkspaceRepo(workspacePath, 'local', { branchName: 'feat/archive' })).worktreePath;
    await fs.writeFile(path.join(dirty, 'untracked.txt'), 'work in progress\n');
    await commitAndPush(unpushed, 'one.txt', 'feat/archive');
    await fs.writeFile(path.join(unpushed, 'two.txt'), 'two\n');
    await git(unpushed, 'add', 'two.txt');
    await git(unpushed, 'commit', '-m', 'not pushed');
    await fs.writeFile(path.join(local, 'x.txt'), 'x\n');
    await git(local, 'add', 'x.txt');
    await git(local, 'commit', '-m', 'never pushed');
    const manifest = await fs.readFile(path.join(workspacePath, 'contextspace.json'), 'utf-8');

    const report = await archiveWorkspace(workspacePath);

    expect(report.archived).toBe(false);
    expect(report.ready).toBe(false);
    expect(Object.fromEntries(report.repos.map((r) => [r.name, r.branchState]))).toEqual({
      dirty: 'dirty', unpushed: 'unpushed', local: 'unpushed',
    });
    expect(report.blockers.join(' ')).toMatch(/1 uncommitted file/);
    expect(report.blockers.join(' ')).toMatch(/1 commit\(s\) on "feat\/archive" are not pushed/);
    expect(report.blockers.join(' ')).toMatch(/never pushed/);
    for (const worktree of [dirty, unpushed, local]) expect(await exists(worktree)).toBe(true);
    expect(await fs.readFile(path.join(workspacePath, 'contextspace.json'), 'utf-8')).toBe(manifest);
    expect((await loadWorkspaceState(workspacePath)).lastArchive).toBeUndefined();
  });

  it('refuses pushed-but-unmerged work unless parked, then keeps its branch', async () => {
    const { host } = await hostWithRemote(root, 'api');
    const workspacePath = await inPlaceWorkspace(root, [host]);
    const { worktreePath } = await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/archive' });
    const tip = await commitAndPush(worktreePath, 'parked.txt', 'feat/archive');

    const refused = await archiveWorkspace(workspacePath);
    expect(refused.archived).toBe(false);
    expect(refused.repos[0]!.branchState).toBe('unmerged');
    expect(refused.blockers[0]).toMatch(/--park/);
    expect(await exists(worktreePath)).toBe(true);

    const parked = await archiveWorkspace(workspacePath, { park: true });
    expect(parked.archived).toBe(true);
    expect(await exists(worktreePath)).toBe(false);
    expect(await git(host, 'rev-parse', 'refs/heads/feat/archive')).toBe(tip);
    const feature = (await loadFeatureConfig(workspacePath))!;
    expect(feature.archive).toMatchObject({ parked: true, repos: [{ branchState: 'parked', headSha: tip }] });
  });

  it('an isolated branch with no new commits counts as merged', async () => {
    const { host } = await hostWithRemote(root, 'api');
    const workspacePath = await inPlaceWorkspace(root, [host]);
    await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/archive' });

    const report = await archiveWorkspace(workspacePath);
    expect(report.archived).toBe(true);
    expect(report.repos[0]).toMatchObject({ branchState: 'merged', mergeEvidence: 'ancestor' });
  });

  it('a worktree-mode workspace is all-or-nothing, then archives into references over its sources', async () => {
    const a = await hostWithRemote(root, 'web');
    const b = await hostWithRemote(root, 'api');
    const workspacePath = path.join(root, 'ws');
    await fs.mkdir(workspacePath, { recursive: true });
    const worktrees = [path.join(workspacePath, 'web'), path.join(workspacePath, 'api')];
    await git(a.host, 'worktree', 'add', '-b', 'feat/x', worktrees[0]!, 'origin/main');
    await git(b.host, 'worktree', 'add', '-b', 'feat/x', worktrees[1]!, 'origin/main');
    await saveFeatureConfig(workspacePath, {
      id: 'feat/x', mode: 'worktree', branchName: 'feat/x', description: 'x',
      repos: worktrees, originalRepos: [a.host, b.host], assistants: [], workspacePath,
      createdAt: new Date().toISOString(),
    });
    await commitAndPush(worktrees[0]!, 'web.txt', 'feat/x');
    await mergeOnForge(a.forge, 'feat/x');
    await fs.writeFile(path.join(worktrees[1]!, 'dirty.txt'), 'dirty\n');
    const hosts = [await checkoutIdentity(a.host), await checkoutIdentity(b.host)];

    const blocked = await archiveWorkspace(workspacePath);
    expect(blocked.archived).toBe(false);
    expect(blocked.repos.map((r) => r.action)).toEqual(['remove-worktree', 'blocked']);
    for (const worktree of worktrees) expect(await exists(worktree)).toBe(true);

    await fs.rm(path.join(worktrees[1]!, 'dirty.txt'));
    const archived = await archiveWorkspace(workspacePath);
    expect(archived.archived).toBe(true);
    for (const worktree of worktrees) expect(await exists(worktree)).toBe(false);
    expect([await checkoutIdentity(a.host), await checkoutIdentity(b.host)]).toEqual(hosts);
    const feature = (await loadFeatureConfig(workspacePath))!;
    expect(feature).toMatchObject({ mode: 'in-place', repos: [a.host, b.host], archive: { previousMode: 'worktree' } });
    expect(feature.archive?.repos.map((r) => r.access)).toEqual(['worktree', 'worktree']);
  });

  it('an interrupted archive resumes without repeating removed worktrees', async () => {
    const a = await hostWithRemote(root, 'one');
    const b = await hostWithRemote(root, 'two');
    const workspacePath = await inPlaceWorkspace(root, [a.host, b.host]);
    const one = (await isolateWorkspaceRepo(workspacePath, 'one', { branchName: 'feat/archive' })).worktreePath;
    const two = (await isolateWorkspaceRepo(workspacePath, 'two', { branchName: 'feat/archive' })).worktreePath;
    const tipOne = await git(one, 'rev-parse', 'HEAD');
    // A locked worktree refuses removal without --force: the run stops part-way.
    await git(b.host, 'worktree', 'lock', two);

    const partial = await archiveWorkspace(workspacePath);
    expect(partial.archived).toBe(false);
    expect(partial.errors.join(' ')).toMatch(/two: could not remove/);
    expect(await exists(one)).toBe(false);
    expect(await exists(two)).toBe(true);
    expect((await loadFeatureConfig(workspacePath))?.archivedAt).toBeUndefined();
    expect((await loadWorkspaceState(workspacePath)).lastArchive).toMatchObject({
      status: 'partial',
      repos: [{ name: 'one', removed: true, headSha: tipOne }, { name: 'two', removed: false }],
    });

    await git(b.host, 'worktree', 'unlock', two);
    const resumed = await archiveWorkspace(workspacePath);
    expect(resumed.resumedFrom).toBe('partial');
    expect(resumed.archived).toBe(true);
    expect(resumed.repos[0]).toMatchObject({ name: 'one', action: 'already-removed', headSha: tipOne });
    expect((await loadFeatureConfig(workspacePath))?.archive?.repos.map((r) => r.headSha)).toEqual([tipOne, await git(b.host, 'rev-parse', 'refs/heads/feat/archive')]);
  });

  it('refuses to remove the worktree this process is running in', async () => {
    const { host } = await hostWithRemote(root, 'api');
    const workspacePath = await inPlaceWorkspace(root, [host]);
    const { worktreePath } = await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/archive' });
    const cwd = process.cwd();
    process.chdir(worktreePath);
    try {
      const report = await archiveWorkspace(workspacePath);
      expect(report.archived).toBe(false);
      expect(report.blockers[0]).toMatch(/running inside/);
    } finally {
      process.chdir(cwd);
    }
    expect(await exists(worktreePath)).toBe(true);
  });

  it('an archived workspace refuses repository changes until it is unarchived', async () => {
    const { host } = await hostWithRemote(root, 'api');
    const workspacePath = await inPlaceWorkspace(root, [host]);
    await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/archive' });
    expect((await archiveWorkspace(workspacePath)).archived).toBe(true);

    await expect(commitWorkspace(workspacePath, 'wip')).rejects.toBeInstanceOf(ArchivedWorkspaceError);
    await expect(isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/again' })).rejects.toBeInstanceOf(ArchivedWorkspaceError);
    await expect(syncWorkspace(workspacePath)).rejects.toBeInstanceOf(ArchivedWorkspaceError);
    await expect(verifyWorkspace(workspacePath)).rejects.toBeInstanceOf(ArchivedWorkspaceError);
    await expect(finishWorkspace(workspacePath)).rejects.toBeInstanceOf(ArchivedWorkspaceError);
    expect((await archiveWorkspace(workspacePath)).alreadyArchived).toBe(true);

    const restored = await unarchiveWorkspace(workspacePath);
    expect(restored.restored).toBe(true);
    const feature = (await loadFeatureConfig(workspacePath))!;
    expect(feature.archivedAt).toBeUndefined();
    expect(feature.archive?.unarchivedAt).toBeTruthy();
    const again = await isolateWorkspaceRepo(workspacePath, 'api', { branchName: 'feat/again' });
    expect(await exists(again.worktreePath)).toBe(true);
    expect((await unarchiveWorkspace(workspacePath)).restored).toBe(false);
  });
});
