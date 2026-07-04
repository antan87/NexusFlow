import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as path from 'node:path';

import { loadConfig } from '../core/config.js';
import type { NexusFlowConfig } from '../types.js';
import { enabledTools, findTool, type ToolContext } from './tools.js';

/**
 * Resolves the workspace path for a tool call.
 *
 * Precedence: an explicit `startMcpServer` argument, then `args.workspaceId`
 * under `config.workspacesDir`, then the current working directory. A
 * `workspaceId` that resolves outside `workspacesDir` (via `..` or an absolute
 * path) is rejected — the HTTP server has this guard; the MCP server did not.
 */
function resolveWorkspacePath(
  explicit: string | undefined,
  config: NexusFlowConfig,
  args: Record<string, unknown> | undefined,
): string {
  if (explicit) return explicit;

  if (args && typeof args.workspaceId === 'string' && args.workspaceId.length > 0) {
    const base = path.resolve(config.workspacesDir);
    const resolved = path.resolve(base, args.workspaceId);
    const rel = path.relative(base, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Invalid workspaceId "${args.workspaceId}": resolves outside the workspaces directory.`);
    }
    return resolved;
  }

  return process.cwd();
}

export async function startMcpServer(workspacePath?: string) {
  const server = new Server(
    {
      name: 'nexusflow-mcp',
      version: '0.2.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const config = await loadConfig();
    return {
      tools: enabledTools(config).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      })),
    };
  });

  // Return type is annotated `any` because the SDK's ServerResult union now
  // includes a task-augmented variant; a plain `{ content, isError }` result is
  // valid but does not narrow cleanly against it.
  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
    const { name, arguments: args } = request.params;
    const config = await loadConfig();

    const tool = findTool(name);
    if (!tool || (tool.enabled && !tool.enabled(config))) {
      return {
        content: [{ type: 'text', text: `Tool not found: ${name}` }],
        isError: true,
      };
    }

    let resolvedWorkspacePath: string;
    try {
      resolvedWorkspacePath = resolveWorkspacePath(workspacePath, config, args as Record<string, unknown> | undefined);
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: error.message }],
        isError: true,
      };
    }

    const ctx: ToolContext = { config, workspacePath: resolvedWorkspacePath };
    return tool.handler((args ?? {}) as Record<string, unknown>, ctx);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
