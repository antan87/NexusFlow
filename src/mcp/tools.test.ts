import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findTool, enabledTools } from './tools.js';
import * as workspace from '../core/workspace.js';
import * as refresh from '../core/refresh.js';
import * as fs from 'node:fs/promises';
import type { NexusFlowConfig } from '../types.js';

vi.mock('../core/workspace.js');
vi.mock('../core/refresh.js');
vi.mock('node:fs/promises');

const mockConfig: NexusFlowConfig = {
  version: '1.0',
  devDir: '/dev',
  workspacesDir: '/dev/workspaces',
  defaultAssistant: null,
  scanDepth: 2,
};

describe('MCP tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all Phase 2 workspace lifecycle tools', () => {
    expect(findTool('create_workspace')).toBeDefined();
    expect(findTool('list_workspaces')).toBeDefined();
    expect(findTool('list_repos')).toBeDefined();
    expect(findTool('isolate_repo')).toBeDefined();
    expect(findTool('get_service_logs')).toBeDefined();
  });

  it('filters tool surfaces correctly based on agent roles and allow/deny lists', () => {
    const allTools = enabledTools(mockConfig);
    expect(allTools.length).toBeGreaterThanOrEqual(14);

    const readonlyTools = enabledTools(mockConfig, 'readonly');
    const readonlyNames = readonlyTools.map((t) => t.name);
    expect(readonlyNames).toContain('search_workspace');
    expect(readonlyNames).toContain('workspace_status');
    expect(readonlyNames).toContain('get_workspace_diff');
    expect(readonlyNames).toContain('list_workspaces');
    expect(readonlyNames).toContain('list_repos');
    expect(readonlyNames).not.toContain('create_workspace');
    expect(readonlyNames).not.toContain('commit_workspace');
    expect(readonlyNames).not.toContain('finish_workspace');

    const explicitDenied = enabledTools(mockConfig, 'developer', undefined, ['commit_workspace']);
    expect(explicitDenied.map((t) => t.name)).not.toContain('commit_workspace');

    const explicitAllowed = enabledTools(mockConfig, undefined, ['search_workspace', 'list_repos']);
    expect(explicitAllowed.map((t) => t.name)).toEqual(['search_workspace', 'list_repos']);
  });

  it('executes list_workspaces tool handler successfully', async () => {
    const tool = findTool('list_workspaces');
    expect(tool).toBeDefined();

    vi.mocked(workspace.listWorkspaces).mockResolvedValue([
      {
        id: 'feat-auth',
        branchName: 'feat-auth',
        mode: 'worktree',
        description: 'User auth feature',
        repos: ['/dev/workspaces/feat-auth/api', '/dev/workspaces/feat-auth/web'],
        assistants: ['claude'],
        workspacePath: '/dev/workspaces/feat-auth',
        createdAt: '2026-08-23T00:00:00Z',
      },
    ]);

    const result = await tool!.handler({}, { config: mockConfig, workspacePath: '/dev/workspaces/feat-auth' });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0]!.text);
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      id: 'feat-auth',
      branchName: 'feat-auth',
      mode: 'worktree',
      description: 'User auth feature',
      reposCount: 2,
      workspacePath: '/dev/workspaces/feat-auth',
      createdAt: '2026-08-23T00:00:00Z',
    });
  });

  it('executes list_repos tool handler successfully', async () => {
    const tool = findTool('list_repos');
    expect(tool).toBeDefined();

    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      id: 'feat-auth',
      mode: 'worktree',
      branchName: 'feat-auth',
      description: 'test',
      repos: ['/dev/workspaces/feat-auth/api', '/dev/workspaces/feat-auth/web'],
      assistants: ['claude'],
      workspacePath: '/dev/workspaces/feat-auth',
      createdAt: '2026-08-23T00:00:00Z',
    });

    const result = await tool!.handler({}, { config: mockConfig, workspacePath: '/dev/workspaces/feat-auth' });
    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0]!.text);
    expect(content).toHaveLength(2);
    expect(content[0]?.name).toBe('api');
    expect(content[1]?.name).toBe('web');
  });

  it('executes create_workspace tool handler successfully', async () => {
    const tool = findTool('create_workspace');
    expect(tool).toBeDefined();

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(workspace.resolveRepoInfos).mockResolvedValue([
      { name: 'repo1', path: '/dev/repo1', defaultBranch: 'main' },
    ]);
    vi.mocked(workspace.createWorkspace).mockResolvedValue('/dev/workspaces/feat-test');
    vi.mocked(refresh.refreshWorkspace).mockResolvedValue({} as any);

    const result = await tool!.handler(
      {
        branchName: 'feat-test',
        repos: ['repo1'],
        description: 'New feature',
      },
      { config: mockConfig, workspacePath: '/dev/workspaces' },
    );

    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0]!.text);
    expect(content.id).toBe('feat-test');
    expect(content.workspacePath).toContain('feat-test');
    expect(content.status).toBe('created');
    expect(workspace.createWorkspace).toHaveBeenCalledTimes(1);
    expect(refresh.refreshWorkspace).toHaveBeenCalledTimes(1);
  });

  it('executes isolate_repo tool handler successfully', async () => {
    const tool = findTool('isolate_repo');
    expect(tool).toBeDefined();

    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      id: 'my-ws',
      mode: 'in-place',
      branchName: 'my-ws',
      description: 'test in-place',
      repos: ['/dev/repo1'],
      assistants: ['antigravity'],
      workspacePath: '/dev/workspaces/my-ws',
      createdAt: '2026-08-22T00:00:00Z',
    });

    vi.mocked(workspace.isolateWorkspaceRepo).mockResolvedValue({
      repoName: 'repo1',
      sourcePath: '/dev/repo1',
      worktreePath: '/dev/workspaces/my-ws/repo1',
      branchName: 'feat/repo1-my-ws',
      baseBranch: 'main',
      alreadyIsolated: false,
    });

    const result = await tool!.handler(
      { repo: 'repo1', branchName: 'feat/repo1-my-ws' },
      { config: mockConfig, workspacePath: '/dev/workspaces/my-ws' },
    );

    expect(result.isError).toBeFalsy();
    const content = JSON.parse(result.content[0]!.text);
    expect(content.repoName).toBe('repo1');
    expect(content.branchName).toBe('feat/repo1-my-ws');
    expect(content.alreadyIsolated).toBe(false);
    expect(content.instruction).toContain('is now isolated at');
  });

  it('returns error if repo argument is missing or empty in isolate_repo handler', async () => {
    const tool = findTool('isolate_repo');
    expect(tool).toBeDefined();

    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
      id: 'my-ws',
      mode: 'in-place',
      branchName: 'my-ws',
      description: 'test',
      repos: ['/dev/repo1'],
      assistants: ['antigravity'],
      workspacePath: '/dev/workspaces/my-ws',
      createdAt: '2026-08-22T00:00:00Z',
    });

    const result = await tool!.handler(
      { repo: '   ' },
      { config: mockConfig, workspacePath: '/dev/workspaces/my-ws' },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Repository name is required');
  });
});
