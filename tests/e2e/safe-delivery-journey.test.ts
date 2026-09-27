/**
 * @module tests/e2e/safe-delivery-journey.test
 * Release-QA journey for repository safety, driven through the real HTTP API
 * against disposable repositories and remotes (no user checkout is touched):
 *
 * reference repos → prepare for editing (with a path collision first) →
 * failing verification blocks finish → stale evidence blocks finish →
 * one remote rejects the push → the durable record survives → a re-run
 * resumes without duplicate commits → the source checkouts never changed.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

let workspacesDir = '';
vi.mock('../../src/core/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/config.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(async () => ({ ...actual.getDefaultConfig(), workspacesDir, devDir: path.dirname(workspacesDir) })),
  };
});

const { app } = await import('../../src/server.js');
const { saveFeatureConfig } = await import('../../src/core/workspace.js');

const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout.trim();

async function hostWithRemote(root: string, name: string): Promise<{ host: string; remote: string }> {
  const remote = path.join(root, `${name}.git`);
  const seed = path.join(root, `${name}-seed`);
  await fs.mkdir(seed, { recursive: true });
  await git(seed, 'init', '-b', 'main');
  await git(seed, 'config', 'user.name', 'Test');
  await git(seed, 'config', 'user.email', 'test@example.com');
  await fs.writeFile(path.join(seed, 'test.mjs'), "import { existsSync } from 'node:fs';\nprocess.exit(existsSync('FAIL') ? 1 : 0);\n");
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-m', 'initial');
  await git(root, 'init', '--bare', '-b', 'main', remote);
  await git(seed, 'remote', 'add', 'origin', remote);
  await git(seed, 'push', '-u', 'origin', 'main');
  const host = path.join(root, name);
  await git(root, 'clone', remote, host);
  await git(host, 'config', 'user.name', 'Test');
  await git(host, 'config', 'user.email', 'test@example.com');
  return { host, remote };
}

async function identity(repo: string) {
  return {
    head: await git(repo, 'rev-parse', 'HEAD'),
    branch: await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'),
    status: (await execa('git', ['status', '--porcelain'], { cwd: repo })).stdout,
    main: await git(repo, 'rev-parse', 'refs/heads/main'),
  };
}

async function call(method: 'GET' | 'POST', route: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await app.request(route, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe('safe delivery journey through the real server', { timeout: 180_000 }, () => {
  let root: string;
  let api: { host: string; remote: string };
  let web: { host: string; remote: string };
  let hostsBefore: Record<string, Awaited<ReturnType<typeof identity>>>;
  const ws = '/api/workspace/journey';

  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cs-journey-')));
    workspacesDir = path.join(root, 'workspaces');
    api = await hostWithRemote(root, 'api');
    web = await hostWithRemote(root, 'web');
    // The user has their own uncommitted work in a checkout; it must survive untouched.
    await fs.writeFile(path.join(api.host, 'scratch.txt'), 'user notes\n');
    const workspacePath = path.join(workspacesDir, 'journey');
    await fs.mkdir(workspacePath, { recursive: true });
    await saveFeatureConfig(workspacePath, {
      id: 'journey',
      mode: 'in-place',
      branchName: 'feat/journey',
      description: 'safe delivery journey',
      repos: [api.host, web.host],
      originalRepos: [api.host, web.host],
      assistants: [],
      workspacePath,
      createdAt: new Date().toISOString(),
    });
    hostsBefore = { api: await identity(api.host), web: await identity(web.host) };
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('starts with read-only references that commit refuses to change', async () => {
    const repos = await call('GET', `${ws}/repositories`);
    expect(repos.status).toBe(200);
    expect(repos.json.repositories.map((r: any) => [r.name, r.access, r.editable])).toEqual([
      ['api', 'reference', false],
      ['web', 'reference', false],
    ]);

    const named = await call('POST', `${ws}/commit`, { message: 'wip', files: { api: ['scratch.txt'] } });
    expect(named.status).toBe(409);
    expect(named.json.code).toBe('REFERENCE_REPO');

    const all = await call('POST', `${ws}/commit`, { message: 'wip' });
    expect(all.status).toBe(200);
    expect(all.json.results).toEqual([]);
    expect(all.json.skipped.map((s: any) => s.name)).toEqual(['api']);
  });

  it('previews isolation, refuses a path collision, then prepares both repos', async () => {
    const workspacePath = path.join(workspacesDir, 'journey');
    const preview = await call('POST', `${ws}/isolate`, { repo: 'api', branchName: 'feat/journey', dryRun: true });
    expect(preview.json).toMatchObject({ repoName: 'api', worktreePath: path.join(workspacePath, 'api'), branchName: 'feat/journey', baseBranch: 'main', conflicts: [] });

    await fs.mkdir(path.join(workspacePath, 'web'));
    const collision = await call('POST', `${ws}/isolate`, { repo: 'web', branchName: 'feat/journey' });
    expect(collision.status).toBe(409);
    expect(collision.json.code).toBe('ISOLATION_CONFLICT');
    await fs.rmdir(path.join(workspacePath, 'web'));

    for (const repo of ['api', 'web']) {
      const result = await call('POST', `${ws}/isolate`, { repo, branchName: 'feat/journey' });
      expect(result.status).toBe(200);
    }
    const repos = await call('GET', `${ws}/repositories`);
    expect(repos.json.repositories.map((r: any) => [r.name, r.access, r.path, r.branch])).toEqual([
      ['api', 'isolated', path.join(workspacePath, 'api'), 'feat/journey'],
      ['web', 'isolated', path.join(workspacePath, 'web'), 'feat/journey'],
    ]);
  });

  it('blocks finish on failing and then stale verification, changing nothing', async () => {
    const workspacePath = path.join(workspacesDir, 'journey');
    await fs.writeFile(path.join(workspacePath, 'api', 'feature.txt'), 'v1\n');
    await fs.writeFile(path.join(workspacePath, 'web', 'FAIL'), '');

    const failing = await call('POST', `${ws}/verify`, { command: 'node test.mjs', allowDirty: true });
    expect(failing.json.report.overallStatus).toBe('fail');
    const refusedFailing = await call('POST', `${ws}/finish`, { message: 'feat: journey' });
    expect(refusedFailing.status).toBe(409);
    expect(refusedFailing.json.blocked).toBe(true);
    expect(refusedFailing.json.policy.repos.map((r: any) => r.state)).toEqual(['passed-dirty', 'failed']);

    await fs.rm(path.join(workspacePath, 'web', 'FAIL'));
    await fs.writeFile(path.join(workspacePath, 'web', 'page.txt'), 'v1\n');
    const passing = await call('POST', `${ws}/verify`, { command: 'node test.mjs', allowDirty: true });
    expect(passing.json.report.overallStatus).toBe('pass_dirty');

    await fs.appendFile(path.join(workspacePath, 'api', 'feature.txt'), 'edited after verification\n');
    const refusedStale = await call('POST', `${ws}/finish`, { message: 'feat: journey' });
    expect(refusedStale.status).toBe(409);
    expect((await call('GET', `${ws}/progression`)).json.repos.map((r: any) => r.state)).toEqual(['stale', 'passed-dirty']);
    expect(await git(path.join(workspacePath, 'api'), 'rev-parse', 'HEAD')).toBe(hostsBefore.api!.main);

    const badOverride = await call('POST', `${ws}/finish`, { message: 'feat: journey', overrideReason: 'ok' });
    expect(badOverride.status).toBe(400);
  });

  it('survives a rejected push and resumes without committing twice', async () => {
    const workspacePath = path.join(workspacesDir, 'journey');
    const fresh = await call('POST', `${ws}/verify`, { command: 'node test.mjs', allowDirty: true });
    expect(fresh.json.report.overallStatus).toBe('pass_dirty');

    const preview = await call('POST', `${ws}/finish`, { message: 'feat: journey', dryRun: true });
    expect(preview.json.repos.map((r: any) => [r.name, r.wouldCommit, r.wouldPush, r.branch])).toEqual([
      ['api', true, true, 'feat/journey'],
      ['web', true, true, 'feat/journey'],
    ]);

    // One remote goes away mid-delivery.
    const webRepo = path.join(workspacePath, 'web');
    await git(webRepo, 'remote', 'set-url', 'origin', path.join(root, 'offline.git'));
    const partial = await call('POST', `${ws}/finish`, { message: 'feat: journey' });
    expect(partial.status).toBe(200);
    const [apiResult, webResult] = partial.json.repos;
    expect(apiResult).toMatchObject({ name: 'api', committed: true, pushed: true });
    expect(webResult).toMatchObject({ name: 'web', committed: true, pushed: false });
    expect(webResult.error).toBeTruthy();
    expect(partial.json.safeToCleanup).toBe(false);

    // What a restarted app reads back.
    const last = await call('GET', `${ws}/finish/last`);
    expect(last.json.lastFinish).toMatchObject({ status: 'partial', safeToCleanup: false });
    expect(last.json.lastFinish.repos.find((r: any) => r.name === 'web').commitHash).toBe(webResult.commitHash);

    await git(webRepo, 'remote', 'set-url', 'origin', web.remote);
    const resumed = await call('POST', `${ws}/finish`, { message: 'feat: journey' });
    expect(resumed.json.resumedFrom).toBe('partial');
    expect(resumed.json.repos.map((r: any) => [r.name, r.committed, r.error ?? null])).toEqual([
      ['api', false, null],
      ['web', false, null],
    ]);
    expect(resumed.json.safeToCleanup).toBe(true);

    // Exactly one delivered commit per repo, on the remote feature branch.
    for (const [name, remote] of [['api', api.remote], ['web', web.remote]] as const) {
      const count = await git(remote, 'rev-list', '--count', 'main..feat/journey');
      expect({ name, count }).toEqual({ name, count: '1' });
    }
  });

  it('never changed the user checkouts', async () => {
    expect({ api: await identity(api.host), web: await identity(web.host) }).toEqual({
      api: { ...hostsBefore.api!, status: hostsBefore.api!.status },
      web: hostsBefore.web,
    });
  });
});
