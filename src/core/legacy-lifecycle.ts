import type { LifecycleStep, WorkspaceLifecycle } from '../types.js';

/**
 * Historical templates, retained only to identify untouched plans from older releases.
 */
export function legacyDefaultSteps(
  flowType: 'quick' | 'feature' | 'epic',
  featureId: string,
  branchName?: string,
): LifecycleStep[] {
  if (flowType === 'quick') {
    return [
      {
        id: 'reproduce_and_fix',
        title: 'Scope & Implement Focused Change',
        description: 'Confirm the expected behavior or baseline, then make a focused change.',
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
        title: 'Define Outcomes & Constraints',
        description: 'Agree the intended outcome, scope, constraints, and acceptance criteria.',
        branch: branchName,
        owner: 'Developer',
        status: 'in_progress',
      },
      {
        id: 'epic_slice_2',
        title: 'Deliver First Increment',
        description: 'Implement and test the first independently reviewable deliverable.',
        branch: branchName,
        owner: 'Developer',
        status: 'pending',
        dependsOn: ['epic_slice_1'],
      },
      {
        id: 'epic_slice_3',
        title: 'Deliver Follow-up Increments',
        description: 'Add milestones for the remaining deliverables and their dependencies.',
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

/** Only retire an exact, unused template. Edited plans and any recorded progress survive. */
export function isUnusedLegacyPlan(lifecycle: WorkspaceLifecycle): boolean {
  if (lifecycle.revision || !lifecycle.steps.length) return false;
  const expected = legacyDefaultSteps(lifecycle.flowType, lifecycle.workspaceId, lifecycle.steps[0]?.branch);
  if (lifecycle.currentStepId !== expected.find((step) => step.status === 'in_progress')?.id) return false;
  return lifecycle.steps.length === expected.length && lifecycle.steps.every((step, index) => {
    const original = expected[index]!;
    return Object.keys(step).every((key) => key in original)
      && Object.entries(original).every(([key, value]) => JSON.stringify(step[key as keyof LifecycleStep]) === JSON.stringify(value));
  });
}
