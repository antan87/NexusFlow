import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveMcpExecutionRole, resolveMcpWorkspacePath, startMcpServer } from './server.js';

describe('MCP server execution policy', () => {
  it('rejects an unknown runtime role before starting a transport', async () => {
    await expect(startMcpServer({ role: 'reviewer' })).rejects.toThrow(/invalid MCP execution role/i);
  });

  it('defaults an omitted execution role to the least-privilege read-only surface', () => {
    expect(resolveMcpExecutionRole(undefined)).toBe('readonly');
    expect(resolveMcpExecutionRole('interactive')).toBe('interactive');
    expect(() => resolveMcpExecutionRole('reviewer')).toThrow(/invalid MCP execution role/i);
  });

  it('rejects a workspace ID that escapes through a symlink or Windows junction', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-mcp-containment-'));
    const workspacesDir = path.join(root, 'workspaces');
    const outside = path.join(root, 'outside');
    await Promise.all([fs.mkdir(workspacesDir), fs.mkdir(outside)]);
    const linked = path.join(workspacesDir, 'linked-workspace');
    await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    const config = { workspacesDir } as any;
    try {
      await expect(resolveMcpWorkspacePath(undefined, config, { workspaceId: 'linked-workspace' }))
        .rejects.toThrow(/linked path/i);
      const local = path.join(workspacesDir, 'local-workspace');
      await fs.mkdir(local);
      await expect(resolveMcpWorkspacePath(undefined, config, { workspaceId: 'local-workspace' }))
        .resolves.toBe(await fs.realpath(local));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  describe('a server bound to a workspace', () => {
    async function withWorkspaces(run: (dirs: { config: any; bound: string; other: string; workspacesDir: string }) => Promise<void>) {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-mcp-bound-'));
      const workspacesDir = path.join(root, 'workspaces');
      const bound = path.join(workspacesDir, 'bound-workspace');
      const other = path.join(workspacesDir, 'other-workspace');
      await Promise.all([fs.mkdir(bound, { recursive: true }), fs.mkdir(other, { recursive: true })]);
      try {
        await run({ config: { workspacesDir }, bound, other: await fs.realpath(other), workspacesDir });
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }

    it('uses the bound workspace when no workspaceId is given', () => withWorkspaces(async ({ config, bound }) => {
      await expect(resolveMcpWorkspacePath(bound, config, {}, 'interactive')).resolves.toBe(bound);
      await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: '' }, 'developer')).resolves.toBe(bound);
    }));

    it('accepts its own workspace ID for every role', () => withWorkspaces(async ({ config, bound }) => {
      for (const role of ['interactive', 'developer', 'readonly'] as const) {
        await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'bound-workspace' }, role)).resolves.toBe(bound);
      }
    }));

    it('lets interactive and full sessions address another workspace instead of silently using the bound one', () =>
      withWorkspaces(async ({ config, bound, other }) => {
        await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'other-workspace' }, 'interactive')).resolves.toBe(other);
        await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'other-workspace' }, 'full')).resolves.toBe(other);
      }));

    it.each(['developer', 'review', 'ci', 'readonly', undefined] as const)(
      'rejects another workspace for role %s rather than acting on the bound one',
      (role) => withWorkspaces(async ({ config, bound }) => {
        await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'other-workspace' }, role))
          .rejects.toThrow(/bound to workspace "bound-workspace".*cannot act on workspace "other-workspace"/);
      }),
    );

    it('reports an unknown workspace instead of falling back to the bound one', () => withWorkspaces(async ({ config, bound }) => {
      await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'missing-workspace' }, 'interactive'))
        .rejects.toThrow(/"missing-workspace" was not found/);
    }));

    it('keeps rejecting IDs that escape the workspaces directory', () => withWorkspaces(async ({ config, bound, workspacesDir }) => {
      await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: '../outside' }, 'full')).rejects.toThrow(/outside the workspaces directory/);
      const outside = path.join(path.dirname(workspacesDir), 'outside');
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(workspacesDir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      await expect(resolveMcpWorkspacePath(bound, config, { workspaceId: 'linked' }, 'full')).rejects.toThrow(/linked path/);
    }));
  });
});
