import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findTool, enabledTools } from './tools.js';
import * as workspace from '../core/workspace.js';
import type { NexusFlowConfig } from '../types.js';

vi.mock('../core/workspace.js');

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

  it('registers the isolate_repo tool', () => {
    const tool = findTool('isolate_repo');
    expect(tool).toBeDefined();
    expect(tool?.name).toBe('isolate_repo');
    expect(tool?.description).toContain('Dynamically isolate a repository');
    expect(tool?.inputSchema.required).toContain('repo');
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
