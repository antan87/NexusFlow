import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isolateCommand } from './isolate.js';
import * as workspace from '../core/workspace.js';
import * as resolveWs from '../utils/resolve-workspace.js';

vi.mock('../core/workspace.js');
vi.mock('../utils/resolve-workspace.js');
vi.mock('@inquirer/prompts');

describe('isolateCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits early if no workspace is resolved', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue(null);
    await isolateCommand();
    expect(workspace.loadFeatureConfig).not.toHaveBeenCalled();
  });

  it('warns and exits if workspace is already in worktree mode', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue('/ws');
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      id: 'ws-worktree',
      mode: 'worktree',
      branchName: 'ws-worktree',
      description: 'test',
      repos: ['/ws/repo1'],
      assistants: ['antigravity'],
      workspacePath: '/ws',
      createdAt: '2026-08-22T00:00:00Z',
    });

    await isolateCommand('repo1');
    expect(workspace.isolateWorkspaceRepo).not.toHaveBeenCalled();
  });

  it('isolates a repo successfully in an in-place workspace', async () => {
    vi.mocked(resolveWs.resolveWorkspaceInteractive).mockResolvedValue('/ws');
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      id: 'ws-inplace',
      mode: 'in-place',
      branchName: 'ws-inplace',
      description: 'test',
      repos: ['/dev/repo1', '/dev/repo2'],
      assistants: ['antigravity'],
      workspacePath: '/ws',
      createdAt: '2026-08-22T00:00:00Z',
    });

    vi.mocked(workspace.isolateWorkspaceRepo).mockResolvedValue({
      repoName: 'repo1',
      sourcePath: '/dev/repo1',
      worktreePath: '/ws/repo1',
      branchName: 'feat/repo1-ws',
      baseBranch: 'main',
      alreadyIsolated: false,
    });

    await isolateCommand('repo1', 'feat/repo1-ws');

    expect(workspace.isolateWorkspaceRepo).toHaveBeenCalledWith('/ws', 'repo1', {
      branchName: 'feat/repo1-ws',
      baseBranch: undefined,
    });
  });
});
