/**
 * archive_workspace may tidy other workspaces, never the one an agent works in;
 * unarchive_workspace only restores. Real directories, so the refusal checks
 * compare real paths the way the server does.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enabledTools, findTool } from './tools.js';
import { routeConsoleToStderr } from './server.js';
import * as archive from '../core/archive.js';
import * as workspace from '../core/workspace.js';
import type { NexusFlowConfig } from '../types.js';

vi.mock('../core/archive.js');
vi.mock('../core/workspace.js');

const config = { version: '1.0', devDir: '/dev', workspacesDir: '/dev/workspaces', defaultAssistant: null, scanDepth: 2 } as NexusFlowConfig;
const text = (result: { content: { text: string }[] }) => result.content[0]!.text;

describe('archive MCP tools', () => {
  let root: string;
  let served: string;
  let other: string;
  const cwd = process.cwd();

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cs-mcp-archive-')));
    served = path.join(root, 'served');
    other = path.join(root, 'other');
    await fs.mkdir(served);
    await fs.mkdir(other);
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({ id: 'ws' } as any);
    vi.mocked(archive.archiveWorkspace).mockResolvedValue({
      workspacePath: other, workspaceId: 'other', dryRun: false, alreadyArchived: false, ready: true, blockers: [],
      repos: [], kept: [], notes: [], archived: true, archivedAt: 'now', errors: [], branches: [],
    });
  });

  afterEach(async () => {
    process.chdir(cwd);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('are offered to sessions that may change workspaces, not to read-only ones', () => {
    for (const role of ['readonly', 'review', 'ci'] as const) {
      const names = enabledTools(config, role).map((tool) => tool.name);
      expect(names).not.toContain('archive_workspace');
      expect(names).not.toContain('unarchive_workspace');
    }
    const interactive = enabledTools(config, 'interactive').map((tool) => tool.name);
    expect(interactive).toEqual(expect.arrayContaining(['archive_workspace', 'unarchive_workspace', 'preview_archive']));
    expect(findTool('archive_workspace')?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(findTool('archive_workspace')?.inputSchema).toMatchObject({ required: ['workspaceId'] });
  });

  it('refuses the workspace the server serves, even through a linked path', async () => {
    const link = path.join(root, 'link-to-served');
    await fs.symlink(served, link);
    const result = await findTool('archive_workspace')!.handler({ workspaceId: 'served' }, { config, workspacePath: link, boundWorkspacePath: served });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/serves "link-to-served"|serves "served"/);
    expect(archive.archiveWorkspace).not.toHaveBeenCalled();
  });

  it('refuses a workspace this process runs inside', async () => {
    const worktree = path.join(other, 'api');
    await fs.mkdir(worktree);
    process.chdir(worktree);
    const result = await findTool('archive_workspace')!.handler({ workspaceId: 'other' }, { config, workspacePath: other, boundWorkspacePath: served });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/runs inside "other"/);
    expect(archive.archiveWorkspace).not.toHaveBeenCalled();
  });

  it('archives another workspace locally, never deleting remote branches', async () => {
    const result = await findTool('archive_workspace')!.handler(
      { workspaceId: 'other', park: true, deleteRemoteBranches: true },
      { config, workspacePath: other, boundWorkspacePath: served },
    );
    expect(result.isError).toBeFalsy();
    expect(archive.archiveWorkspace).toHaveBeenCalledWith(other, { park: true, keepBranches: false, dryRun: false });
    expect(JSON.parse(text(result))).toMatchObject({ archived: true, note: expect.stringMatching(/unarchive_workspace restores it/) });
  });

  it('requires the target to be named', async () => {
    const result = await findTool('archive_workspace')!.handler({}, { config, workspacePath: other, boundWorkspacePath: served });
    expect(result.isError).toBe(true);
    expect(archive.archiveWorkspace).not.toHaveBeenCalled();
  });

  it('unarchive_workspace restores and reports when there was nothing to do', async () => {
    vi.mocked(archive.unarchiveWorkspace)
      .mockResolvedValueOnce({ workspacePath: served, workspaceId: 'served', restored: true, notes: [] })
      .mockResolvedValueOnce({ workspacePath: served, workspaceId: 'served', restored: false, notes: [] });
    const tool = findTool('unarchive_workspace')!;
    expect(JSON.parse(text(await tool.handler({}, { config, workspacePath: served, boundWorkspacePath: served }))).note).toMatch(/Restored/);
    expect(JSON.parse(text(await tool.handler({}, { config, workspacePath: served, boundWorkspacePath: served }))).note).toMatch(/not archived/);
  });
});

describe('MCP stdout', () => {
  it('routes console output to stderr so it never enters the protocol stream', () => {
    const saved = { log: console.log, info: console.info, debug: console.debug };
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      routeConsoleToStderr();
      console.log('refresh %s', 'progress');
      console.info('info');
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr).toHaveBeenCalledWith('refresh progress\n');
      expect(stderr).toHaveBeenCalledWith('info\n');
    } finally {
      Object.assign(console, saved);
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });
});
