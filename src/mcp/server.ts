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
import { callLocalLlm } from '../utils/local-ai.js';

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
    const config = await loadConfig();
    const tools: any[] = [
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
    ];

    if (config.localLlm?.enabled) {
      tools.push({
        name: 'delegate_to_local_agent',
        description: 'Delegate simple, high-volume, or repetitive tasks (like searching code, parsing raw service logs, or generating boilerplate) to the local Small Language Model (SLM) running on the user\'s machine to save remote tokens.',
        inputSchema: {
          type: 'object',
          properties: {
            instruction: {
              type: 'string',
              description: 'The specific instruction for the local agent (e.g., "Scan the last 50 lines of logs and explain the database error").',
            },
            filesToRead: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional list of workspace-relative file paths or log files that the local agent should read and use as context.',
            },
          },
          required: ['instruction'],
        },
      });
    }

    return { tools };
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

    if (name === 'delegate_to_local_agent') {
      const instruction = (args as any).instruction;
      const filesToRead = (args as any).filesToRead || [];

      try {
        if (!config.localLlm || !config.localLlm.enabled) {
          throw new Error('Local AI agent delegation is disabled. Enable it in ~/.nexusflow/config.json or settings.');
        }

        const contextFiles: { path: string; content: string }[] = [];
        const normalizedWorkspace = resolvedWorkspacePath.endsWith(path.sep)
          ? resolvedWorkspacePath
          : resolvedWorkspacePath + path.sep;

        for (const relativePath of filesToRead) {
          const filePath = path.resolve(resolvedWorkspacePath, relativePath);
          
          if (!filePath.startsWith(normalizedWorkspace)) {
            contextFiles.push({
              path: relativePath,
              content: '[Access denied: path is outside workspace boundary]',
            });
            continue;
          }

          try {
            const content = await fs.readFile(filePath, 'utf-8');
            // Truncate file content if it's too large to prevent overloading local SLM
            const truncatedContent = content.length > 50000
              ? content.substring(0, 50000) + '\n\n[Content truncated by NexusFlow to save local context size...]'
              : content;

            contextFiles.push({
              path: relativePath,
              content: truncatedContent,
            });
          } catch (e: any) {
            contextFiles.push({
              path: relativePath,
              content: `[Error reading file: ${e.message || 'unknown error'}]`,
            });
          }
        }

        // Build messages
        const messages: import('../utils/local-ai.js').LocalLlmMessage[] = [];
        let systemPrompt = 'You are the NexusFlow local assistant. You are running locally on the user\'s machine to help the remote supervisor agent solve a specific sub-task in a multi-repo workspace.\n';
        systemPrompt += 'Your goal is to be extremely precise, concise, and return only the distilled findings/code to save remote network tokens. Keep your response short, focused, and directly address the instruction.';

        messages.push({ role: 'system', content: systemPrompt });

        let userPrompt = '';
        if (contextFiles.length > 0) {
          userPrompt += 'Here is the local file/log context:\n\n';
          for (const file of contextFiles) {
            userPrompt += `--- FILE: ${file.path} ---\n${file.content}\n\n`;
          }
        }
        userPrompt += `Instruction: ${instruction}`;
        messages.push({ role: 'user', content: userPrompt });

        const result = await callLocalLlm(config.localLlm, messages);

        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Error delegating to local agent: ${error.message}`,
            },
          ],
          isError: true,
        };
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
            // Ignore error or exitCode 1 (no match)
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

    // Unknown tool
    throw new Error(`Tool not found: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
