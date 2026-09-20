import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cockpitStore, upcastWorkspaceToCockpit } from './cockpitStore.js';
import type { Feature, WorkspaceLifecycle, WorkspaceStatus, WorkspaceVerificationReport } from '../../types.js';

test('cockpitStore initializes with clean default state and idle gate telemetry', () => {
  cockpitStore.reset();
  const state = cockpitStore.getState();
  assert.equal(state.workspaceId, null);
  assert.equal(state.iterations.length, 0);
  assert.equal(state.gateStatus.overallStatus, 'idle');
  assert.equal(state.activeIterationId, null);
  assert.equal(state.activeWorktreeId, null);
});

test('upcastWorkspaceToCockpit maps real lifecycle.steps into development iterations', () => {
  const feature = {
    branchName: 'refactors_before_prod',
    description: 'Prepare enterprise service for production deployment',
    repos: ['/src/repos/service'],
    isolatedRepos: {},
  } as unknown as Feature;

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: 'refactors_before_prod',
    flowType: 'epic',
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: 'step-arch',
        title: 'Architecture Blueprint',
        description: 'Establish contracts and isolation barriers',
        status: 'completed',
      },
      {
        id: 'step-impl',
        title: 'Core Engine Refactor',
        description: 'Rewrite payment pipelines',
        status: 'in_progress',
      },
      {
        id: 'step-review',
        title: 'Security Review',
        description: 'Static analysis and penetration test',
        status: 'pending',
      },
    ],
  };

  const status: WorkspaceStatus = {
    branchName: 'refactors_before_prod',
    changedFiles: 3,
    aheadCount: 1,
    behindCount: 0,
    syncStatus: 'synced',
    activeAssistants: [],
  };

  const cockpitData = upcastWorkspaceToCockpit(feature, lifecycle, status);

  assert.equal(cockpitData.iterations.length, 3);
  assert.equal(cockpitData.iterations[0].title, 'Iteration 1: Architecture Blueprint');
  assert.equal(cockpitData.iterations[0].status, 'done');

  // In-progress step with changedFiles > 0 becomes review_ready
  assert.equal(cockpitData.iterations[1].title, 'Iteration 2: Core Engine Refactor');
  assert.equal(cockpitData.iterations[1].status, 'review_ready');
  assert.equal(cockpitData.iterations[1].changesCount, 3);

  assert.equal(cockpitData.iterations[2].title, 'Iteration 3: Security Review');
  assert.equal(cockpitData.iterations[2].status, 'planned');
});

test('upcastWorkspaceToCockpit provides clean fallback with ZERO mock data leakage', () => {
  const feature = {
    branchName: 'feat-inventory-sync',
    description: 'Inventory Synchronization Microservice',
    repos: ['/src/repos/inventory'],
    isolatedRepos: {},
  } as unknown as Feature;

  const status: WorkspaceStatus = {
    branchName: 'feat-inventory-sync',
    changedFiles: 0,
    aheadCount: 0,
    behindCount: 0,
    syncStatus: 'clean',
    activeAssistants: [],
  };

  // Upcasting with null lifecycle and null plan
  const cockpitData = upcastWorkspaceToCockpit(feature, null, status);

  assert.equal(cockpitData.iterations.length, 1);
  assert.equal(cockpitData.iterations[0].title, 'Inventory Synchronization Microservice');
  assert.equal(cockpitData.iterations[0].status, 'planned');

  // Crucial anti-cheat & leakage assertion: "Vacation Agreement Calc" must NOT exist
  const titles = cockpitData.iterations.map((it) => it.title);
  const serialized = JSON.stringify(cockpitData);
  assert.ok(!titles.some((t) => t.includes('Vacation Agreement Calc')));
  assert.ok(!titles.some((t) => t.includes('Vacation Debt Engine')));
  assert.ok(!titles.some((t) => t.includes('Agreement Rules Integration')));
  assert.ok(!serialized.includes('Vacation Agreement'));
  assert.ok(!serialized.includes('Vacation Debt'));
});

test('upcastWorkspaceToCockpit parses markdown milestones from planContent as secondary fallback', () => {
  const feature = {
    branchName: 'feature-plan-based',
    description: 'Plan based workspace',
    repos: ['/src/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  const planMarkdown = `
# Workspace Plan
1. **Database Schema Setup** — [x] done complete
2. **API Endpoint Handlers** — in progress implementation
3. **Integration Verification** — pending e2e tests
`;

  const cockpitData = upcastWorkspaceToCockpit(feature, null, undefined, planMarkdown);

  assert.equal(cockpitData.iterations.length, 3);
  assert.ok(cockpitData.iterations[0].title.includes('Database Schema Setup'));
  assert.equal(cockpitData.iterations[0].status, 'done');
  assert.ok(cockpitData.iterations[1].title.includes('API Endpoint Handlers'));
  assert.ok(cockpitData.iterations[2].title.includes('Integration Verification'));
});

test('upcastWorkspaceToCockpit calculates mechanical gateStatus from verificationReport', () => {
  const feature = {
    branchName: 'feat-test-gate',
    description: 'Test gate workspace',
    repos: ['/src/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  const reportPass: WorkspaceVerificationReport = {
    overallStatus: 'pass',
    canProgress: true,
    durationMs: 450,
    repos: [{ repoName: 'app', status: 'pass', command: 'npm test', exitCode: 0 }],
  };

  const dataPass = upcastWorkspaceToCockpit(feature, null, undefined, null, reportPass);
  assert.equal(dataPass.gateStatus.overallStatus, 'pass');
  assert.equal(dataPass.gateStatus.durationMs, 450);

  const reportFail: WorkspaceVerificationReport = {
    overallStatus: 'fail',
    canProgress: false,
    durationMs: 820,
    repos: [{ repoName: 'app', status: 'fail', command: 'npm test', exitCode: 1 }],
  };

  const dataFail = upcastWorkspaceToCockpit(feature, null, undefined, null, reportFail);
  assert.equal(dataFail.gateStatus.overallStatus, 'fail');
  assert.equal(dataFail.gateStatus.durationMs, 820);
});

test('cockpitStore prevents cross-workspace state leakage on workspace switch', () => {
  cockpitStore.reset();

  // 1. Ingest Workspace A
  cockpitStore.setWorkspaceData({
    workspaceId: 'workspace-a',
    workspaceTitle: 'Workspace A Title',
    workspaceIntent: 'Intent A',
    iterations: [
      { id: 'iter-a1', number: 1, title: 'Iter A1', status: 'done' },
      { id: 'iter-a2', number: 2, title: 'Iter A2', status: 'review_ready' },
    ],
    worktrees: {
      'wt-a': {
        id: 'wt-a',
        repoName: 'repo-a',
        branchName: 'branch-a',
        title: 'Worktree A',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
    activeIterationId: 'iter-a2',
    activeWorktreeId: 'wt-a',
  });

  let state = cockpitStore.getState();
  assert.equal(state.workspaceId, 'workspace-a');
  assert.equal(state.activeIterationId, 'iter-a2');
  assert.equal(state.activeWorktreeId, 'wt-a');

  // 2. Switch to Workspace B (without explicitly passing active IDs)
  cockpitStore.setWorkspaceData({
    workspaceId: 'workspace-b',
    workspaceTitle: 'Workspace B Title',
    workspaceIntent: 'Intent B',
    iterations: [
      { id: 'iter-b1', number: 1, title: 'Iter B1', status: 'agent_running' },
      { id: 'iter-b2', number: 2, title: 'Iter B2', status: 'planned' },
    ],
    worktrees: {
      'wt-b': {
        id: 'wt-b',
        repoName: 'repo-b',
        branchName: 'branch-b',
        title: 'Worktree B',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
  });

  state = cockpitStore.getState();
  assert.equal(state.workspaceId, 'workspace-b');
  // Stale 'iter-a2' from Workspace A MUST NOT LEAK!
  assert.notEqual(state.activeIterationId, 'iter-a2');
  // Must automatically select Workspace B's running iteration
  assert.equal(state.activeIterationId, 'iter-b1');
  // Stale 'wt-a' from Workspace A MUST NOT LEAK!
  assert.notEqual(state.activeWorktreeId, 'wt-a');
  assert.equal(state.activeWorktreeId, 'wt-b');
});

test('cockpitStore preserves selection during same-workspace updates', () => {
  cockpitStore.reset();

  cockpitStore.setWorkspaceData({
    workspaceId: 'workspace-a',
    workspaceTitle: 'Workspace A Title',
    workspaceIntent: 'Intent A',
    iterations: [
      { id: 'iter-a1', number: 1, title: 'Iter A1', status: 'done' },
      { id: 'iter-a2', number: 2, title: 'Iter A2', status: 'planned' },
    ],
    worktrees: {
      'wt-a1': {
        id: 'wt-a1',
        repoName: 'repo-a',
        branchName: 'branch-a1',
        title: 'Worktree A1',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
      'wt-a2': {
        id: 'wt-a2',
        repoName: 'repo-a',
        branchName: 'branch-a2',
        title: 'Worktree A2',
        isCurrent: false,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
  });

  // User explicitly selects iter-a2 and wt-a2
  cockpitStore.selectIteration('iter-a2');
  cockpitStore.selectWorktree('wt-a2');

  assert.equal(cockpitStore.getState().activeIterationId, 'iter-a2');
  assert.equal(cockpitStore.getState().activeWorktreeId, 'wt-a2');

  // Same workspace polling update without activeIterationId
  cockpitStore.setWorkspaceData({
    workspaceId: 'workspace-a',
    workspaceTitle: 'Workspace A Title Updated',
    workspaceIntent: 'Intent A',
    iterations: [
      { id: 'iter-a1', number: 1, title: 'Iter A1', status: 'done' },
      { id: 'iter-a2', number: 2, title: 'Iter A2', status: 'review_ready', changesCount: 4 },
    ],
    worktrees: {
      'wt-a1': {
        id: 'wt-a1',
        repoName: 'repo-a',
        branchName: 'branch-a1',
        title: 'Worktree A1',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
      'wt-a2': {
        id: 'wt-a2',
        repoName: 'repo-a',
        branchName: 'branch-a2',
        title: 'Worktree A2',
        isCurrent: false,
        dirtyFilesCount: 4,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
  });

  // User's selections must be preserved across same-workspace data updates
  assert.equal(cockpitStore.getState().activeIterationId, 'iter-a2');
  assert.equal(cockpitStore.getState().activeWorktreeId, 'wt-a2');
});

test('upcastWorkspaceToCockpit sets fallback iteration to agent_running when assistants are active', () => {
  const feature = {
    branchName: 'feat-running-agent',
    description: 'Active agent worker',
    repos: ['/src/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  const status: WorkspaceStatus = {
    branchName: 'feat-running-agent',
    changedFiles: 0,
    aheadCount: 0,
    behindCount: 0,
    syncStatus: 'synced',
    activeAssistants: ['agent-1'],
  };

  const data = upcastWorkspaceToCockpit(feature, null, status);
  assert.equal(data.iterations.length, 1);
  assert.equal(data.iterations[0].status, 'agent_running');
});

test('upcastWorkspaceToCockpit pairs lifecycle steps with matching branch-keyed worktrees', () => {
  const feature = {
    branchName: 'epic-multi-branch',
    description: 'Multi-branch feature',
    repos: ['/src/repos/core'],
    isolatedRepos: {
      core: {
        branchName: 'feat-worker-sub',
        worktreePath: '/isolated/worker-sub',
      },
    },
  } as unknown as Feature;

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: 'epic-multi-branch',
    flowType: 'epic',
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: 'step-sub',
        title: 'Worker Subtask',
        branch: 'feat-worker-sub',
        status: 'in_progress',
      },
    ],
  };

  const data = upcastWorkspaceToCockpit(feature, lifecycle);
  assert.equal(data.iterations.length, 1);
  assert.equal(data.iterations[0].branchName, 'feat-worker-sub');
  // Find the worktree for this branch
  const matchingWt = Object.values(data.worktrees).find((wt) => wt.branchName === 'feat-worker-sub');
  assert.ok(matchingWt);
  assert.equal(data.iterations[0].worktreeId, matchingWt.id);
});

test('cockpitStore stage, diff mode, and zen mode toggling', () => {
  cockpitStore.reset();
  assert.equal(cockpitStore.getState().activeStage, 'diff');
  assert.equal(cockpitStore.getState().diffViewMode, 'side-by-side');
  assert.equal(cockpitStore.getState().isZenMode, false);

  cockpitStore.setActiveStage('plan');
  assert.equal(cockpitStore.getState().activeStage, 'plan');

  cockpitStore.toggleDiffMode();
  assert.equal(cockpitStore.getState().diffViewMode, 'unified');

  cockpitStore.toggleZenMode();
  assert.equal(cockpitStore.getState().isZenMode, true);
});

