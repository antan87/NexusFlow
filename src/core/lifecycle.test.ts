import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDefaultSteps,
  loadWorkspaceLifecycle,
  advanceLifecycleStep,
  getBranchFleet,
} from './lifecycle.js';
import * as workspaceState from './workspace-state.js';
import * as workspaceCore from './workspace.js';
import * as featureUtils from '../utils/feature.js';
import * as multiGit from '../utils/multi-git.js';
import { execa } from 'execa';

vi.mock('execa');
vi.mock('./workspace-state.js');
vi.mock('./workspace.js');
vi.mock('../utils/feature.js');
vi.mock('../utils/multi-git.js');
vi.mock('./verify.js');

describe('core/lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workspaceState.mutateWorkspaceState).mockImplementation(async (workspacePath, mutation) => mutation(await workspaceState.loadWorkspaceState(workspacePath)));
  });

  describe('createDefaultSteps', () => {
    it('creates 2-step pipeline for quick flow', () => {
      const steps = createDefaultSteps('quick', 'ws-quick', 'fix/typo');
      expect(steps).toHaveLength(2);
      expect(steps[0]!.id).toBe('reproduce_and_fix');
      expect(steps[0]!.status).toBe('in_progress');
      expect(steps[1]!.id).toBe('verify_and_ship');
      expect(steps[1]!.dependsOn).toEqual(['reproduce_and_fix']);
    });

    it('creates phased steps for standard feature flow', () => {
      const steps = createDefaultSteps('feature', 'ws-feat', 'feat/auth');
      expect(steps).toHaveLength(4);
      expect(steps[0]!.status).toBe('in_progress');
      expect(steps[1]!.status).toBe('pending');
      expect(steps[2]!.dependsOn).toEqual(['step_implementation']);
    });

    it('creates vertical slices for epic flow', () => {
      const steps = createDefaultSteps('epic', 'ws-epic', 'epic/redesign');
      expect(steps).toHaveLength(4);
      expect(steps[0]!.title).toContain('Core Schema');
      expect(steps[3]!.status).toBe('blocked');
    });
  });

  describe('loadWorkspaceLifecycle', () => {
    it('returns existing lifecycle if already persisted in state', async () => {
      const existing = {
        workspaceId: 'ws-1',
        flowType: 'feature' as const,
        currentStepId: 'step_implementation',
        steps: [
          { id: 'step_implementation', title: 'Implement', status: 'in_progress' as const },
        ],
        updatedAt: '2026-09-11T12:00:00.000Z',
      };

      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws',
        repos: {},
        lifecycle: existing,
        updatedAt: '2026-09-11T12:00:00.000Z',
      });
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-1',
        branchName: 'feat/test',
        repos: [],
      } as any);

      const lifecycle = await loadWorkspaceLifecycle('/ws');
      expect(lifecycle.workspaceId).toBe('ws-1');
      expect(lifecycle.steps).toHaveLength(1);
    });

    it('initializes and persists default lifecycle when absent', async () => {
      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws',
        repos: {},
        updatedAt: '2026-09-11T12:00:00.000Z',
      });
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-new',
        branchName: 'feat/billing',
        repos: [],
      } as any);

      const lifecycle = await loadWorkspaceLifecycle('/ws');
      expect(lifecycle.workspaceId).toBe('ws-new');
      expect(lifecycle.steps.length).toBeGreaterThan(0);
      expect(workspaceState.mutateWorkspaceState).toHaveBeenCalled();
    });
  });

  describe('advanceLifecycleStep', () => {
    it('sets step to in_progress on start', async () => {
      const existing = {
        workspaceId: 'ws-1',
        flowType: 'feature' as const,
        steps: [
          { id: 'step-1', title: 'Step 1', status: 'pending' as const },
        ],
        updatedAt: '2026-09-11T12:00:00.000Z',
      };

      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws',
        repos: {},
        lifecycle: existing,
        updatedAt: '2026-09-11T12:00:00.000Z',
      });
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-1',
        branchName: 'feat/test',
        repos: [],
      } as any);

      const updated = await advanceLifecycleStep('/ws', 'step-1', 'start');
      expect(updated.steps[0]!.status).toBe('in_progress');
      expect(updated.currentStepId).toBe('step-1');
    });

    it('unblocks downstream dependent steps when a step completes', async () => {
      const existing = {
        workspaceId: 'ws-1',
        flowType: 'feature' as const,
        steps: [
          { id: 'step-1', title: 'Step 1', status: 'in_progress' as const },
          { id: 'step-2', title: 'Step 2', status: 'blocked' as const, dependsOn: ['step-1'] },
        ],
        updatedAt: '2026-09-11T12:00:00.000Z',
      };

      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws',
        repos: {},
        lifecycle: existing,
        updatedAt: '2026-09-11T12:00:00.000Z',
      });
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-1',
        branchName: 'feat/test',
        repos: [],
      } as any);

      const updated = await advanceLifecycleStep('/ws', 'step-1', 'complete');
      expect(updated.steps[0]!.status).toBe('completed');
      expect(updated.steps[1]!.status).toBe('in_progress'); // unblocked from blocked -> pending -> in_progress
    });

    it('sets step to verified when verify reports pass_dirty', async () => {
      const verifyModule = await import('./verify.js');
      vi.mocked(verifyModule.verifyWorkspace).mockResolvedValue({
        workspacePath: '/ws',
        overallStatus: 'pass_dirty',
        canProgress: true,
        verifiedAt: new Date().toISOString(),
        durationMs: 45,
        repos: [{ repoName: 'repoA', headSha: 'abc999', status: 'pass_dirty' } as any],
      });

      const existing = {
        workspaceId: 'ws-1',
        flowType: 'feature' as const,
        steps: [
          { id: 'step-verify', title: 'Verify', status: 'in_progress' as const },
        ],
        updatedAt: '2026-09-11T12:00:00.000Z',
      };

      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws',
        repos: {},
        lifecycle: existing,
        updatedAt: '2026-09-11T12:00:00.000Z',
      });
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-1',
        branchName: 'feat/test',
        repos: ['repoA'],
      } as any);

      const updated = await advanceLifecycleStep('/ws', 'step-verify', 'verify');
      expect(updated.steps[0]!.status).toBe('verified');
      expect(updated.steps[0]!.lastVerificationSha).toBe('abc999');
    });
  });

  describe('transition guards', () => {
    beforeEach(() => {
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({ id: 'ws', branchName: 'fix/example', repos: [] } as any);
      vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({
        workspacePath: '/ws', repos: {}, updatedAt: '',
        lifecycle: { workspaceId: 'ws', flowType: 'quick', currentStepId: 'reproduce_and_fix',
          steps: createDefaultSteps('quick', 'ws', 'fix/example'), updatedAt: '' },
      });
    });

    it.each(['start', 'verify', 'complete'] as const)('rejects %s when dependencies are unfinished', async (action) => {
      await expect(advanceLifecycleStep('/ws', 'verify_and_ship', action)).rejects.toThrow(/dependencies/);
      expect(workspaceState.mutateWorkspaceState).not.toHaveBeenCalled();
    });

    it('rejects unknown actions', async () => {
      await expect(advanceLifecycleStep('/ws', 'reproduce_and_fix', 'skip' as any)).rejects.toThrow(/Unknown/);
    });

    it('does not accept dirty verification without progress permission, or retain stale verified status', async () => {
      const { verifyWorkspace } = await import('./verify.js');
      const state = await workspaceState.loadWorkspaceState('/ws');
      state.lifecycle!.steps[0].status = 'verified';
      vi.mocked(verifyWorkspace).mockResolvedValue({ canProgress: false, overallStatus: 'pass_dirty', repos: [] } as any);
      const result = await advanceLifecycleStep('/ws', 'reproduce_and_fix', 'verify');
      expect(result.steps[0].status).toBe('in_progress');
    });

    it('runs the gate before completion, persists a failure, and allows recovery', async () => {
      const { verifyWorkspace } = await import('./verify.js');
      await advanceLifecycleStep('/ws', 'reproduce_and_fix', 'complete');
      vi.mocked(verifyWorkspace).mockResolvedValueOnce({ canProgress: false, overallStatus: 'fail', repos: [] } as any);
      await expect(advanceLifecycleStep('/ws', 'verify_and_ship', 'complete')).rejects.toThrow(/Verification/);
      const state = await workspaceState.loadWorkspaceState('/ws');
      expect(state.lifecycle!.steps[1].status).toBe('in_progress');
      expect(state.lifecycle!.steps[1].lastVerificationStatus).toBe('fail');
      vi.mocked(verifyWorkspace).mockResolvedValueOnce({ canProgress: true, overallStatus: 'pass', repos: [] } as any);
      const result = await advanceLifecycleStep('/ws', 'verify_and_ship', 'complete');
      expect(result.steps.every((step) => step.status === 'completed')).toBe(true);
      expect(result.currentStepId).toBeUndefined();
    });
  });

  it.each(['quick', 'feature', 'epic'] as const)('preserves explicit %s flow despite branch naming', async (flowType) => {
    vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({ workspacePath: '/ws', repos: {}, updatedAt: '' });
    vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({ id: 'ws', branchName: 'fix/example', flowType, repos: [] } as any);
    const lifecycle = await loadWorkspaceLifecycle('/ws');
    expect(lifecycle.flowType).toBe(flowType);
    expect(lifecycle.steps.some((step) => step.status === 'completed' || step.completedAt)).toBe(false);
    expect(lifecycle.steps.every((step) => step.branch === 'fix/example')).toBe(true);
  });

  it('does not invent a branch for an in-place workspace without branch information', async () => {
    vi.mocked(workspaceState.loadWorkspaceState).mockResolvedValue({ workspacePath: '/ws', repos: {}, updatedAt: '' });
    vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({ id: 'ws', branchName: 'workspace-name', mode: 'in-place', repos: [] } as any);
    const lifecycle = await loadWorkspaceLifecycle('/ws');
    expect(lifecycle.steps.every((step) => step.branch === undefined)).toBe(true);
  });

  describe('getBranchFleet', () => {
    it('safely handles commit messages containing pipe | characters', async () => {
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-fleet',
        branchName: 'feat/fleet',
        repos: ['repo1'],
      } as any);
      vi.mocked(workspaceCore.resolveRepoInfos).mockResolvedValue([
        { name: 'repo1', path: '/ws/repo1', defaultBranch: 'main' },
      ]);
      vi.mocked(multiGit.getRepoBranch).mockResolvedValue('feat/fleet');
      vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 } as any);

      // Unit separator \x1f format output from git log
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => {
        if (args && args[0] === 'log') {
          return { stdout: 'a1b2c3d\x1ffeat(api): support JSON | YAML configs\x1fAlice\x1f2 hours ago' } as any;
        }
        if (args && args[0] === 'for-each-ref') {
          return { stdout: 'refs/remotes/origin/main\x1fe4f5g6h\x1fchore(db): postgres | sqlite\x1fBob\x1f3 days ago' } as any;
        }
        return { stdout: 'feat/fleet' } as any;
      });

      const fleet = await getBranchFleet('/ws');
      expect(fleet.length).toBeGreaterThan(0);
      expect(fleet[0]!.lastCommitMessage).toBe('feat(api): support JSON | YAML configs');
      expect(fleet[0]!.lastCommitAuthor).toBe('Alice');
    });

    it('filters out symrefs, origin, origin/HEAD, HEAD, and currentBranch from fleet', async () => {
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-fleet',
        branchName: 'feat/fleet',
        repos: ['repo1'],
      } as any);
      vi.mocked(workspaceCore.resolveRepoInfos).mockResolvedValue([
        { name: 'repo1', path: '/ws/repo1', defaultBranch: 'main' },
      ]);
      vi.mocked(multiGit.getRepoBranch).mockResolvedValue('feat/fleet');
      vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 1, behind: 0 } as any);

      let passedArgs: string[] = [];
      vi.mocked(execa).mockImplementation(async (_cmd: any, args: any) => {
        if (args && args[0] === 'log') {
          return { stdout: 'a1b2c3d\x1ffeat: test\x1fAlice\x1f1 hour ago' } as any;
        }
        if (args && args[0] === 'for-each-ref') {
          passedArgs = args;
          const outputLines = [
            'origin\x1fsha1\x1fcommit 1\x1fAuthor 1\x1f1 day ago\x1frefs/remotes/origin/main',
            'origin/HEAD\x1fsha2\x1fcommit 2\x1fAuthor 2\x1f1 day ago\x1frefs/remotes/origin/main',
            'origin/feat/fleet\x1fsha3\x1fcommit 3\x1fAuthor 3\x1f1 day ago\x1f',
            'origin/HEAD\x1fsha4\x1fcommit 4\x1fAuthor 4\x1f1 day ago\x1f',
            'origin/dev\x1fsha5\x1ffeat: dev branch\x1fCharlie\x1f2 days ago\x1f',
            'origin/main\x1fsha6\x1fchore: main branch\x1fDave\x1f3 days ago\x1f',
          ];
          return { stdout: outputLines.join('\n') } as any;
        }
        return { stdout: 'feat/fleet' } as any;
      });

      const fleet = await getBranchFleet('/ws');
      expect(passedArgs).toContain(
        '--format=%(refname:short)\x1f%(objectname:short)\x1f%(subject)\x1f%(authorname)\x1f%(authordate:relative)\x1f%(symref)',
      );

      expect(fleet).toHaveLength(3);
      expect(fleet[0]!.branch).toBe('feat/fleet');
      expect(fleet[0]!.isCurrent).toBe(true);

      const remoteBranches = fleet.slice(1).map((m) => m.branch);
      expect(remoteBranches).toEqual(['origin/dev', 'origin/main']);
    });

    it('aggregates fleet across multiple repositories in workspace', async () => {
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'ws-multi',
        branchName: 'feat/shared',
        repos: ['repo1', 'repo2'],
      } as any);
      vi.mocked(workspaceCore.resolveRepoInfos).mockResolvedValue([
        { name: 'repo1', path: '/ws/repo1', defaultBranch: 'main' },
        { name: 'repo2', path: '/ws/repo2', defaultBranch: 'main' },
      ]);
      vi.mocked(multiGit.getRepoBranch).mockResolvedValue('feat/shared');
      vi.mocked(multiGit.getAheadBehind).mockResolvedValue({ ahead: 0, behind: 0 } as any);

      vi.mocked(execa).mockImplementation(async (_cmd: any, args: any) => {
        if (args && args[0] === 'log') {
          return { stdout: 'sha1\x1fcommit\x1fAuthor\x1f1 day ago' } as any;
        }
        if (args && args[0] === 'for-each-ref') {
          return { stdout: 'origin/dev\x1fsha2\x1fdev commit\x1fAuthor\x1f2 days ago\x1f' } as any;
        }
        return { stdout: '' } as any;
      });

      const fleet = await getBranchFleet('/ws');
      expect(fleet).toHaveLength(4);
      expect(fleet[0]!.repoName).toBe('repo1');
      expect(fleet[1]!.repoName).toBe('repo1');
      expect(fleet[2]!.repoName).toBe('repo2');
      expect(fleet[3]!.repoName).toBe('repo2');
    });
  });
});
