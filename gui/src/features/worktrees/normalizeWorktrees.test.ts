import test from 'node:test';
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
  // Feature worktree and host worktree
  assert.equal(groups[0]?.worktrees.length, 2);
  const featWt = groups[0]?.worktrees[0];
  assert.ok(featWt?.id.startsWith('wt-calc-head'));
  assert.equal(featWt?.title, 'Vacation engine');
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
