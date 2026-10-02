import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { app } from './server.js';
import * as configModule from './core/config.js';
import * as workspace from './core/workspace.js';
import { findTool } from './mcp/tools.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-attention-route-'));
  vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
    version: '1.0', devDir: '/dev', workspacesDir: root, defaultAssistant: null, scanDepth: 2,
  } as any);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
});

async function ledgerFor(id: string, entries: Array<Record<string, unknown>>) {
  const dir = path.join(root, id, '.contextspace');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'chat.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

const recent = (over: Record<string, unknown> = {}) => ({
  id: 'r', timestamp: new Date(Date.now() - 60_000).toISOString(), harness: 'codex', author: 'agent', kind: 'input_request', message: 'Proceed?', ...over,
});

async function attention(query: string) {
  const res = await app.request(`/api/attention${query}`);
  return { status: res.status, body: (await res.json()) as any };
}

describe('request_user_input to GET /api/attention', () => {
  it('serves what the MCP tool wrote, so the two halves agree on the ledger format', async () => {
    const dir = path.join(root, 'round-trip');
    await fs.mkdir(path.join(dir, '.contextspace'), { recursive: true });
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: 'round-trip', branchName: 'round-trip', description: 'x', mode: 'worktree', repos: [], assistants: [],
      workspacePath: dir, createdAt: new Date().toISOString(),
    });

    const written = await findTool('request_user_input')!.handler(
      { message: 'Should I delete the old migration?', harness: 'codex' },
      { config: { version: '1.0', devDir: '/dev', workspacesDir: root, defaultAssistant: null, scanDepth: 2 }, workspacePath: dir },
    );
    expect(written.isError).toBeFalsy();

    const { body } = await attention('?workspaces=round-trip');
    expect(body.requests).toEqual([
      expect.objectContaining({ workspaceId: 'round-trip', harness: 'codex', message: 'Should I delete the old migration?' }),
    ]);
  });
});

describe('GET /api/attention', () => {
  it('returns the latest request for each named workspace that has one', async () => {
    await ledgerFor('alpha', [recent({ id: 'a1', message: 'Alpha question' })]);
    await ledgerFor('beta', [{ id: 'h', timestamp: new Date().toISOString(), author: 'agent', message: 'just a note' }]);
    await ledgerFor('gamma', [recent({ id: 'g1', harness: 'pi', message: 'Gamma question' })]);

    const { status, body } = await attention('?workspaces=alpha,beta,gamma');

    expect(status).toBe(200);
    expect(body.requests).toEqual([
      expect.objectContaining({ workspaceId: 'alpha', id: 'a1', message: 'Alpha question', harness: 'codex' }),
      expect.objectContaining({ workspaceId: 'gamma', id: 'g1', message: 'Gamma question', harness: 'pi' }),
    ]);
  });

  it('only looks at the workspaces it is asked about', async () => {
    await ledgerFor('alpha', [recent({ message: 'Alpha' })]);
    await ledgerFor('beta', [recent({ message: 'Beta' })]);
    expect((await attention('?workspaces=beta')).body.requests.map((r: any) => r.workspaceId)).toEqual(['beta']);
  });

  it.each([
    ['no parameter', ''],
    ['an empty parameter', '?workspaces='],
    ['only blanks and commas', '?workspaces=,%20,,'],
  ])('returns an empty list for %s', async (_label, query) => {
    await ledgerFor('alpha', [recent()]);
    expect(await attention(query)).toEqual({ status: 200, body: { requests: [] } });
  });

  it('skips unknown workspaces without failing the rest', async () => {
    await ledgerFor('alpha', [recent()]);
    const { status, body } = await attention('?workspaces=ghost,alpha');
    expect(status).toBe(200);
    expect(body.requests.map((r: any) => r.workspaceId)).toEqual(['alpha']);
  });

  it('refuses ids that point outside the workspaces directory', async () => {
    // A ledger one level above the workspaces directory must stay unreachable.
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside`);
    await fs.mkdir(path.join(outside, '.contextspace'), { recursive: true });
    await fs.writeFile(path.join(outside, '.contextspace', 'chat.jsonl'), JSON.stringify(recent({ message: 'Leaked' })) + '\n', 'utf8');
    try {
      const traversal = encodeURIComponent(`../${path.basename(outside)}`);
      const absolute = encodeURIComponent(outside);
      const { status, body } = await attention(`?workspaces=${traversal},${absolute}`);
      expect(status).toBe(200);
      expect(body.requests).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('counts a repeated id once', async () => {
    await ledgerFor('alpha', [recent()]);
    expect((await attention('?workspaces=alpha,alpha,alpha')).body.requests).toHaveLength(1);
  });

  it('answers for at most 100 workspaces', async () => {
    const ids = Array.from({ length: 105 }, (_, i) => `ws-${String(i).padStart(3, '0')}`);
    await Promise.all(ids.map((id) => ledgerFor(id, [recent({ id: `r-${id}` })])));

    const { body } = await attention(`?workspaces=${ids.join(',')}`);

    expect(body.requests).toHaveLength(100);
    expect(body.requests.map((r: any) => r.workspaceId)).not.toContain('ws-104');
  });

  it('does not return stale requests', async () => {
    await ledgerFor('alpha', [recent({ timestamp: new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString() })]);
    expect((await attention('?workspaces=alpha')).body.requests).toEqual([]);
  });
});
