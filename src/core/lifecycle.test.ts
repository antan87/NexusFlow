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
      expect(steps[0]!.status).toBe('completed');
      expect(steps[1]!.status).toBe('in_progress');
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
      expect(workspaceState.saveWorkspaceState).toHaveBeenCalled();
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
  });
});
