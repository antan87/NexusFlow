/**
 * @module core/lifecycle
 * Active lifecycle state machine and multi-branch fleet radar for ContextSpace.
 *
 * Manages discrete development milestones/steps, dependency gating,
 * non-destructive origin branch fleet tracking, and test gate transitions.
 */

import { execa } from 'execa';
import type {
  BranchFleetMember,
  LifecycleStep,
  LifecycleStepStatus,
  WorkspaceLifecycle,
  WorkspaceState,
} from '../types.js';
import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { resolveFeatureRepoPath } from '../utils/feature.js';
import { getRepoBranch, getAheadBehind } from '../utils/multi-git.js';
import { loadWorkspaceState, saveWorkspaceState } from './workspace-state.js';
import { verifyWorkspace } from './verify.js';

/**
 * Non-destructively inspects local and remote tracking branches for repositories in the workspace.
 */
export async function getBranchFleet(workspacePath: string): Promise<BranchFleetMember[]> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) return [];

  const resolvedPaths = feature.repos.map((r) => resolveFeatureRepoPath(feature, workspacePath, r));
  const repoInfos = await resolveRepoInfos(resolvedPaths);
  const fleet: BranchFleetMember[] = [];

  for (const repo of repoInfos) {
    const currentBranch = await getRepoBranch(repo.path);
    const aheadBehind = await getAheadBehind(repo.path, currentBranch ?? repo.defaultBranch);

    let currentSha = 'unknown';
    let currentMessage = '';
    let currentAuthor = '';
    let currentDate = '';

    try {
      const { stdout } = await execa(
        'git',
        ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%cr'],
        { cwd: repo.path },
      );
      const [sha, msg, author, date] = stdout.trim().split('\x1f');
      currentSha = sha ?? 'unknown';
      currentMessage = msg ?? '';
      currentAuthor = author ?? '';
      currentDate = date ?? '';
    } catch {
      // Ignore
    }

    // 1. Add current active branch
    fleet.push({
      branch: currentBranch ?? 'detached',
      repoName: repo.name,
      isCurrent: true,
      headSha: currentSha,
      ahead: aheadBehind.ahead ?? 0,
      behind: aheadBehind.behind ?? 0,
      lastCommitMessage: currentMessage,
      lastCommitAuthor: currentAuthor,
      lastCommitDate: currentDate,
      remoteTracked: aheadBehind.ahead !== null,
    });

    // 2. Inspect origin remote tracking branches (non-destructive)
    try {
      const { stdout: refOut } = await execa(
        'git',
        [
          'for-each-ref',
          '--sort=-committerdate',
          '--count=6',
          '--format=%(refname:short)\x1f%(objectname:short)\x1f%(subject)\x1f%(authorname)\x1f%(authordate:relative)\x1f%(symref)',
          'refs/remotes/origin/',
        ],
        { cwd: repo.path },
      );

      const lines = refOut.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const [refShort, sha, subject, author, relDate, symref] = line.split('\x1f');
        if (!refShort) continue;
        const branchName = refShort.replace(/^origin\//, '');
        if (symref || refShort === 'origin' || refShort === 'origin/HEAD' || branchName === 'HEAD' || branchName === currentBranch) continue;

        fleet.push({
          branch: refShort,
          repoName: repo.name,
          isCurrent: false,
          headSha: sha,
          ahead: 0,
          behind: 0,
          lastCommitMessage: subject,
          lastCommitAuthor: author,
          lastCommitDate: relDate,
          remoteTracked: true,
        });
      }
    } catch {
      // Ignore remote queries if remote not reachable
    }
  }

  return fleet;
}

/**
 * Creates a default structured lifecycle if none exists for the workspace.
 */
export function createDefaultSteps(
  flowType: 'quick' | 'feature' | 'epic',
  featureId: string,
  branchName: string,
): LifecycleStep[] {
  if (flowType === 'quick') {
    return [
      {
        id: 'reproduce_and_fix',
        title: 'Reproduce Regression & Apply Fix',
        description: 'Targeted single-file edit or fix with reproduction test case.',
        branch: branchName,
        owner: 'Developer',
        status: 'in_progress',
      },
      {
        id: 'verify_and_ship',
        title: 'Mechanical Verification Gate & Ship',
        description: 'Execute automated tests, anchor commit SHA proof, and publish PR.',
        branch: branchName,
        owner: 'Developer',
        status: 'pending',
        dependsOn: ['reproduce_and_fix'],
      },
    ];
  }

  if (flowType === 'epic') {
    return [
      {
        id: 'epic_slice_1',
        title: 'Foundation & Core Schema',
        description: 'Data models, domain types, and foundational migration contracts.',
        branch: 'feat/schema',
        owner: 'Backend Team',
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
      {
        id: 'epic_slice_2',
        title: 'API & Business Logic Implementation',
        description: 'Service endpoints, business logic, and test coverage.',
        branch: branchName,
        owner: 'AI Assistant',
        status: 'in_progress',
        dependsOn: ['epic_slice_1'],
      },
      {
        id: 'epic_slice_3',
        title: 'UI Components & Frontend Integration',
        description: 'Client-side interface, forms, and interaction polish.',
        branch: 'feat/ui',
        owner: 'Frontend Team',
        status: 'pending',
        dependsOn: ['epic_slice_2'],
      },
      {
        id: 'epic_slice_4',
        title: 'Cross-Repo Integration & E2E Gate',
        description: 'End-to-end integration tests, mechanical verification, and milestone signoff.',
        branch: branchName,
        owner: 'Team Lead',
        status: 'blocked',
        dependsOn: ['epic_slice_2', 'epic_slice_3'],
      },
    ];
  }

  // Standard Feature flow
  return [
    {
      id: 'step_discovery',
      title: 'Explore Architecture & Design Test Skeleton',
      description: 'Survey relevant modules, inspect interfaces, and create verification skeleton.',
      branch: branchName,
      owner: 'Developer',
      status: 'completed',
      completedAt: new Date().toISOString(),
    },
    {
      id: 'step_implementation',
      title: 'Core Implementation',
      description: 'Implement feature changes across affected workspace repositories.',
      branch: branchName,
      owner: 'Developer',
      status: 'in_progress',
      dependsOn: ['step_discovery'],
    },
    {
      id: 'step_verification',
      title: 'Mechanical Verification Gate',
      description: 'Run automated test suites and anchor clean commit SHA proof in state.',
      branch: branchName,
      owner: 'Developer',
      status: 'pending',
      dependsOn: ['step_implementation'],
    },
    {
      id: 'step_ship',
      title: 'Review, Create PR & Clean Workspace',
      description: 'Surface compare links, create GitHub pull request, and conclude workspace loop.',
      branch: branchName,
      owner: 'Developer',
      status: 'pending',
      dependsOn: ['step_verification'],
    },
  ];
}

/**
 * Loads or initializes the active lifecycle for a workspace.
 */
export async function loadWorkspaceLifecycle(workspacePath: string): Promise<WorkspaceLifecycle> {
  const state = await loadWorkspaceState(workspacePath);
  const feature = await loadFeatureConfig(workspacePath);

  if (state.lifecycle) {
    // Refresh branch fleet asynchronously
    try {
      state.lifecycle.fleet = await getBranchFleet(workspacePath);
    } catch {
      // Best-effort
    }
    return state.lifecycle;
  }

  // Determine flow type
  let flowType: 'quick' | 'feature' | 'epic' = 'feature';
  if (feature?.branchName.startsWith('fix/') || feature?.branchName.startsWith('quick/')) {
    flowType = 'quick';
  } else if (
    (feature?.repos.length ?? 0) > 2 ||
    feature?.branchName.startsWith('epic/') ||
    feature?.branchName.startsWith('flow/')
  ) {
    flowType = 'epic';
  }

  const steps = createDefaultSteps(
    flowType,
    feature?.id ?? 'workspace',
    feature?.branchName ?? 'main',
  );

  let fleet: BranchFleetMember[] = [];
  try {
    fleet = await getBranchFleet(workspacePath);
  } catch {
    // Best-effort
  }

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: feature?.id ?? 'workspace',
    flowType,
    currentStepId: steps.find((s) => s.status === 'in_progress')?.id,
    steps,
    fleet,
    updatedAt: new Date().toISOString(),
  };

  state.lifecycle = lifecycle;
  await saveWorkspaceState(state);
  return lifecycle;
}

/**
 * Advances or transitions a step in the workspace lifecycle.
 */
export async function advanceLifecycleStep(
  workspacePath: string,
  stepId: string,
  action: 'start' | 'verify' | 'complete',
): Promise<WorkspaceLifecycle> {
  const lifecycle = await loadWorkspaceLifecycle(workspacePath);
  const stepIndex = lifecycle.steps.findIndex((s) => s.id === stepId);

  if (stepIndex < 0) {
    throw new Error(`Step "${stepId}" not found in workspace lifecycle.`);
  }

  const step = lifecycle.steps[stepIndex]!;

  if (action === 'start') {
    step.status = 'in_progress';
    lifecycle.currentStepId = step.id;
  } else if (action === 'verify') {
    const report = await verifyWorkspace(workspacePath);
    step.lastVerificationStatus = report.overallStatus;
    step.lastVerificationSha = report.repos[0]?.headSha;
    if (report.overallStatus === 'pass' || report.overallStatus === 'pass_dirty') {
      step.status = 'verified';
    }
  } else if (action === 'complete') {
    step.status = 'completed';
    step.completedAt = new Date().toISOString();

    // Check if downstream dependent steps are now unblocked
    const completedIds = new Set(
      lifecycle.steps.filter((s) => s.status === 'completed').map((s) => s.id),
    );

    for (const nextStep of lifecycle.steps) {
      if (nextStep.status === 'blocked' && nextStep.dependsOn) {
        const allSatisfied = nextStep.dependsOn.every((dep) => completedIds.has(dep));
        if (allSatisfied) {
          nextStep.status = 'pending';
        }
      }
    }

    // Set next pending step to in_progress
    const nextPending = lifecycle.steps.find((s) => s.status === 'pending');
    if (nextPending) {
      nextPending.status = 'in_progress';
      lifecycle.currentStepId = nextPending.id;
    }
  }

  lifecycle.updatedAt = new Date().toISOString();
  const state = await loadWorkspaceState(workspacePath);
  state.lifecycle = lifecycle;
  await saveWorkspaceState(state);

  return lifecycle;
}
