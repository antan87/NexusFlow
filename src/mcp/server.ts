import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { loadConfig } from '../core/config.js';
import { loadFeatureConfig } from '../core/workspace.js';

export async function startMcpServer(workspacePath?: string) {
  const server = new Server(
    {
      name: 'nexusflow-mcp',
      version: '0.1.2',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_workspace',
          description: 'Search for a string or regex across all repositories in the NexusFlow workspace. Extremely fast and useful for finding where a specific variable, function, or concept is used across microservices.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'The search query or regular expression',
              },
              workspaceId: {
                type: 'string',
                description: 'Optional ID/branchName of the workspace to search. If omitted, uses the currently active workspace.',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_service_logs',
          description: 'Get the recent logs for a specific running service in the workspace to debug runtime issues.',
          inputSchema: {
            type: 'object',
            properties: {
              serviceName: {
                type: 'string',
                description: 'The name of the service to fetch logs for (e.g. "frontend", "backend-api")',
              },
              lines: {
                type: 'number',
                description: 'Number of lines to fetch. Default 50.',
              },
              workspaceId: {
                type: 'string',
                description: 'Optional ID/branchName of the workspace. If omitted, uses the currently active workspace.',
              },
            },
            required: ['serviceName'],
          },
        },
        {
          name: 'get_workspace_graph',
          description: 'Retrieve the structural architecture graph of the NexusFlow workspace. Contains nodes for repos, packages, API endpoints, and exposed ports, plus relation edges (CONTAINS, DEPENDS_ON, EXPOSES, CALLS). Highly token-efficient for global workspace context.',
          inputSchema: {
            type: 'object',
            properties: {
              workspaceId: {
                type: 'string',
                description: 'Optional ID/branchName of the workspace. If omitted, uses the currently active workspace.',
              },
            },
          },
        },
        {
          name: 'query_workspace_graph',
          description: 'Query the workspace architecture graph by filtering nodes or edges (e.g., node types like "repo", "package", "endpoint", "port", or edge types like "DEPENDS_ON", "EXPOSES", "CALLS"). Reduces token payload by fetching specific architectural paths.',
          inputSchema: {
            type: 'object',
            properties: {
              nodeType: {
                type: 'string',
                enum: ['repo', 'package', 'endpoint', 'port'],
                description: 'Optional node type to filter.',
              },
              edgeType: {
                type: 'string',
                enum: ['DEPENDS_ON', 'EXPOSES', 'CALLS'],
                description: 'Optional edge/relation type to filter.',
              },
              workspaceId: {
                type: 'string',
                description: 'Optional ID/branchName of the workspace. If omitted, uses the currently active workspace.',
              },
            },
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const config = await loadConfig();

    // Resolve workspace path
    let resolvedWorkspacePath = workspacePath;
    if (!resolvedWorkspacePath) {
      if (args && typeof args === 'object' && 'workspaceId' in args && typeof args.workspaceId === 'string') {
        resolvedWorkspacePath = path.join(config.workspacesDir, args.workspaceId);
      } else {
        // Fallback to CWD
        resolvedWorkspacePath = process.cwd();
      }
    }

    if (name === 'search_workspace') {
      const query = (args as any).query;
      try {
        const feature = await loadFeatureConfig(resolvedWorkspacePath);
        if (!feature) {
          throw new Error(`Workspace not found at ${resolvedWorkspacePath}. Make sure you are in a NexusFlow workspace or provide a valid workspaceId.`);
        }

        let allResults = '';
        for (const repoPath of feature.repos) {
          const repoName = path.basename(repoPath);
          const worktreePath = path.join(resolvedWorkspacePath, repoName);
          
          try {
            await fs.access(worktreePath);
            const { stdout } = await execa('git', ['grep', '-n', '-I', query], { cwd: worktreePath, reject: false });
            if (stdout) {
              const lines = stdout.split('\n').map(line => `[${repoName}] ${line}`);
              allResults += lines.join('\n') + '\n';
            }
          } catch (e: any) {
            if (e.exitCode !== 1) {
              console.error(`Error searching in ${repoName}:`, e);
            }
          }
        }

        return {
          content: [
            {
              type: 'text',
              text: allResults || 'No results found across the workspace repositories.',
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error searching workspace: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === 'get_service_logs') {
      const serviceName = (args as any).serviceName;
      const lines = (args as any).lines || 50;

      try {
        const logFilePath = path.join(resolvedWorkspacePath, '.nexusflow-logs', `${serviceName}.log`);
        
        try {
          await fs.access(logFilePath);
        } catch {
          return {
            content: [
              {
                type: 'text',
                text: `Log file for service "${serviceName}" not found. Ensure the service is running via "nexusflow start".`,
              },
            ],
            isError: true,
          };
        }

        const content = await fs.readFile(logFilePath, 'utf8');
        const logLines = content.split('\n');
        const tail = logLines.slice(-lines).join('\n');

        return {
          content: [
            {
              type: 'text',
              text: tail || '(empty log)',
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error reading logs: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    if (name === 'get_workspace_graph') {
      return {
        content: [
          {
            type: 'text',
            text: 'This tool has been deprecated. Use nexusflow-plan.md for dependency information.',
          },
        ],
      };
    }

    if (name === 'query_workspace_graph') {
      return {
        content: [
          {
            type: 'text',
            text: 'This tool has been deprecated. Use nexusflow-plan.md for dependency information.',
          },
        ],
      };
    }

    throw new Error(`Tool not found: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
