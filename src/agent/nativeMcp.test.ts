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
    expect(await openWorkspaceMcp({ cwd: root })).toEqual([]);
  });

  it('exposes the configured server tools and calls them', async () => {
    await writeConfig({ 'contextspace-mcp': { command: '/bin/ctxspace', args: ['mcp', 'run'] } });
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '["repo1"]' }] });
    const connect = vi.fn().mockResolvedValue(undefined);
    const listTools = vi.fn().mockResolvedValue({
      tools: [{ name: 'list_repos', description: 'List repos', inputSchema: { type: 'object', properties: {} } }],
    });

    const tools = await openWorkspaceMcp({
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
    const tools = await openWorkspaceMcp({
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
    const tools = await openWorkspaceMcp({ cwd: root, onProblem: (message) => problems.push(message) });
    expect(tools).toEqual([]);
    expect(problems.join(' ')).toMatch(/MCP server unavailable/);
  });

  it('prefers a local command over a runtime-fetched one', async () => {
    await writeConfig({
      fetched: { command: 'npx', args: ['-y', 'some-package'] },
      local: { command: '/workspace/.contextspace/bin/ctxspace', args: ['mcp', 'run'] },
    });
    const seen: unknown[] = [];
    await openWorkspaceMcp({
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
  });
});
