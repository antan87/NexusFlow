/**
 * Centralized Cockpit State Store using React 19 useSyncExternalStore.
 * Coordinates active workspace, worktree, progressive development iterations,
 * diff review mode, and distraction-free Zen mode.
 * File: gui/src/features/cockpit/cockpitStore.ts
 */
import { useSyncExternalStore } from 'react';
import type { Feature, WorkspaceLifecycle, WorkspaceStatus, WorkspaceVerificationReport } from '../../types.js';
import type { WorktreeDescriptor } from '../worktrees/types.js';
import { normalizeWorktreeGroups, formatBranchTitle } from '../worktrees/normalizeWorktrees.js';

export type CockpitStage = 'diff' | 'plan' | 'knowledge' | 'overview';
export type DiffViewMode = 'side-by-side' | 'unified';
export type IterationStatus = 'review_ready' | 'agent_running' | 'done' | 'planned';

export interface DevelopmentIteration {
  id: string;
  number: number;
  title: string;
  goal?: string;
  status: IterationStatus;
  worktreeId?: string;
  branchName?: string;
  changesCount?: number;
}

export interface VerificationGateTelemetry {
  overallStatus: 'pass' | 'fail' | 'running' | 'idle';
  durationMs?: number;
  verifiedAt?: string;
  summaryText?: string;
}

export interface CockpitState {
  workspaceId: string | null;
  workspaceTitle: string;
  workspaceIntent: string;
  activeIterationId: string | null;
  activeWorktreeId: string | null;
  activeStage: CockpitStage;
  diffViewMode: DiffViewMode;
  isZenMode: boolean;
  gateStatus: VerificationGateTelemetry;
  iterations: DevelopmentIteration[];
  worktrees: Record<string, WorktreeDescriptor>;
}

const DEFAULT_COCKPIT_STATE: CockpitState = {
  workspaceId: null,
  workspaceTitle: '',
  workspaceIntent: '',
  activeIterationId: null,
  activeWorktreeId: null,
  activeStage: 'diff',
  diffViewMode: 'side-by-side',
  isZenMode: false,
  gateStatus: { overallStatus: 'idle', summaryText: 'No verification gate run yet' },
  iterations: [],
  worktrees: {},
};

let currentState: CockpitState = { ...DEFAULT_COCKPIT_STATE };
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

export const cockpitStore = {
  getState: () => currentState,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  setWorkspaceData: (data: {
    workspaceId: string;
    workspaceTitle: string;
    workspaceIntent: string;
    iterations: DevelopmentIteration[];
    worktrees: Record<string, WorktreeDescriptor>;
    activeIterationId?: string | null;
    activeWorktreeId?: string | null;
    gateStatus?: VerificationGateTelemetry;
  }) => {
    const isNewWorkspace = currentState.workspaceId !== data.workspaceId;

    // Resolve workspace-scoped active iteration
    let activeIterationId: string | null;
    if (isNewWorkspace) {
      if (data.activeIterationId && data.iterations.some((it) => it.id === data.activeIterationId)) {
        activeIterationId = data.activeIterationId;
      } else {
        const activeIter = data.iterations.find((it) => it.status === 'agent_running' || it.status === 'review_ready') || data.iterations[0];
        activeIterationId = activeIter?.id || null;
      }
    } else {
      if (data.activeIterationId && data.iterations.some((it) => it.id === data.activeIterationId)) {
        activeIterationId = data.activeIterationId;
      } else if (currentState.activeIterationId && data.iterations.some((it) => it.id === currentState.activeIterationId)) {
        activeIterationId = currentState.activeIterationId;
      } else {
        const activeIter = data.iterations.find((it) => it.status === 'agent_running' || it.status === 'review_ready') || data.iterations[0];
        activeIterationId = activeIter?.id || null;
      }
    }

    // Resolve workspace-scoped active worktree
    let activeWorktreeId: string | null;
    if (isNewWorkspace) {
      if (data.activeWorktreeId && data.worktrees[data.activeWorktreeId]) {
        activeWorktreeId = data.activeWorktreeId;
      } else {
        activeWorktreeId = Object.keys(data.worktrees)[0] || null;
      }
    } else {
      if (data.activeWorktreeId && data.worktrees[data.activeWorktreeId]) {
        activeWorktreeId = data.activeWorktreeId;
      } else if (currentState.activeWorktreeId && data.worktrees[currentState.activeWorktreeId]) {
        activeWorktreeId = currentState.activeWorktreeId;
      } else {
        activeWorktreeId = Object.keys(data.worktrees)[0] || null;
      }
    }

    currentState = {
      ...currentState,
      workspaceId: data.workspaceId,
      workspaceTitle: data.workspaceTitle,
      workspaceIntent: data.workspaceIntent,
      iterations: data.iterations,
      worktrees: data.worktrees,
      activeIterationId,
      activeWorktreeId,
      gateStatus: data.gateStatus || (isNewWorkspace ? { overallStatus: 'idle', summaryText: 'No verification gate run yet' } : currentState.gateStatus),
    };
    notify();
  },

  selectIteration: (iterationId: string) => {
    const iter = currentState.iterations.find((it) => it.id === iterationId);
    const associatedWtId = iter?.worktreeId || currentState.activeWorktreeId;

    currentState = {
      ...currentState,
      activeIterationId: iterationId,
      activeWorktreeId: associatedWtId,
    };
    notify();
  },

  selectWorktree: (worktreeId: string) => {
    const matchingIter = currentState.iterations.find((it) => it.worktreeId === worktreeId);

    currentState = {
      ...currentState,
      activeWorktreeId: worktreeId,
      activeIterationId: matchingIter ? matchingIter.id : currentState.activeIterationId,
    };
    notify();
  },

  setActiveStage: (stage: CockpitStage) => {
    currentState = { ...currentState, activeStage: stage };
    notify();
  },

  toggleDiffMode: () => {
    currentState = {
      ...currentState,
      diffViewMode: currentState.diffViewMode === 'side-by-side' ? 'unified' : 'side-by-side',
    };
    notify();
  },

  setDiffMode: (mode: DiffViewMode) => {
    currentState = { ...currentState, diffViewMode: mode };
    notify();
  },

  toggleZenMode: () => {
    currentState = {
      ...currentState,
      isZenMode: !currentState.isZenMode,
    };
    notify();
  },

  setZenMode: (isZen: boolean) => {
    currentState = {
      ...currentState,
      isZenMode: isZen,
    };
    notify();
  },

  setGateStatus: (gateStatus: VerificationGateTelemetry) => {
    currentState = { ...currentState, gateStatus };
    notify();
  },

  reset: () => {
    currentState = { ...DEFAULT_COCKPIT_STATE };
    notify();
  },
};

export function useCockpitStore(): CockpitState & typeof cockpitStore {
  const state = useSyncExternalStore(
    cockpitStore.subscribe,
    cockpitStore.getState,
    () => DEFAULT_COCKPIT_STATE
  );

  return {
    ...state,
    ...cockpitStore,
  };
}

/**
 * Backward-Compatible Upcaster for Features & Lifecycles
 */
export function upcastWorkspaceToCockpit(
  feature: Feature,
  lifecycle: WorkspaceLifecycle | null,
  status?: WorkspaceStatus,
  planContent?: string | null,
  verificationReport?: WorkspaceVerificationReport | null
): {
  workspaceTitle: string;
  workspaceIntent: string;
  worktrees: Record<string, WorktreeDescriptor>;
  iterations: DevelopmentIteration[];
  gateStatus: VerificationGateTelemetry;
} {
  const workspaceTitle = feature.description && feature.description.length > 3 && feature.description.length < 50
    ? feature.description
    : formatBranchTitle(feature.branchName);
  const workspaceIntent = feature.description || 'Workspace Process and Code Review Cockpit';

  // Normalize worktree groups from feature
  const groups = normalizeWorktreeGroups(feature, status);
  const worktrees: Record<string, WorktreeDescriptor> = {};
  for (const group of groups) {
    for (const wt of group.worktrees) {
      worktrees[wt.id] = wt;
    }
  }

  // Derive iterations dynamically
  let iterations: DevelopmentIteration[] = [];
  const defaultWtId = Object.keys(worktrees)[0] || `wt-${feature.branchName}`;

  // 1. Primary: map real lifecycle.steps if present
  if (lifecycle?.steps && lifecycle.steps.length > 0) {
    iterations = lifecycle.steps.map((step, idx) => {
      let iterStatus: IterationStatus = 'planned';
      if (step.status === 'completed' || step.status === 'verified') {
        iterStatus = 'done';
      } else if (step.status === 'in_progress') {
        iterStatus = (status?.changedFiles ?? 0) > 0 ? 'review_ready' : 'agent_running';
      }

      const matchingWt = Object.values(worktrees).find((wt) => step.branch && wt.branchName === step.branch);
      const stepRawTitle = step.title || `Iteration ${idx + 1}`;
      const title = stepRawTitle.toLowerCase().startsWith('iteration') || stepRawTitle.toLowerCase().startsWith('milestone')
        ? stepRawTitle
        : `Iteration ${idx + 1}: ${stepRawTitle}`;

      return {
        id: `iter-${step.id || idx + 1}`,
        number: idx + 1,
        title,
        goal: step.description,
        status: iterStatus,
        worktreeId: matchingWt?.id || defaultWtId,
        branchName: step.branch || feature.branchName,
        changesCount: step.status === 'in_progress' ? (status?.changedFiles ?? 0) : 0,
      };
    });
  }

  // 2. Secondary: parse markdown milestones from planContent if no lifecycle steps
  if (iterations.length === 0 && planContent && planContent.trim().length > 0) {
    const parsedMilestones: DevelopmentIteration[] = [];
    const lineRegex = /(?:^|\n)\s*(?:-|\*|\d+\.|#{2,4})\s+(?:\[([ xX])\]\s+)?(?:\*\*(?:Milestone\s*\d+:?\s*)?([^*]+)\*\*|(?:Milestone\s*(\d+):?\s*)([^\n\r]+))(?:\s*[-—–:]\s*([^\n\r]+))?/g;
    let match: RegExpExecArray | null;
    let counter = 1;
    while ((match = lineRegex.exec(planContent)) !== null) {
      const isChecked = Boolean(match[1] && match[1].toLowerCase() === 'x');
      const rawTitle = (match[2] || match[4] || '').trim();
      const lower = rawTitle.toLowerCase();
      if (!rawTitle || lower === 'acceptance criteria' || lower === 'verification' || lower === 'verification method') {
        continue;
      }
      const goal = match[5]?.trim();
      const isDone = isChecked || /\b(done|completed|verified|merged)\b/i.test(goal || '');
      let iterStatus: IterationStatus = isDone ? 'done' : 'planned';
      if (!isDone && parsedMilestones.filter((p) => p.status !== 'done').length === 0) {
        iterStatus = (status?.changedFiles ?? 0) > 0
          ? 'review_ready'
          : (status?.activeAssistants && status.activeAssistants.length > 0 ? 'agent_running' : 'planned');
      }

      const num = counter++;
      const title = rawTitle.toLowerCase().startsWith('iteration') || rawTitle.toLowerCase().startsWith('milestone')
        ? rawTitle
        : `Iteration ${num}: ${rawTitle}`;

      parsedMilestones.push({
        id: `iter-plan-${num}`,
        number: num,
        title,
        goal,
        status: iterStatus,
        worktreeId: defaultWtId,
        branchName: feature.branchName,
        changesCount: iterStatus === 'review_ready' ? (status?.changedFiles ?? 0) : 0,
      });
    }

    if (parsedMilestones.length > 0) {
      iterations = parsedMilestones;
    }
  }

  // 3. Clean Fallback: When workspace has no plan or lifecycle steps yet, derive a clean initial step from feature
  if (iterations.length === 0) {
    const initialTitle = feature.description && feature.description.length > 3 && feature.description.length < 50
      ? feature.description
      : formatBranchTitle(feature.branchName);
    iterations = [
      {
        id: `iter-${feature.branchName}-init`,
        number: 1,
        title: initialTitle,
        goal: feature.description || `Deliver changes for ${feature.branchName}`,
        status: (status?.changedFiles ?? 0) > 0
          ? 'review_ready'
          : (status?.activeAssistants && status.activeAssistants.length > 0)
            ? 'agent_running'
            : 'planned',
        worktreeId: defaultWtId,
        branchName: feature.branchName,
        changesCount: status?.changedFiles ?? 0,
      },
    ];
  }

  // Compute Gate Status
  let gateStatus: VerificationGateTelemetry;
  if (verificationReport) {
    const reportStatus = verificationReport.overallStatus;
    const isPass = reportStatus === 'pass' || reportStatus === 'pass_dirty';
    const isFail = reportStatus === 'fail' || reportStatus === 'timeout';
    gateStatus = {
      overallStatus: isPass ? 'pass' : isFail ? 'fail' : 'idle',
      durationMs: verificationReport.durationMs,
      summaryText: `Verification: ${reportStatus.replace('_', ' ')} (${verificationReport.repos?.length ?? 0} repos)`,
    };
  } else {
    gateStatus = {
      overallStatus: 'idle',
      summaryText: 'No verification gate run yet',
    };
  }

  return {
    workspaceTitle,
    workspaceIntent,
    worktrees,
    iterations,
    gateStatus,
  };
}
