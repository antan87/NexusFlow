import { describe, expect, it, vi } from 'vitest';
import {
  suggestedBranchName,
  isWorkspaceFormValid,
  handleWorkspaceCreationCompletion,
  withStartHarness,
  resolveStartHarness,
} from './createWorkspaceFlow.js';

describe('suggestedBranchName', () => {
  it('converts human titles into clean feature branch slugs', () => {
    expect(suggestedBranchName('Fast Workspace Creation')).toBe('feature/fast-workspace-creation');
    expect(suggestedBranchName('Fix Issue #42 (urgent!)')).toBe('feature/fix-issue-42-urgent');
  });

  it('handles edge cases such as leading/trailing separators and empty inputs', () => {
    expect(suggestedBranchName('---my--feature---')).toBe('feature/my-feature');
    expect(suggestedBranchName('')).toBe('');
    expect(suggestedBranchName('   ')).toBe('');
    expect(suggestedBranchName('$$$###')).toBe('');
  });
});

describe('isWorkspaceFormValid', () => {
  it('allows in-place workspace creation with only name and selected repos (description is optional)', () => {
    const valid = isWorkspaceFormValid({
      workspaceName: 'Rapid Setup',
      mode: 'in-place',
      selectedRepoCount: 1,
    });
    expect(valid).toBe(true);
  });

  it('allows worktree workspace creation when workspaceName can generate a branch name', () => {
    const valid = isWorkspaceFormValid({
      workspaceName: 'New Worktree',
      mode: 'worktree',
      selectedRepoCount: 2,
    });
    expect(valid).toBe(true);
  });

  it('allows worktree workspace creation with an explicit custom branch name', () => {
    const valid = isWorkspaceFormValid({
      workspaceName: 'Custom Branch Work',
      mode: 'worktree',
      branchName: 'custom/feat-branch',
      selectedRepoCount: 1,
    });
    expect(valid).toBe(true);
  });

  it('rejects creation when workspace name is empty or only whitespace', () => {
    expect(
      isWorkspaceFormValid({
        workspaceName: '',
        mode: 'in-place',
        selectedRepoCount: 1,
      }),
    ).toBe(false);

    expect(
      isWorkspaceFormValid({
        workspaceName: '   ',
        mode: 'worktree',
        selectedRepoCount: 1,
      }),
    ).toBe(false);
  });

  it('rejects creation when no repositories are selected', () => {
    expect(
      isWorkspaceFormValid({
        workspaceName: 'Valid Name',
        mode: 'in-place',
        selectedRepoCount: 0,
      }),
    ).toBe(false);

    expect(
      isWorkspaceFormValid({
        workspaceName: 'Valid Name',
        mode: 'worktree',
        selectedRepoCount: 0,
      }),
    ).toBe(false);
  });

  it('rejects worktree creation if workspace name cannot produce a branch and no branch name is provided', () => {
    expect(
      isWorkspaceFormValid({
        workspaceName: '###',
        mode: 'worktree',
        selectedRepoCount: 1,
      }),
    ).toBe(false);
  });
});

describe('handleWorkspaceCreationCompletion', () => {
  it('triggers immediate CLI session opening and navigates directly to workspace on completed status', () => {
    const onOpenCli = vi.fn();
    const onNavigate = vi.fn();

    const result = handleWorkspaceCreationCompletion({
      status: 'completed',
      workspaceId: 'feat/fast-ws',
      lastOpenedWorkspaceId: null,
      onOpenCli,
      onNavigate,
    });

    expect(result).toBe('feat/fast-ws');
    expect(onOpenCli).toHaveBeenCalledTimes(1);
    expect(onOpenCli).toHaveBeenCalledWith('feat/fast-ws');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('/workspaces/feat%2Ffast-ws');
  });

  it('does not navigate or open CLI while status is still running', () => {
    const onOpenCli = vi.fn();
    const onNavigate = vi.fn();

    const result = handleWorkspaceCreationCompletion({
      status: 'running',
      workspaceId: 'feat/fast-ws',
      lastOpenedWorkspaceId: null,
      onOpenCli,
      onNavigate,
    });

    expect(result).toBeNull();
    expect(onOpenCli).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate or open CLI if status is failed', () => {
    const onOpenCli = vi.fn();
    const onNavigate = vi.fn();

    const result = handleWorkspaceCreationCompletion({
      status: 'failed',
      workspaceId: 'feat/fast-ws',
      lastOpenedWorkspaceId: null,
      onOpenCli,
      onNavigate,
    });

    expect(result).toBeNull();
    expect(onOpenCli).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not re-navigate or duplicate CLI opening if already opened for this workspaceId', () => {
    const onOpenCli = vi.fn();
    const onNavigate = vi.fn();

    const result = handleWorkspaceCreationCompletion({
      status: 'completed',
      workspaceId: 'feat/fast-ws',
      lastOpenedWorkspaceId: 'feat/fast-ws',
      onOpenCli,
      onNavigate,
    });

    expect(result).toBe('feat/fast-ws');
    expect(onOpenCli).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate or open CLI when autoNavigate is false (replayed job inspection)', () => {
    const onOpenCli = vi.fn();
    const onNavigate = vi.fn();

    const result = handleWorkspaceCreationCompletion({
      status: 'completed',
      workspaceId: 'feat/fast-ws',
      lastOpenedWorkspaceId: null,
      autoNavigate: false,
      onOpenCli,
      onNavigate,
    });

    expect(result).toBe('feat/fast-ws');
    expect(onOpenCli).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('withStartHarness', () => {
  it('adds the harness to start with so it always receives the workspace instructions', () => {
    expect(withStartHarness([], 'claude')).toEqual(['claude']);
    expect(withStartHarness(['codex'], 'claude')).toEqual(['codex', 'claude']);
  });

  it('does not duplicate a harness that is already selected, nor add anything when none is chosen', () => {
    expect(withStartHarness(['claude', 'codex'], 'claude')).toEqual(['claude', 'codex']);
    expect(withStartHarness(['codex'], '')).toEqual(['codex']);
  });

  it('returns a new array rather than the caller\'s state', () => {
    const selected = ['codex'];
    expect(withStartHarness(selected, '')).not.toBe(selected);
  });
});

describe('resolveStartHarness', () => {
  const installed = ['claude', 'codex'];

  it('shows the harness the developer picked', () => {
    expect(resolveStartHarness({ chosen: 'codex', installed })).toBe('codex');
  });

  it('chooses nothing until the developer picks, however many tools are installed', () => {
    expect(resolveStartHarness({ chosen: '', installed })).toBe('');
    expect(resolveStartHarness({ chosen: '', installed: ['claude'] })).toBe('');
  });

  it('drops a pick that is not installed', () => {
    expect(resolveStartHarness({ chosen: 'cursor', installed })).toBe('');
    expect(resolveStartHarness({ chosen: 'claude', installed: [] })).toBe('');
  });
});
