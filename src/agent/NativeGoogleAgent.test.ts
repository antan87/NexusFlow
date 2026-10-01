import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Gemini agent is the last native provider that was still ignoring the
 * workspace MCP config. It speaks a different call shape from the
 * OpenAI-compatible agents — `functionDeclarations` with upper-cased schema
 * types, and `functionCall`/`functionResponse` parts — so it is covered here
 * rather than assumed from the other two.
 */

interface StreamChunk {
  text?: string;
  functionCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
}

let requests: Array<{ model: string; config: Record<string, any> }>;
let contentsAtRequest: Array<Array<{ role: string; parts: unknown[] }>>;
let chunks: StreamChunk[];

beforeEach(() => {
  requests = [];
  contentsAtRequest = [];
  chunks = [];
  process.env.GEMINI_API_KEY = 'gemini-test';
  vi.resetModules();
  vi.doMock('@google/genai', () => ({
    GoogleGenAI: class {
      models = {
        // The real call is a single argument: { model, contents, config }.
        generateContentStream: vi.fn(async (request: any) => {
          requests.push({ model: request.model, config: request.config });
          contentsAtRequest.push(structuredClone(request.contents));
          return (async function* () {
            for (const chunk of chunks) yield chunk;
          })();
        }),
      };
      constructor(public options: Record<string, unknown>) {}
    },
  }));
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
  vi.doUnmock('@google/genai');
  vi.resetModules();
});

/** Drive one turn and return the declaration names the model was offered. */
async function runTurn(turn: StreamChunk[], env: Record<string, string> = {}) {
  Object.assign(process.env, env);
  const { NativeGoogleAgent } = await import('./NativeGoogleAgent.js');
  const agent = new NativeGoogleAgent();
  const text: string[] = [];
  agent.on('data', (chunk: unknown) => text.push(String(chunk)));
  agent.on('error', () => {});
  chunks = turn;
  await agent.start('/tmp/ws');
  await agent.send('hi');
  const declarations = requests[0]!.config.tools[0].functionDeclarations as Array<{ name: string; parameters: unknown }>;
  return { declarations, history: (agent as unknown as { history: unknown[] }).history, text, agent };
}

describe('NativeGoogleAgent', () => {
  it('offers the native tools and the configured model', async () => {
    const { declarations } = await runTurn([{ text: 'hello' }]);
    expect(declarations.map((d) => d.name)).toEqual(['read_file', 'list_directory']);
    expect(requests[0]!.model).toBe('gemini-2.0-flash');
  });

  it('prefers the model chosen in chat settings over the environment', async () => {
    const { NativeGoogleAgent } = await import('./NativeGoogleAgent.js');
    const agent = new NativeGoogleAgent();
    agent.on('data', () => {});
    agent.on('error', () => {});
    process.env.GEMINI_MODEL = 'gemini-3.1-pro';
    chunks = [{ text: 'ok' }];
    await agent.start('/tmp/ws', { id: 's1', provider: 'google-native', model: 'gemini-3.8-flash' } as never);
    await agent.send('hi');
    expect(requests[0]!.model).toBe('gemini-3.8-flash');
  });

  it('adds workspace MCP tools, converted to Gemini schema types', async () => {
    // A native provider has no MCP client of its own, so a generated
    // `.mcp.json` is only reachable through the bridge.
    const connection = {
      tools: [{
        name: 'list_repos',
        description: 'List repos',
        inputSchema: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] },
        call: vi.fn(),
      }],
    };
    const { NativeGoogleAgent } = await import('./NativeGoogleAgent.js');
    const agent = new NativeGoogleAgent();
    agent.on('data', () => {});
    agent.on('error', () => {});
    (agent as unknown as { mcpTools(): Promise<unknown[]> }).mcpTools = async () => connection.tools;
    chunks = [{ text: 'ok' }];
    await agent.start('/tmp/ws');
    await agent.send('hi');

    const declarations = requests[0]!.config.tools[0].functionDeclarations as Array<{ name: string; parameters: any }>;
    const mcp = declarations.find((d) => d.name === 'list_repos');
    expect(mcp).toBeDefined();
    // Gemini's schema types are the same vocabulary, upper-cased.
    expect(mcp!.parameters.type).toBe('OBJECT');
    expect(mcp!.parameters.properties.branch.type).toBe('STRING');
    expect(mcp!.parameters.required).toEqual(['branch']);
  });

  it('dispatches an MCP call to the server rather than to the local tools', async () => {
    const call = vi.fn().mockResolvedValue('["repo1"]');
    const { NativeGoogleAgent } = await import('./NativeGoogleAgent.js');
    const agent = new NativeGoogleAgent();
    agent.on('data', () => {});
    agent.on('error', () => {});
    (agent as unknown as { mcpTools(): Promise<unknown[]> }).mcpTools = async () => [
      { name: 'list_repos', description: 'List repos', call },
    ];
    chunks = [{ functionCalls: [{ name: 'list_repos', args: { branch: 'main' } }] }];
    await agent.start('/tmp/ws');
    await agent.send('hi');

    expect(call).toHaveBeenCalledWith({ branch: 'main' });
    const history = (agent as unknown as { history: Array<{ role: string; parts: unknown[] }> }).history;
    const responses = history.filter((entry) => entry.role === 'user').at(-1)?.parts ?? [];
    expect(responses).toContainEqual({
      functionResponse: { name: 'list_repos', response: { result: '["repo1"]' } },
    });
  });

  it('does not divert a native tool call to the MCP server', async () => {
    const mcpCall = vi.fn();
    const { NativeGoogleAgent } = await import('./NativeGoogleAgent.js');
    const agent = new NativeGoogleAgent();
    agent.on('data', () => {});
    agent.on('error', () => {});
    (agent as unknown as { mcpTools(): Promise<unknown[]> }).mcpTools = async () => [
      { name: 'list_repos', description: 'List repos', call: mcpCall },
    ];
    chunks = [{ functionCalls: [{ name: 'read_file', args: { filePath: 'README.md' } }] }];
    await agent.start('/tmp/ws');
    await agent.send('hi');

    // The name is not an MCP tool, so it must stay on the local executor. The
    // read fails because the fixture path does not exist, which is the point:
    // the error comes from the local tool, not from a server round trip.
    expect(mcpCall).not.toHaveBeenCalled();
    const history = (agent as unknown as { history: Array<{ role: string; parts: unknown[] }> }).history;
    const responses = history.filter((entry) => entry.role === 'user').at(-1)?.parts ?? [];
    const response = (responses[0] as { functionResponse: { name: string; response: { result: string } } }).functionResponse;
    expect(response.name).toBe('read_file');
    expect(response.response.result).toMatch(/^Error: ENOENT/);
  });
});
