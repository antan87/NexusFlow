/**
 * @module core/lifecycle
 * Active lifecycle state machine and multi-branch fleet radar for ContextSpace.
 *
 * Manages discrete development milestones/steps, dependency gating,
 * non-destructive origin branch fleet tracking, and test gate transitions.
 */

import { z } from 'zod';
import { loadWorkGuidance, lockWorkGuidance } from './work-guidance.js';
import { isUnusedLegacyPlan } from './legacy-lifecycle.js';
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
        ['log', '-1', '--format=%h%x1f%s%x1f%an%x1f%cI'],
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
          '--count=100',
          '--format=%(refname:short)\x1f%(objectname:short)\x1f%(subject)\x1f%(authorname)\x1f%(committerdate:iso-strict)\x1f%(symref)',
          'refs/remotes/origin/',
        ],
        { cwd: repo.path },
      );

      const lines = refOut.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        const [refShort, sha, subject, author, relDate, symref] = line.split('\x1f');
        if (!refShort) continue;
        const branchName = refShort.replace(/^origin\//, '');
        if (/^(?:renovate|dependabot)\//i.test(branchName)) continue;
        if (fleet.filter((member) => member.repoName === repo.name && !member.isCurrent).length >= 6) break;
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
 * Loads or initializes the active lifecycle for a workspace.
 */
export async function loadWorkspaceLifecycle(workspacePath: string): Promise<WorkspaceLifecycle> {
  const state = await loadWorkspaceState(workspacePath);
  const feature = await loadFeatureConfig(workspacePath);

  if (state.lifecycle) {
    if (isUnusedLegacyPlan(state.lifecycle)) {
      const release = await lockWorkGuidance(workspacePath);
      try {
        const guidance = await loadWorkGuidance(workspacePath);
        const referenced = Boolean(guidance.assignment.milestoneId || guidance.documents.some((doc) => doc.scope.milestoneId));
        state.lifecycle = await mutateWorkspaceState(workspacePath, (current) => {
          if (!referenced && current.lifecycle && isUnusedLegacyPlan(current.lifecycle)) {
            current.lifecycle.steps = [];
            current.lifecycle.currentStepId = undefined;
            current.lifecycle.revision = (current.lifecycle.revision ?? 0) + 1;
            current.lifecycle.updatedAt = new Date().toISOString();
          }
          return current.lifecycle!;
        });
      } finally { await release(); }
    }
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

  const lifecycle: WorkspaceLifecycle = {
    workspaceId: feature?.id ?? 'workspace',
    flowType,
    steps: [],
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

    lifecycle.revision = (lifecycle.revision ?? 0) + 1;
    lifecycle.updatedAt = new Date().toISOString();
    return lifecycle;
  });
  if (gateFailed && action === 'complete') {
    throw new Error(`Verification did not permit progress for step "${stepId}" (${step.lastVerificationStatus}).`);
  }

  return updated;
}

const planStepSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100),
  title: z.string().trim().min(1).max(200), description: z.string().max(4000).optional(),
  owner: z.string().max(200).optional(), branch: z.string().max(200).optional(),
  repo: z.string().max(200).optional(), workItem: z.string().max(2000).optional(),
  unblockCondition: z.string().max(2000).optional(),
  dependsOn: z.array(z.string()).max(100).optional(),
  requiresVerification: z.boolean().optional(), verificationCommand: z.string().max(2000).optional(),
});
export const lifecyclePlanSchema = z.object({ revision: z.number().int().nonnegative(), steps: z.array(planStepSchema).max(100) });

/** Update definitions while retaining the authoritative milestone progress and proofs. */
export async function updateLifecyclePlan(workspacePath: string, input: unknown): Promise<WorkspaceLifecycle> {
  const update = lifecyclePlanSchema.parse(input);
  await loadWorkspaceLifecycle(workspacePath);
  const release = await lockWorkGuidance(workspacePath);
  try {
    const guidance = await loadWorkGuidance(workspacePath);
    return await mutateWorkspaceState(workspacePath, (state) => {
      const lifecycle = state.lifecycle!;
      if ((lifecycle.revision ?? 0) !== update.revision) throw new Error('The plan changed in another session. Reload before saving.');
      const definitions = update.steps.map((definition) => ({
        ...lifecycle.steps.find((step) => step.id === definition.id), ...definition,
        ...(definition.verificationCommand === '' ? { verificationCommand: undefined } : {}),
      }));
      const byId = new Map(definitions.map((step) => [step.id, step]));
      if (byId.size !== definitions.length) throw new Error('Milestone IDs must be unique.');
      const removed = new Set(lifecycle.steps.filter((step) => !byId.has(step.id)).map((step) => step.id));
      if ((guidance.assignment.milestoneId && removed.has(guidance.assignment.milestoneId)) ||
        guidance.documents.some((doc) => doc.scope.milestoneId && removed.has(doc.scope.milestoneId))) {
        throw new Error('Move the assignment and document scopes to the workspace or another milestone before removing their milestone.');
      }
      // Validate the merged definitions: omitted optional fields retain their saved values.
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const visit = (id: string) => {
        if (visiting.has(id)) throw new Error('Milestone dependencies contain a cycle.');
        if (visited.has(id)) return;
        const step = byId.get(id);
        if (!step) throw new Error(`Dependency "${id}" does not name a milestone.`);
        visiting.add(id);
        for (const dependency of step.dependsOn ?? []) visit(dependency);
        visiting.delete(id); visited.add(id);
      };
      for (const step of definitions) visit(step.id);
      lifecycle.steps = definitions.map((definition) => {
        const existing = lifecycle.steps.find((step) => step.id === definition.id);
        if (!existing) return { ...definition, status: 'pending' as const };
        const gateChanged = Boolean(existing.requiresVerification) !== Boolean(definition.requiresVerification)
          || existing.verificationCommand !== definition.verificationCommand;
        const dependenciesChanged = JSON.stringify(existing.dependsOn ?? []) !== JSON.stringify(definition.dependsOn ?? []);
        if (existing.status === 'completed' && (gateChanged || dependenciesChanged)) {
          throw new Error(`Completed milestone "${existing.title}" cannot change its gate or dependencies.`);
        }
        if (['in_progress', 'verified'].includes(existing.status) &&
          (definition.dependsOn ?? []).some((id) => lifecycle.steps.find((step) => step.id === id)?.status !== 'completed')) {
          throw new Error(`Active milestone "${existing.title}" cannot depend on unfinished work.`);
        }
        return { ...existing, ...definition,
          ...(gateChanged ? { lastVerificationSha: undefined, lastVerificationStatus: undefined,
            status: existing.status === 'verified' ? 'in_progress' as const : existing.status } : {}),
        };
      });
      if (!lifecycle.steps.some((step) => step.id === lifecycle.currentStepId)) {
        lifecycle.currentStepId = lifecycle.steps.find((step) => ['in_progress', 'verified'].includes(step.status))?.id;
      }
      lifecycle.revision = (lifecycle.revision ?? 0) + 1;
      lifecycle.updatedAt = new Date().toISOString();
      return lifecycle;
    });
  } finally { await release(); }
}

export function renderLifecyclePlan(lifecycle: WorkspaceLifecycle, live = true): string {
  if (!lifecycle.steps.length) return '';
  const lines = ['<!-- CONTEXTSPACE:MILESTONES:START -->', '## Milestone plan', '',
    live ? 'Current progress from the workspace lifecycle.' : 'Milestone definitions from the workspace lifecycle. Run `ctxspace flow` for current progress.', ''];
  for (const [index, step] of lifecycle.steps.entries()) {
    lines.push(`${index + 1}. **${step.title}**${live ? ` — ${step.status.replaceAll('_', ' ')}` : ''}`);
    if (step.description) lines.push(`   ${step.description}`);
    if (step.dependsOn?.length) lines.push(`   Depends on: ${step.dependsOn.map((id) => lifecycle.steps.find((item) => item.id === id)?.title ?? id).join(', ')}`);
    if (step.repo) lines.push(`   Repository: ${step.repo}`);
    if (step.workItem) lines.push(`   Work item / PR: ${step.workItem}`);
    if (step.unblockCondition) lines.push(`   Unblock condition: ${step.unblockCondition}`);
    if (step.branch) lines.push(`   Branch: ${step.branch}`);
    if (step.requiresVerification || step.verificationCommand) lines.push('   Requires verification before completion.');
  }
  lines.push('', '<!-- CONTEXTSPACE:MILESTONES:END -->');
  return lines.join('\n');
}
