import { test } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeWorktreeGroups, formatBranchTitle } from './normalizeWorktrees.ts';
import type { Feature } from '../../types.ts';

test('normalizeWorktreeGroups handles null and undefined safely without throwing', () => {
  // @ts-expect-error Testing defensive runtime handling of invalid inputs
  assert.deepEqual(normalizeWorktreeGroups(null), []);
  // @ts-expect-error Testing defensive runtime handling of invalid inputs
  assert.deepEqual(normalizeWorktreeGroups(undefined), []);
  // @ts-expect-error Testing defensive runtime handling of invalid inputs
  assert.deepEqual(normalizeWorktreeGroups({}), []);
});

test('normalizeWorktreeGroups handles missing branchName in isolatedRepos', () => {
  const feature = {
    branchName: 'epic-vacation',
    description: 'Vacation engine',
    repos: ['/src/repos/calc'],
    isolatedRepos: {
      calc: {} as unknown,
    },
  } as unknown as Feature;

  const groups = normalizeWorktreeGroups(feature);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.repoName, 'calc');
  // Do not invent a second checkout when the isolated path is missing.
  assert.equal(groups[0]?.worktrees.length, 1);
  const featWt = groups[0]?.worktrees[0];
  assert.ok(featWt?.id.startsWith('wt-calc-epic-vacation'));
  assert.equal(featWt?.title, 'Vacation engine');
});

test('normal and legacy worktree manifests retain their feature branch and dirty status', () => {
  for (const mode of [undefined, 'worktree'] as const) {
    const feature = { mode, branchName: 'feature-review', repos: ['/ws/review/app'], originalRepos: ['/source/app'] } as Feature;
    const [group] = normalizeWorktreeGroups(feature, { changedFiles: 3 } as any);
    const [working, host] = group.worktrees;
    assert.equal(working.branchName, 'feature-review');
    assert.equal(working.worktreePath, '/ws/review/app');
    assert.equal(working.isHostReadOnly, false);
    assert.equal(working.dirtyFilesCount, 3);
    assert.equal(working.status, 'dirty');
    assert.equal(host.worktreePath, '/source/app');
    assert.equal(host.dirtyFilesCount, null);
    assert.equal(host.commitSha, '');
  }
});

test('unprepared in-place repositories are read-only references and missing telemetry stays unknown', () => {
  const feature = { mode: 'in-place', branchName: 'workspace', repos: ['/source/a', '/source/b'], repoBranches: { a: 'develop' } } as Feature;
  const groups = normalizeWorktreeGroups(feature, { changedFiles: 3 } as any);
  assert.equal(groups[0].worktrees.length, 1);
  assert.equal(groups[0].isHostRepo, true);
  assert.equal(groups[0].worktrees[0].branchName, 'develop');
  assert.equal(groups[0].worktrees[0].isHostReadOnly, true);
  assert.equal(groups[0].worktrees[0].status, 'host_readonly');
  assert.equal(groups[0].worktrees[0].dirtyFilesCount, null);
  assert.equal(groups[0].worktrees[0].commitSha, '');
});

test('live repository state replaces manifest guesses for branch, HEAD, path and changes', () => {
  const feature = {
    mode: 'in-place', branchName: 'workspace', repos: ['/source/a', '/source/b'],
    isolatedRepos: { b: { worktreePath: '/ws/b', branchName: 'feat/b', baseBranch: 'main', isolatedAt: '2026-09-27T00:00:00Z' } },
  } as unknown as Feature;
  const live = (name: string, overrides: object) => ({
    name, access: 'reference', editable: false, path: `/source/${name}`, sourcePath: `/source/${name}`, branch: 'main', expectedBranch: null,
    onExpectedBranch: true, baseBranch: 'main', headSha: 'abcdef1234', dirty: false, changedFiles: [], ahead: 0, behind: 0, remoteUrl: null,
    ...overrides,
  }) as any;
  const [a, b] = normalizeWorktreeGroups(feature, undefined, [
    live('a', { branch: 'hotfix' }),
    live('b', { access: 'isolated', editable: true, path: '/ws/b', branch: 'feat/b', expectedBranch: 'feat/b', dirty: true, changedFiles: [{ code: ' M', path: 'x.ts' }] }),
  ]);
  assert.equal(a.worktrees[0].branchName, 'hotfix');
  assert.equal(a.worktrees[0].commitSha, 'abcdef1234');
  assert.equal(a.worktrees[0].status, 'host_readonly');
  assert.equal(b.isHostRepo, false);
  assert.equal(b.worktrees[0].worktreePath, '/ws/b');
  assert.equal(b.worktrees[0].status, 'dirty');
  assert.equal(b.worktrees[0].dirtyFilesCount, 1);
  assert.equal(b.worktrees[1].worktreePath, '/source/b');
});

test('normalizeWorktreeGroups generates unique IDs for repos with identical basenames', () => {
  const feature = {
    branchName: 'feat-multi',
    description: 'Multi-service mono',
    repos: ['/apps/web/client', '/packages/client'],
    isolatedRepos: {
      client: {
        branchName: 'feat-client',
        worktreePath: '/isolated/client',
      },
    },
  } as unknown as Feature;

  const groups = normalizeWorktreeGroups(feature);
  assert.equal(groups.length, 2);

  const ids = groups.flatMap((g) => g.worktrees.map((wt) => wt.id));
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, 'All worktree IDs must be globally unique across repositories');
});

test('formatBranchTitle handles diverse edge cases', () => {
  assert.equal(formatBranchTitle(), 'Untitled Worktree');
  assert.equal(formatBranchTitle(''), 'Untitled Worktree');
  assert.equal(formatBranchTitle('feat/payment-gateway'), 'Payment Gateway');
  assert.equal(formatBranchTitle('fix/null-pointer-exception'), 'Null Pointer Exception');
  assert.equal(formatBranchTitle('epic/vacation-calc_engine'), 'Vacation Calc Engine');
  assert.equal(formatBranchTitle('🚀-rocket-launch'), '🚀 Rocket Launch');
});
