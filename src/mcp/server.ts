import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadConfig } from '../core/config.js';
import type { NexusFlowConfig } from '../types.js';
import { enabledTools, findTool, isAgentRole, type AgentRole, type ToolContext } from './tools.js';

export interface McpServerOptions {
  workspacePath?: string;
  role?: string;
  allowList?: string[];
  denyList?: string[];
}

export function resolveMcpExecutionRole(role: string | undefined): AgentRole {
  if (role === undefined) return 'readonly';
  if (!isAgentRole(role)) throw new Error(`Invalid MCP execution role: ${role}`);
  return role;
}

/**
 * Resolves the workspace path for a tool call.
 *
 * Precedence: an explicit `startMcpServer` argument, then `args.workspaceId`
 * under `config.workspacesDir`, then the current working directory. A
 * `workspaceId` that resolves outside `workspacesDir` (via `..` or an absolute
 * path) is rejected — the HTTP server has this guard; the MCP server did not.
 */
export async function resolveMcpWorkspacePath(
  explicit: string | undefined,
  config: NexusFlowConfig,
  args: Record<string, unknown> | undefined,
): Promise<string> {
  if (explicit) return explicit;

  if (args && typeof args.workspaceId === 'string' && args.workspaceId.length > 0) {
    const base = path.resolve(config.workspacesDir);
    const resolved = path.resolve(base, args.workspaceId);
    const rel = path.relative(base, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Invalid workspaceId "${args.workspaceId}": resolves outside the workspaces directory.`);
    }
    const [canonicalBase, canonicalWorkspace] = await Promise.all([
      fs.realpath(base),
      fs.realpath(resolved),
    ]);
    const canonicalRel = path.relative(canonicalBase, canonicalWorkspace);
    if (canonicalRel === '' || canonicalRel.startsWith('..') || path.isAbsolute(canonicalRel)) {
      throw new Error(`Invalid workspaceId "${args.workspaceId}": resolves outside the workspaces directory through a linked path.`);
    }
    return canonicalWorkspace;
  }

  return process.cwd();
}

export async function startMcpServer(optionsOrWorkspacePath?: string | McpServerOptions) {
  const options: McpServerOptions = typeof optionsOrWorkspacePath === 'string'
    ? { workspacePath: optionsOrWorkspacePath }
    : optionsOrWorkspacePath ?? {};

  const { workspacePath, allowList, denyList } = options;
  const role = resolveMcpExecutionRole(options.role);

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
      tools: enabledTools(config, role, allowList, denyList).map((t) => ({
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

    const available = enabledTools(config, role, allowList, denyList);
    const tool = available.find((t) => t.name === name);
    if (!tool) {
      return {
        content: [{ type: 'text', text: `Tool not found or denied by execution policy: ${name}` }],
        isError: true,
      };
    }

    let resolvedWorkspacePath: string;
    try {
      resolvedWorkspacePath = await resolveMcpWorkspacePath(workspacePath, config, args as Record<string, unknown> | undefined);
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
