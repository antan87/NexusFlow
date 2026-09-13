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
  WorkspaceLifecycle,
} from '../types.js';
import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { resolveFeatureRepoPath } from '../utils/feature.js';
import { getRepoBranch, getAheadBehind } from '../utils/multi-git.js';
import { loadWorkspaceState, mutateWorkspaceState } from './workspace-state.js';
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
  branchName?: string,
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
        requiresVerification: true,
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
        branch: branchName,
        owner: 'Developer',
        status: 'in_progress',
      },
      {
        id: 'epic_slice_2',
        title: 'API & Business Logic Implementation',
        description: 'Service endpoints, business logic, and test coverage.',
        branch: branchName,
        owner: 'Developer',
        status: 'pending',
        dependsOn: ['epic_slice_1'],
      },
      {
        id: 'epic_slice_3',
        title: 'UI Components & Frontend Integration',
        description: 'Client-side interface, forms, and interaction polish.',
        branch: branchName,
        owner: 'Developer',
        status: 'pending',
        dependsOn: ['epic_slice_2'],
      },
      {
        id: 'epic_slice_4',
        requiresVerification: true,
        title: 'Cross-Repo Integration & E2E Gate',
        description: 'End-to-end integration tests, mechanical verification, and milestone signoff.',
        branch: branchName,
        owner: 'Developer',
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
      status: 'in_progress',
    },
    {
      id: 'step_implementation',
      title: 'Core Implementation',
      description: 'Implement feature changes across affected workspace repositories.',
      branch: branchName,
      owner: 'Developer',
      status: 'pending',
      dependsOn: ['step_discovery'],
    },
    {
      id: 'step_verification',
      requiresVerification: true,
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
  let flowType: 'quick' | 'feature' | 'epic' = feature?.flowType ?? 'feature';
  if (!feature?.flowType && (feature?.branchName.startsWith('fix/') || feature?.branchName.startsWith('quick/'))) {
    flowType = 'quick';
  } else if (!feature?.flowType && (
    (feature?.repos.length ?? 0) > 2 ||
    feature?.branchName.startsWith('epic/') ||
    feature?.branchName.startsWith('flow/')
  )) {
    flowType = 'epic';
  }

  let fleet: BranchFleetMember[] = [];
  try {
    fleet = await getBranchFleet(workspacePath);
  } catch {
    // Best-effort
  }

  const branches = [...new Set(fleet.filter((member) => member.isCurrent).map((member) => member.branch))];
  const branch = branches.length === 1 && branches[0] !== 'detached'
    ? branches[0]
    : !branches.length && feature?.mode !== 'in-place' && !feature?.repoBranches
      ? feature?.branchName
      : undefined;
  const steps = createDefaultSteps(flowType, feature?.id ?? 'workspace', branch);

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: feature?.id ?? 'workspace',
    flowType,
    currentStepId: steps.find((s) => s.status === 'in_progress')?.id,
    steps,
    fleet,
    updatedAt: new Date().toISOString(),
  };

  return mutateWorkspaceState(workspacePath, (current) => {
    // Another reader may have initialized or advanced it while fleet data loaded.
    current.lifecycle ??= lifecycle;
    return current.lifecycle;
  });
}

function dependenciesAreComplete(steps: LifecycleStep[], candidate: LifecycleStep): boolean {
  return (candidate.dependsOn ?? []).every((id) => steps.some((step) => step.id === id && step.status === 'completed'));
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

  const step = structuredClone(lifecycle.steps[stepIndex]!);
  const originalStep = JSON.stringify(step);

  if (!['start', 'verify', 'complete'].includes(action)) {
    throw new Error(`Unknown lifecycle action "${action}".`);
  }
  if (!dependenciesAreComplete(lifecycle.steps, step)) {
    throw new Error(`Complete dependencies before advancing step "${stepId}".`);
  }
  if (step.status === 'completed') {
    throw new Error(`Step "${stepId}" is already completed.`);
  }
  if (action !== 'start' && step.status !== 'in_progress' && step.status !== 'verified') {
    throw new Error(`Start step "${stepId}" before ${action}.`);
  }

  // Recognize gates in lifecycles saved before requiresVerification existed.
  const requiresVerification = step.requiresVerification || Boolean(step.verificationCommand) || Boolean(step.lastVerificationStatus) ||
    ['verify_and_ship', 'step_verification', 'epic_slice_4'].includes(step.id);
  let gateFailed = false;
  if (action === 'verify' || (action === 'complete' && requiresVerification)) {
    const report = await verifyWorkspace(workspacePath, { command: step.verificationCommand });
    step.lastVerificationStatus = report.overallStatus;
    step.lastVerificationSha = report.repos[0]?.headSha;
    gateFailed = !report.canProgress;
    step.status = gateFailed ? 'in_progress' : 'verified';
  }

  const updated = await mutateWorkspaceState(workspacePath, (state) => {
    const lifecycle = state.lifecycle;
    const currentStep = lifecycle?.steps.find((candidate) => candidate.id === stepId);
    if (!lifecycle || !currentStep || JSON.stringify(currentStep) !== originalStep) {
      throw new Error(`Step "${stepId}" changed during this operation. Reload the flow and retry.`);
    }
    if (!dependenciesAreComplete(lifecycle.steps, step)) {
      throw new Error(`Dependencies changed for step "${stepId}". Reload the flow and retry.`);
    }
    Object.assign(currentStep, step);
    if (action === 'start') {
      currentStep.status = 'in_progress';
      lifecycle.currentStepId = step.id;
    } else if (action === 'complete' && !gateFailed) {
      currentStep.status = 'completed';
      currentStep.completedAt = new Date().toISOString();
      for (const nextStep of lifecycle.steps) {
        if (nextStep.status === 'blocked' && dependenciesAreComplete(lifecycle.steps, nextStep)) {
          nextStep.status = 'pending';
        }
      }
      const active = lifecycle.steps.find((s) => s.status === 'in_progress' || s.status === 'verified');
      const next = active ?? lifecycle.steps.find((s) => s.status === 'pending' && dependenciesAreComplete(lifecycle.steps, s));
      if (next && !active) next.status = 'in_progress';
      lifecycle.currentStepId = next?.id;
    }

    lifecycle.updatedAt = new Date().toISOString();
    return lifecycle;
  });
  if (gateFailed && action === 'complete') {
    throw new Error(`Verification did not permit progress for step "${stepId}" (${step.lastVerificationStatus}).`);
  }

  return updated;
}
