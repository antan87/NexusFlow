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

test('in-place repositories are editable and missing per-repo telemetry stays unknown', () => {
  const feature = { mode: 'in-place', branchName: 'workspace', repos: ['/source/a', '/source/b'], repoBranches: { a: 'develop' } } as Feature;
  const groups = normalizeWorktreeGroups(feature, { changedFiles: 3 } as any);
  assert.equal(groups[0].worktrees.length, 1);
  assert.equal(groups[0].worktrees[0].branchName, 'develop');
  assert.equal(groups[0].worktrees[0].isHostReadOnly, false);
  assert.equal(groups[0].worktrees[0].dirtyFilesCount, null);
  assert.equal(groups[1].worktrees[0].status, 'unknown');
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
