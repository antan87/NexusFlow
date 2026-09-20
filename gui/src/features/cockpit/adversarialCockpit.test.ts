import { test } from 'vitest';
import assert from 'node:assert/strict';
import { cockpitStore, upcastWorkspaceToCockpit } from './cockpitStore.js';
import type { Feature, WorkspaceLifecycle, WorkspaceStatus, WorkspaceVerificationReport } from '../../types.js';

const FORBIDDEN_MOCK_STRINGS = [
  'Vacation Agreement Calc',
  'Vacation Debt Engine',
  'Agreement Rules Integration',
  'Vacation Agreement',
  'Vacation Debt',
];

function assertNoMockStrings(obj: unknown, context: string) {
  const serialized = JSON.stringify(obj);
  for (const forbidden of FORBIDDEN_MOCK_STRINGS) {
    assert.ok(
      !serialized.toLowerCase().includes(forbidden.toLowerCase()),
      `[MOCK LEAK DETECTED] Found "${forbidden}" in ${context}: ${serialized.slice(0, 200)}...`
    );
  }
}

// ============================================================================
// SUITE 1: ADVERSARIAL MOCK STRING LEAK AUDIT (FUZZING & GENERATIVE FIXTURES)
// ============================================================================
test('SUITE 1: Generative Fuzzing - Zero mock strings across 60 pathological fixtures', () => {
  cockpitStore.reset();

  const branchNames = [
    '',
    'main',
    'feat/user-auth',
    'bugfix/GH-1024_login_failure',
    'epic/payments-v2-reconciliation',
    'refactor/core-engine-v3',
    'special/!@#$%^&*()_+',
    'unicode/日本語ブランチ-テスト',
    'emoji/🚀-launch-prep-🔥',
    'path-traversal/../../etc/passwd',
    'html-inject/<script>alert(1)</script>',
    'whitespace/   spaced   branch   name   ',
    'a',
    'extremely-long-branch-name-that-exceeds-one-hundred-characters-to-test-buffer-and-title-truncation-safety-check',
  ];

  const descriptions = [
    undefined,
    '',
    'a',
    'ab',
    'abc',
    'Short title',
    'Valid Workspace Semantic Description for Review Cockpit',
    'A'.repeat(55),
    'A'.repeat(500),
    'Special characters: <>&"\'`~#@*',
    'Markdown in desc: **bold** _italic_ `code`',
    'Multi\nline\r\ndescription\twith\ttabs',
  ];

  const statuses: (WorkspaceStatus | undefined)[] = [
    undefined,
    { branchName: 'test', changedFiles: 0, aheadCount: 0, behindCount: 0, syncStatus: 'clean', activeAssistants: [] },
    { branchName: 'test', changedFiles: 42, aheadCount: 5, behindCount: 2, syncStatus: 'ahead', activeAssistants: [] },
    { branchName: 'test', changedFiles: 0, aheadCount: 0, behindCount: 0, syncStatus: 'synced', activeAssistants: ['agent-alpha', 'agent-beta'] },
    { branchName: 'test', changedFiles: 15, aheadCount: 3, behindCount: 1, syncStatus: 'diverged', activeAssistants: ['agent-active'] },
  ];

  let fixtureCount = 0;
  for (let i = 0; i < branchNames.length; i++) {
    for (let j = 0; j < descriptions.length; j++) {
      if (fixtureCount >= 60) break;
      const bName = branchNames[i];
      const desc = descriptions[j];
      const st = statuses[(i + j) % statuses.length];

      const feature: Feature = {
        branchName: bName,
        description: desc as any,
        repos: ['/repos/service-core'],
        isolatedRepos: {},
      } as unknown as Feature;

      const result = upcastWorkspaceToCockpit(feature, null, st);
      assertNoMockStrings(result, `fixture #${fixtureCount} (branch="${bName}", desc="${desc}")`);

      // Verify basic invariants
      assert.ok(result.workspaceTitle, 'Workspace title must never be empty');
      assert.ok(result.workspaceIntent, 'Workspace intent must never be empty');
      assert.ok(Array.isArray(result.iterations), 'Iterations must be an array');
      assert.ok(result.iterations.length >= 1, 'Fallback must produce at least 1 iteration');
      assert.ok(result.gateStatus, 'Gate status must be present');
      assert.equal(result.gateStatus.overallStatus, 'idle');

      fixtureCount++;
    }
  }

  assert.ok(fixtureCount >= 60, `Expected at least 60 fixtures tested, got ${fixtureCount}`);
});

// ============================================================================
// SUITE 2: PATHOLOGICAL WORKSPACES & CORRUPTED INPUTS
// ============================================================================
test('SUITE 2.1: Pathological empty and missing fields feature object', () => {
  const emptyFeature = {} as unknown as Feature;
  const result = upcastWorkspaceToCockpit(emptyFeature, null);

  assertNoMockStrings(result, 'emptyFeature');
  assert.equal(result.workspaceTitle, 'Untitled Worktree');
  assert.equal(result.workspaceIntent, 'Workspace Process and Code Review Cockpit');
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].number, 1);
  assert.equal(result.iterations[0].status, 'planned');
});

test('SUITE 2.2: Workspace with 100 lifecycle steps under high load', () => {
  const feature = {
    branchName: 'epic-hundred-steps',
    description: 'Stress testing massive iteration scale',
    repos: ['/repos/huge-mono'],
    isolatedRepos: {},
  } as unknown as Feature;

  const steps = Array.from({ length: 100 }, (_, i) => ({
    id: `step-${i + 1}`,
    title: i % 3 === 0 ? `Milestone ${i + 1}` : `Engine Step ${i + 1}`,
    description: `Detailed description for execution phase ${i + 1}`,
    status: (i < 40 ? 'completed' : i === 40 ? 'in_progress' : 'pending') as 'completed' | 'in_progress' | 'pending',
  }));

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: 'epic-hundred-steps',
    flowType: 'epic',
    updatedAt: new Date().toISOString(),
    steps,
  };

  const status: WorkspaceStatus = {
    branchName: 'epic-hundred-steps',
    changedFiles: 7,
    aheadCount: 2,
    behindCount: 0,
    syncStatus: 'ahead',
    activeAssistants: [],
  };

  const t0 = performance.now();
  const result = upcastWorkspaceToCockpit(feature, lifecycle, status);
  const elapsed = performance.now() - t0;

  assert.ok(elapsed < 50, `100 steps took ${elapsed}ms, should be < 50ms`);
  assert.equal(result.iterations.length, 100);
  assert.equal(result.iterations[0].status, 'done');
  assert.equal(result.iterations[39].status, 'done');
  assert.equal(result.iterations[40].status, 'review_ready'); // in_progress with changedFiles > 0
  assert.equal(result.iterations[40].changesCount, 7);
  assert.equal(result.iterations[41].status, 'planned');
  assert.equal(result.iterations[99].number, 100);

  // Ingest into cockpitStore
  cockpitStore.reset();
  cockpitStore.setWorkspaceData({
    workspaceId: 'epic-hundred-steps',
    workspaceTitle: result.workspaceTitle,
    workspaceIntent: result.workspaceIntent,
    iterations: result.iterations,
    worktrees: result.worktrees,
  });

  const state = cockpitStore.getState();
  // Automatically selects in_progress (review_ready) iteration 41 (id: step-41)
  assert.equal(state.activeIterationId, 'iter-step-41');
});

test('SUITE 2.3: Pathological & corrupted markdown planContent parsing', () => {
  const feature = {
    branchName: 'feature-corrupted-plan',
    description: 'Corrupted Plan Test',
    repos: ['/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  // Case A: 10,000 characters of repeating noise (assert no ReDoS / crash)
  const noiseMarkdown = '# Header\n' + 'Random text without milestones\n'.repeat(500);
  const t0 = performance.now();
  const resNoise = upcastWorkspaceToCockpit(feature, null, undefined, noiseMarkdown);
  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 100, `ReDoS check: took ${elapsed}ms for 500 lines of noise`);
  // When no milestones parsed, should cleanly fall back to initial step
  assert.equal(resNoise.iterations.length, 1);
  assert.equal(resNoise.iterations[0].title, 'Corrupted Plan Test');

  // Case B: Markdown with HTML tags, unclosed brackets, and mixed milestone formats
  const dirtyMarkdown = `
# Plan
- [x] **Milestone 1: Clean Architecture Setup** — done
- [ ] **Milestone 2: Security & OAuth2** - in progress
- **Ignored Header: Acceptance Criteria**
- Milestone 3: Database Sharding & Failover — verified
- Random bullet point without milestone
1. **Milestone 4: Performance Load Testing**
<script>alert("evil")</script>
* [X] Milestone 5: Production Promotion — completed
## Verification Method
- Do not make this an iteration
`;

  const resDirty = upcastWorkspaceToCockpit(feature, null, {
    branchName: 'feature-corrupted-plan',
    changedFiles: 4,
    aheadCount: 0,
    behindCount: 0,
    syncStatus: 'clean',
    activeAssistants: [],
  }, dirtyMarkdown);

  assertNoMockStrings(resDirty, 'dirtyMarkdown');
  // Expected to parse Milestones 1, 2, 3, 4, 5 and skip Acceptance Criteria & Verification Method
  assert.ok(resDirty.iterations.length >= 4, `Expected at least 4 milestones, got ${resDirty.iterations.length}`);
  const titles = resDirty.iterations.map((i) => i.title);
  console.log('ACTUAL PARSED TITLES:', titles);
  assert.ok(titles.some((t) => t.includes('Clean Architecture Setup')));
  assert.ok(titles.some((t) => t.includes('Security & OAuth2')));
  assert.ok(titles.some((t) => t.includes('Database Sharding')));
  assert.ok(!titles.some((t) => t.toLowerCase().includes('acceptance criteria')));
  assert.ok(!titles.some((t) => t.toLowerCase().includes('verification method')));

  // Milestone 1: done
  const m1 = resDirty.iterations.find((i) => i.title.includes('Clean Architecture Setup'));
  assert.equal(m1?.status, 'done');

  // Milestone 2: first unfinished with changedFiles=4 -> review_ready
  const m2 = resDirty.iterations.find((i) => i.title.includes('Security & OAuth2'));
  assert.equal(m2?.status, 'review_ready');
  assert.equal(m2?.changesCount, 4);
});

test('SUITE 2.4: Lifecycle with unusual / missing step properties', () => {
  const feature = {
    branchName: 'feat-sparse-lifecycle',
    description: 'Sparse Lifecycle Tests',
    repos: ['/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  const sparseLifecycle: WorkspaceLifecycle = {
    workspaceId: 'feat-sparse-lifecycle',
    flowType: 'branch',
    updatedAt: new Date().toISOString(),
    steps: [
      // Missing title, id, and status
      {
        id: '',
        title: '',
        status: 'pending' as any,
      },
      // Status not in typical union
      {
        id: 'weird-status',
        title: 'Weird Status Step',
        status: 'cancelled' as any,
      },
      // Already has "Iteration" in title
      {
        id: 'prefixed-iter',
        title: 'Iteration 99: Custom Title',
        status: 'completed',
      },
    ],
  };

  const result = upcastWorkspaceToCockpit(feature, sparseLifecycle);
  assert.equal(result.iterations.length, 3);
  // Empty title falls back to "Iteration 1"
  assert.equal(result.iterations[0].title, 'Iteration 1');
  assert.equal(result.iterations[0].status, 'planned');
  assert.equal(result.iterations[0].id, 'iter-1');

  // Cancelled status falls back to "planned"
  assert.equal(result.iterations[1].status, 'planned');

  // Existing "Iteration 99" prefix is preserved without double-prefixing
  assert.equal(result.iterations[2].title, 'Iteration 99: Custom Title');
  assert.equal(result.iterations[2].status, 'done');
});

// ============================================================================
// SUITE 3: RAPID WORKSPACE SWITCHING & ACTIVE ID CONCURRENCY ISOLATION
// ============================================================================
test('SUITE 3.1: Rapid workspace switching cycles verify zero cross-workspace bleed', () => {
  cockpitStore.reset();

  // Create 3 distinct workspaces
  const wsAlpha = {
    workspaceId: 'ws-alpha',
    workspaceTitle: 'Alpha Workspace',
    workspaceIntent: 'Alpha Intent',
    iterations: [
      { id: 'alpha-it-1', number: 1, title: 'Alpha It 1', status: 'done' as const },
      { id: 'alpha-it-2', number: 2, title: 'Alpha It 2', status: 'review_ready' as const },
      { id: 'alpha-it-3', number: 3, title: 'Alpha It 3', status: 'planned' as const },
    ],
    worktrees: {
      'alpha-wt-1': {
        id: 'alpha-wt-1',
        repoName: 'repo-alpha',
        branchName: 'branch-alpha-1',
        title: 'Alpha WT 1',
        isCurrent: true,
        dirtyFilesCount: 2,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
      'alpha-wt-2': {
        id: 'alpha-wt-2',
        repoName: 'repo-alpha',
        branchName: 'branch-alpha-2',
        title: 'Alpha WT 2',
        isCurrent: false,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
    gateStatus: { overallStatus: 'pass' as const, durationMs: 250, summaryText: 'Alpha tests passing' },
  };

  const wsBeta = {
    workspaceId: 'ws-beta',
    workspaceTitle: 'Beta Workspace',
    workspaceIntent: 'Beta Intent',
    iterations: [
      { id: 'beta-it-1', number: 1, title: 'Beta It 1', status: 'agent_running' as const },
      { id: 'beta-it-2', number: 2, title: 'Beta It 2', status: 'planned' as const },
    ],
    worktrees: {
      'beta-wt-1': {
        id: 'beta-wt-1',
        repoName: 'repo-beta',
        branchName: 'branch-beta-1',
        title: 'Beta WT 1',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: true,
        isProtected: false,
      },
    },
    gateStatus: { overallStatus: 'fail' as const, durationMs: 800, summaryText: 'Beta tests failed' },
  };

  const wsGamma = {
    workspaceId: 'ws-gamma',
    workspaceTitle: 'Gamma Workspace',
    workspaceIntent: 'Gamma Intent',
    iterations: [
      { id: 'gamma-it-1', number: 1, title: 'Gamma It 1', status: 'planned' as const },
    ],
    worktrees: {
      'gamma-wt-1': {
        id: 'gamma-wt-1',
        repoName: 'repo-gamma',
        branchName: 'branch-gamma-1',
        title: 'Gamma WT 1',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
    // No gateStatus passed -> should reset to idle!
  };

  // Perform 100 rapid alternating transitions: Alpha -> Beta -> Gamma -> Alpha ...
  const workspaces = [wsAlpha, wsBeta, wsGamma];
  for (let cycle = 0; cycle < 100; cycle++) {
    const targetWs = workspaces[cycle % workspaces.length];
    cockpitStore.setWorkspaceData(targetWs);

    const state = cockpitStore.getState();
    assert.equal(state.workspaceId, targetWs.workspaceId, `Cycle ${cycle}: workspaceId mismatch`);
    assert.equal(state.workspaceTitle, targetWs.workspaceTitle);

    // Active iteration MUST belong to current workspace's iteration list
    assert.ok(
      targetWs.iterations.some((it) => it.id === state.activeIterationId),
      `Cycle ${cycle}: activeIterationId "${state.activeIterationId}" does not belong to ${targetWs.workspaceId}`
    );

    // Active worktree MUST belong to current workspace's worktrees
    assert.ok(
      state.activeWorktreeId && targetWs.worktrees[state.activeWorktreeId],
      `Cycle ${cycle}: activeWorktreeId "${state.activeWorktreeId}" does not belong to ${targetWs.workspaceId}`
    );

    // Verify gateStatus isolation
    if (targetWs.workspaceId === 'ws-alpha') {
      assert.equal(state.gateStatus.overallStatus, 'pass');
      assert.equal(state.activeIterationId, 'alpha-it-2'); // review_ready
    } else if (targetWs.workspaceId === 'ws-beta') {
      assert.equal(state.gateStatus.overallStatus, 'fail');
      assert.equal(state.activeIterationId, 'beta-it-1'); // agent_running
    } else if (targetWs.workspaceId === 'ws-gamma') {
      // Must NOT leak Alpha's pass or Beta's fail!
      assert.equal(state.gateStatus.overallStatus, 'idle');
      assert.equal(state.activeIterationId, 'gamma-it-1');
    }
  }
});

test('SUITE 3.2: Selection survival during same-workspace updates and fallback on deletion', () => {
  cockpitStore.reset();

  const ws = {
    workspaceId: 'ws-dynamic',
    workspaceTitle: 'Dynamic Workspace',
    workspaceIntent: 'Testing dynamic changes',
    iterations: [
      { id: 'it-1', number: 1, title: 'Step 1', status: 'done' as const },
      { id: 'it-2', number: 2, title: 'Step 2', status: 'review_ready' as const },
      { id: 'it-3', number: 3, title: 'Step 3', status: 'planned' as const },
    ],
    worktrees: {
      'wt-1': {
        id: 'wt-1',
        repoName: 'repo',
        branchName: 'b1',
        title: 'WT 1',
        isCurrent: true,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
      'wt-2': {
        id: 'wt-2',
        repoName: 'repo',
        branchName: 'b2',
        title: 'WT 2',
        isCurrent: false,
        dirtyFilesCount: 0,
        unpushedCommitsCount: 0,
        isPinned: false,
        isProtected: false,
      },
    },
  };

  // 1. Ingest workspace
  cockpitStore.setWorkspaceData(ws);
  // User selects Step 3 and WT 2
  cockpitStore.selectIteration('it-3');
  cockpitStore.selectWorktree('wt-2');
  assert.equal(cockpitStore.getState().activeIterationId, 'it-3');
  assert.equal(cockpitStore.getState().activeWorktreeId, 'wt-2');

  // 2. Poll update same workspace with same items -> selection MUST be preserved
  cockpitStore.setWorkspaceData({
    ...ws,
    iterations: [
      { id: 'it-1', number: 1, title: 'Step 1', status: 'done' as const },
      { id: 'it-2', number: 2, title: 'Step 2', status: 'done' as const },
      { id: 'it-3', number: 3, title: 'Step 3', status: 'agent_running' as const },
    ],
  });
  assert.equal(cockpitStore.getState().activeIterationId, 'it-3');
  assert.equal(cockpitStore.getState().activeWorktreeId, 'wt-2');

  // 3. Poll update where previously selected 'it-3' and 'wt-2' were deleted!
  cockpitStore.setWorkspaceData({
    ...ws,
    iterations: [
      { id: 'it-1', number: 1, title: 'Step 1', status: 'done' as const },
      { id: 'it-new', number: 2, title: 'Step New', status: 'review_ready' as const },
    ],
    worktrees: {
      'wt-1': ws.worktrees['wt-1'],
    },
  });

  // Stale 'it-3' is gone -> must gracefully fall back to active 'it-new'
  assert.equal(cockpitStore.getState().activeIterationId, 'it-new');
  // Stale 'wt-2' is gone -> must gracefully fall back to 'wt-1'
  assert.equal(cockpitStore.getState().activeWorktreeId, 'wt-1');
});

// ============================================================================
// SUITE 4: TELEMETRY GATE & VERIFICATION REPORT MATRIX
// ============================================================================
test('SUITE 4.1: Verification gate status edge cases and report statuses', () => {
  const feature = {
    branchName: 'feat-gate-matrix',
    description: 'Gate Matrix Verification',
    repos: ['/repos/app'],
    isolatedRepos: {},
  } as unknown as Feature;

  // Case 1: pass_dirty report
  const reportPassDirty: WorkspaceVerificationReport = {
    overallStatus: 'pass_dirty',
    canProgress: true,
    durationMs: 310,
    repos: [{ repoName: 'app', status: 'pass', command: 'npm test', exitCode: 0 }],
  };
  const resPassDirty = upcastWorkspaceToCockpit(feature, null, undefined, null, reportPassDirty);
  assert.equal(resPassDirty.gateStatus.overallStatus, 'pass');
  assert.equal(resPassDirty.gateStatus.durationMs, 310);

  // Case 2: timeout report
  const reportTimeout: WorkspaceVerificationReport = {
    overallStatus: 'timeout',
    canProgress: false,
    durationMs: 30000,
    repos: [{ repoName: 'app', status: 'timeout', command: 'npm test', exitCode: -1 }],
  };
  const resTimeout = upcastWorkspaceToCockpit(feature, null, undefined, null, reportTimeout);
  assert.equal(resTimeout.gateStatus.overallStatus, 'fail');
  assert.equal(resTimeout.gateStatus.durationMs, 30000);

  // Case 3: running / in_progress report status -> maps to idle
  const reportRunning = {
    overallStatus: 'running' as any,
    canProgress: false,
    repos: [],
  };
  const resRunning = upcastWorkspaceToCockpit(feature, null, undefined, null, reportRunning);
  assert.equal(resRunning.gateStatus.overallStatus, 'idle');

  // Case 4: null and undefined verification report
  const resNull = upcastWorkspaceToCockpit(feature, null, undefined, null, null);
  assert.equal(resNull.gateStatus.overallStatus, 'idle');
  assert.equal(resNull.gateStatus.summaryText, 'No verification gate run yet');

  const resUndefined = upcastWorkspaceToCockpit(feature, null, undefined, null, undefined);
  assert.equal(resUndefined.gateStatus.overallStatus, 'idle');
});

// ============================================================================
// SUITE 5: EVENT LISTENER INTEGRITY & REACT SYNC DISPATCH
// ============================================================================
test('SUITE 5.1: CockpitStore listener subscriptions and rapid notifications', () => {
  cockpitStore.reset();
  let callCount1 = 0;
  let callCount2 = 0;

  const unsub1 = cockpitStore.subscribe(() => {
    callCount1++;
  });
  const unsub2 = cockpitStore.subscribe(() => {
    callCount2++;
  });

  cockpitStore.setActiveStage('plan');
  cockpitStore.toggleDiffMode();
  cockpitStore.toggleZenMode();
  cockpitStore.setGateStatus({ overallStatus: 'pass', durationMs: 100 });

  assert.equal(callCount1, 4);
  assert.equal(callCount2, 4);

  // Unsubscribe listener 1
  unsub1();
  cockpitStore.reset();

  assert.equal(callCount1, 4, 'Unsubscribed listener must not receive further events');
  assert.equal(callCount2, 5, 'Remaining listener must continue to receive events');

  unsub2();
  cockpitStore.toggleZenMode();
  assert.equal(callCount2, 5);
});
