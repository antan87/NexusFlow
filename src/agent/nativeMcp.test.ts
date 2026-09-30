import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openWorkspaceMcp } from './nativeMcp.js';

let root: string;
beforeEach(async () => {
  root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'native-mcp-'));
});
afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});

const writeConfig = async (servers: Record<string, unknown>) => {
  await fs.promises.writeFile(path.join(root, '.mcp.json'), JSON.stringify({ mcpServers: servers }, null, 2));
};

describe('workspace MCP bridge for native agents', () => {
  it('is empty when the workspace has no MCP config', async () => {
    expect((await openWorkspaceMcp({ cwd: root })).tools).toEqual([]);
  });

  it('exposes the configured server tools and calls them', async () => {
    await writeConfig({ 'contextspace-mcp': { command: '/bin/ctxspace', args: ['mcp', 'run'] } });
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '["repo1"]' }] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'list_repos', description: 'List repos', inputSchema: { type: 'object', properties: {} } }],
    });

    const { tools } = await openWorkspaceMcp({
      cwd: root,
      onProblem: () => {},
      createClient: () => ({ connect, listTools, callTool, close: vi.fn() }) as never,
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(listTools).toHaveBeenCalledTimes(1);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ name: 'list_repos', description: 'List repos' });
    // The advertised schema is what makes the tool callable by the model.
    expect(tools[0]!.inputSchema).toEqual({ type: 'object', properties: {} });

    // And a tool call actually reaches the server.
    await expect(tools[0]!.call({})).resolves.toBe('["repo1"]');
    expect(callTool).toHaveBeenCalledWith({ name: 'list_repos', arguments: {} });
  });

  it('returns an error string rather than throwing when a tool call fails', async () => {
    await writeConfig({ server: { command: '/bin/ctxspace', args: [] } });
    const { tools } = await openWorkspaceMcp({
      cwd: root,
      onProblem: () => {},
      createClient: () => ({
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'search_knowledge' }] }),
        callTool: vi.fn().mockRejectedValue(new Error('server went away')),
        close: vi.fn(),
      }) as never,
    });
    await expect(tools[0]!.call({})).resolves.toMatch(/^Error: server went away/);
  });

  it('reports a problem instead of throwing when the server cannot start', async () => {
    await writeConfig({ broken: { command: '/definitely/not/a/binary', args: [] } });
    const problems: string[] = [];
    const { tools } = await openWorkspaceMcp({ cwd: root, onProblem: (message) => problems.push(message) });
    expect(tools).toEqual([]);
    expect(problems.join(' ')).toMatch(/MCP server unavailable/);
  });

  it('reuses one connection across turns and closes it on demand', async () => {
    // Connecting per turn leaked one spawned server process per turn, so the
    // agent now holds one connection for the session.
    await writeConfig({ server: { command: '/bin/ctxspace', args: [] } });
    let created = 0;
    let closed = 0;
    const makeClient = () => {
      created++;
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'list_repos' }] }),
        callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
        close: vi.fn().mockImplementation(async () => { closed++; }),
      } as never;
    };
    const connection = await openWorkspaceMcp({ cwd: root, createClient: makeClient });
    expect(created).toBe(1);
    expect(connection.tools).toHaveLength(1);
    await connection.close();
    expect(closed).toBe(1);
    // Closing twice must not throw: stop() and an explicit dispose can both fire.
    await expect(connection.close()).resolves.toBeUndefined();
  });

  it('prefers a local command over a runtime-fetched one', async () => {
    await writeConfig({
      fetched: { command: 'npx', args: ['-y', 'some-package'] },
      local: { command: '/workspace/.contextspace/bin/ctxspace', args: ['mcp', 'run'] },
    });
    const seen: unknown[] = [];
    const { close } = await openWorkspaceMcp({
      cwd: root,
      createTransport: (config) => {
        seen.push(config);
        throw new Error('stop here');
      },
      onProblem: () => {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as never);
    expect(seen).toHaveLength(1);
    expect((seen[0] as { command: string }).command).toContain('.contextspace/bin/ctxspace');
    await expect(close()).resolves.toBeUndefined();
  });
});
