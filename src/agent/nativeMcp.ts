/**
 * @module agent/nativeMcp
 * Gives the SDK-backed native agents an MCP client.
 *
 * Native agents (OpenAI, Gemini, xAI) expose exactly two workspace tools, so a
 * workspace generated for one of them wrote an `.mcp.json` that nothing in the
 * product ever read: the tools were absent, not merely inconvenient. External
 * harnesses get MCP because they bring their own client; a native provider has
 * none, so the bridge has to exist here.
 *
 * The bridge is deliberately small and fail-soft. A missing config, an
 * unlaunchable server, or a server that dies mid-session degrades to "no MCP
 * tools" rather than failing the conversation, because the native agents' whole
 * purpose is to work without a working MCP server.
 *
 * A connection owns a spawned server process, so it must be closed. Connecting
 * per turn leaks one process per turn; callers hold one connection for the
 * session and close it when the session ends.
 */

import fs from 'node:fs';
import fse from 'fs-extra';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { HarnessManifest } from '../harness/manifest.js';

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema?: Record<string, unknown>;
  call(args: Record<string, unknown>): Promise<string>;
}

export interface McpBridgeOptions {
  /** Workspace root to read config from. */
  cwd: string;
  /** Harness whose declared MCP configs are candidates. */
  harness?: HarnessManifest;
  /** Test seam: builds the transport for a server config. */
  createTransport?: (server: { command: string; args: string[]; env?: Record<string, string> }) => StdioClientTransport;
  /** Notified when the server could not be reached, for surfacing in the UI. */
  onProblem?: (message: string) => void;
  /**
   * Test seam for the MCP client. Production builds the real one; a test needs
   * to stand in for a server process without spawning one.
   */
  createClient?: () => McpClient;
}

/** A live MCP connection. `close` is required: the client owns a child process. */
export interface McpConnection {
  tools: McpTool[];
  close(): Promise<void>;
}

/** The slice of the MCP client this bridge uses. */
export interface McpClient {
  connect(transport: unknown): Promise<void>;
  listTools(): Promise<{ tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> }>;
  callTool(request: { name: string; arguments: Record<string, unknown> }): Promise<{ content?: unknown; structuredContent?: unknown }>;
  close(): Promise<void>;
}

type ServerConfig = { command: string; args?: string[]; env?: Record<string, string> };

/** Read the first declared MCP config the workspace has, in manifest order. */
async function readServerConfig(cwd: string, harness?: HarnessManifest): Promise<ServerConfig | undefined> {
  const candidates = harness?.mcp?.map((target) => target.path) ?? ['.mcp.json'];
  for (const relative of candidates) {
    const file = path.join(cwd, relative);
    try {
      if (!await fse.pathExists(file)) continue;
      const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8')) as Record<string, Record<string, ServerConfig>>;
      const servers = parsed.mcpServers ?? parsed.servers ?? {};
      // Prefer a local CLI entry over anything fetched at runtime: this is the
      // same reason the workspace writer refuses `npx`.
      const entries = Object.entries(servers);
      const chosen = entries.find(([, server]) => server.command && !/^npx$/.test(server.command)) ?? entries[0];
      if (chosen?.[1]?.command) {
        return { command: chosen[1].command, args: chosen[1].args ?? [], env: chosen[1].env };
      }
    } catch {
      // Malformed config is not this bridge's problem to report; the workspace
      // check owns that.
    }
  }
  return undefined;
}

/**
 * Connect to the workspace MCP server and describe its tools.
 *
 * Returns an empty connection when there is nothing to reach. The caller owns
 * the connection and must close it: closing is what terminates the spawned
 * server, so a caller that opens per turn leaks a process per turn.
 */
export async function openWorkspaceMcp(options: McpBridgeOptions): Promise<McpConnection> {
  const server = await readServerConfig(options.cwd, options.harness);
  if (!server) return { tools: [], close: async () => {} };

  const client = options.createClient?.() ??
    (new Client({ name: 'nexusflow-native', version: '1' }, { capabilities: {} }) as unknown as McpClient);
  try {
    const createTransport = options.createTransport ?? ((config: { command: string; args: string[]; env?: Record<string, string> }) =>
      new StdioClientTransport({
        command: config.command,
        args: config.args,
        ...(config.env ? { env: { ...process.env, ...config.env } as Record<string, string> } : {}),
      }));
    await client.connect(createTransport({ command: server.command, args: server.args ?? [], env: server.env }));
    const listed = await client.listTools();
    const tools = (listed.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema as Record<string, unknown> } : {}),
      call: async (args: Record<string, unknown>) => {
        try {
          const result = await client.callTool({ name: tool.name, arguments: args });
          const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
          const text = content
            .filter((part) => part.type === 'text')
            .map((part) => part.text ?? '')
            .join('\\n');
          return text || JSON.stringify(result.structuredContent ?? null);
        } catch (error) {
          return `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      },
    }));
    return {
      tools,
      close: async () => {
        try {
          await client.close();
        } catch {
          // A server that already died has nothing left to tear down.
        }
      },
    };
  } catch (error) {
    options.onProblem?.(`MCP server unavailable: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await client.close();
    } catch {
      // Nothing useful to do if closing a failed connection throws.
    }
    return { tools: [], close: async () => {} };
  }
}

/** The function schema an MCP tool is offered to a chat-completions model as. */
export function mcpToolSchema(tool: McpTool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: (tool.inputSchema as { type?: string; properties?: unknown; required?: unknown }) ?? {
        type: 'object',
        properties: {},
      },
    },
  };
}