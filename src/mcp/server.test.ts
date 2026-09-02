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
});
