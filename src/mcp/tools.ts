/**
 * @module mcp/tools
 * Registry of MCP tools NexusFlow exposes to AI assistants. Each tool declares
 * its schema, MCP annotations, an optional `enabled` predicate, and a handler.
 * `server.ts` lists the enabled tools and dispatches calls to their handlers,
 * so adding a tool means adding one entry here.
 */

import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { NexusFlowConfig } from '../types.js';
import { loadFeatureConfig, isolateWorkspaceRepo } from '../core/workspace.js';
import { resolveFeatureRepoPath } from '../utils/feature.js';
import { syncWorkspace } from '../core/sync.js';
import { getWorkspaceStatusReport } from '../core/status.js';
import { getWorkspaceDiffReport } from '../core/diff.js';
import { commitWorkspace } from '../core/commit.js';
import { refreshWorkspace } from '../core/refresh.js';
import { runDoctor } from '../core/doctor.js';
import { finishWorkspace } from '../core/finish.js';
import {
  addWorkspaceKnowledge,
  addBaseKnowledge,
  promoteKnowledge,
  type KnowledgeEntryType,
  type ParsedKnowledgeEntry,
} from '../core/knowledge.js';

/** Context passed to every tool handler. `workspacePath` is already resolved and validated. */
export interface ToolContext {
  config: NexusFlowConfig;
  workspacePath: string;
}

/** MCP tool call result. */
export interface ToolResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

/** MCP tool annotations (hints only; clients may ignore them). */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A single registered MCP tool. */
export interface NexusFlowTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  /** When present, the tool is only listed/callable if this returns true. */
  enabled?: (config: NexusFlowConfig) => boolean;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ─── Result helpers ─────────────────────────────────────────────────────────

function text(t: string): ToolResult {
  return { content: [{ type: 'text', text: t }] };
}
function json(value: unknown): ToolResult {
  return text(JSON.stringify(value, null, 2));
}
function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Shared `workspaceId` schema property. */
const workspaceIdProp = {
  workspaceId: {
    type: 'string',
    description: 'Optional ID/branchName of the workspace. If omitted, uses the currently active workspace.',
  },
} as const;

async function requireWorkspace(ctx: ToolContext): Promise<void> {
  const feature = await loadFeatureConfig(ctx.workspacePath);
  if (!feature) {
    throw new Error(
      `Workspace not found at ${ctx.workspacePath}. Make sure you are in a NexusFlow workspace or provide a valid workspaceId.`,
    );
  }
}

// ─── Tools ──────────────────────────────────────────────────────────────────

export const tools: NexusFlowTool[] = [
  {
    name: 'search_workspace',
    description:
      'Search for a string or regex across all repositories in the NexusFlow workspace. Extremely fast and useful for finding where a specific variable, function, or concept is used across microservices.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query or regular expression' },
        ...workspaceIdProp,
      },
      required: ['query'],
    },
    handler: async (args, ctx) => {
      const query = args.query as string;
      try {
        const feature = await loadFeatureConfig(ctx.workspacePath);
        if (!feature) {
          throw new Error(
            `Workspace not found at ${ctx.workspacePath}. Make sure you are in a NexusFlow workspace or provide a valid workspaceId.`,
          );
        }
        let allResults = '';
        for (const repoPath of feature.repos) {
          const repoName = path.basename(repoPath);
          const worktreePath = resolveFeatureRepoPath(feature, ctx.workspacePath, repoPath);
          try {
            await fs.access(worktreePath);
            const { stdout } = await execa('git', ['grep', '-n', '-I', query], { cwd: worktreePath, reject: false });
            if (stdout) {
              allResults += stdout.split('\n').map((line) => `[${repoName}] ${line}`).join('\n') + '\n';
            }
          } catch {
            // No match or repo missing — skip.
          }
        }
        return text(allResults || 'No results found across the workspace repositories.');
      } catch (error: any) {
        return errorResult(`Error searching workspace: ${error.message}`);
      }
    },
  },
  {
    name: 'workspace_status',
    description:
      'Report the git status of every repo in the workspace: current branch, whether it matches the feature branch, dirty files, commits ahead/behind origin, and remote URL. Read-only; use this before committing or finishing.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { ...workspaceIdProp } },
    handler: async (_args, ctx) => {
      try {
        await requireWorkspace(ctx);
        return json(await getWorkspaceStatusReport(ctx.workspacePath));
      } catch (error: any) {
        return errorResult(`Error getting workspace status: ${error.message}`);
      }
    },
  },
  {
    name: 'get_workspace_diff',
    description:
      'Summarize uncommitted changes and unpushed commits across the workspace repos (files changed, insertions/deletions, commits ahead of origin). Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        repos: { type: 'array', items: { type: 'string' }, description: 'Optional list of repo names to restrict the diff to.' },
        ...workspaceIdProp,
      },
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const repos = Array.isArray(args.repos) ? (args.repos as string[]) : undefined;
        return json(await getWorkspaceDiffReport(ctx.workspacePath, repos));
      } catch (error: any) {
        return errorResult(`Error getting workspace diff: ${error.message}`);
      }
    },
  },
  {
    name: 'commit_workspace',
    description:
      'Stage, commit, and (unless noPush) push all repos that have changes, using one commit message. Returns a per-repo report. This writes to git history and pushes to the remote.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message applied to every changed repo.' },
        noPush: { type: 'boolean', description: 'Commit but do not push. Default false.' },
        repos: { type: 'array', items: { type: 'string' }, description: 'Optional list of repo names to restrict the commit to.' },
        ...workspaceIdProp,
      },
      required: ['message'],
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const message = String(args.message ?? '').trim();
        if (!message) return errorResult('A commit message is required.');
        const repos = Array.isArray(args.repos) ? (args.repos as string[]) : undefined;
        return json(await commitWorkspace(ctx.workspacePath, message, { noPush: Boolean(args.noPush), repos }));
      } catch (error: any) {
        return errorResult(`Error committing workspace: ${error.message}`);
      }
    },
  },
  {
    name: 'sync_workspace',
    description:
      'Rebase every repository in the NexusFlow workspace onto its base branch. Safe to call non-interactively: dirty working trees are auto-stashed and restored, so a dirty tree is never mis-reported as a conflict. Returns structured per-repo results (status: up-to-date | rebased | conflict | stash-conflict | error) and records them to the workspace state file.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: 'object', properties: { ...workspaceIdProp } },
    handler: async (_args, ctx) => {
      try {
        await requireWorkspace(ctx);
        return json(await syncWorkspace(ctx.workspacePath));
      } catch (error: any) {
        return errorResult(`Error syncing workspace: ${error.message}`);
      }
    },
  },
  {
    name: 'refresh_context',
    description:
      'Regenerate the workspace context files and plan. Only re-analyzes repos whose content changed, and after a NexusFlow upgrade. Run this after code changes so the AI context stays current.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: 'Ignore the analysis cache and re-analyze every repo.' },
        ...workspaceIdProp,
      },
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        return json(
          await refreshWorkspace(ctx.workspacePath, { force: Boolean(args.force) }),
        );
      } catch (error: any) {
        return errorResult(`Error refreshing context: ${error.message}`);
      }
    },
  },
  {
    name: 'run_doctor',
    description:
      'Run workspace health diagnostics: worktree paths, branch alignment, uncommitted changes, local package setup, test commands, and core artifacts. Returns a structured report. Read-only.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { ...workspaceIdProp } },
    handler: async (_args, ctx) => {
      try {
        await requireWorkspace(ctx);
        return json(await runDoctor(ctx.workspacePath));
      } catch (error: any) {
        return errorResult(`Error running doctor: ${error.message}`);
      }
    },
  },
  {
    name: 'add_knowledge',
    description:
      'Record a learning in the workspace knowledge file (or a repo base file with `repo`). Use this whenever you make an architecture decision, discover a gotcha, complete a milestone, or note an assumption — it is the preferred way to persist learnings instead of editing nexusflow-knowledge.md directly.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['decision', 'gotcha', 'progress', 'assumption', 'question'], description: 'The kind of learning.' },
        message: { type: 'string', description: 'The learning to record.' },
        title: { type: 'string', description: 'Short title (used for decision headings).' },
        repo: { type: 'string', description: "Write to this repo's persistent base knowledge instead of the workspace file (decision/gotcha/assumption only)." },
        ...workspaceIdProp,
      },
      required: ['type', 'message'],
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const type = args.type as KnowledgeEntryType;
        const message = String(args.message ?? '').trim();
        if (!message) return errorResult('A knowledge message is required.');
        const entry = { type, message, title: args.title ? String(args.title) : undefined };
        const result = args.repo
          ? await addBaseKnowledge(ctx.workspacePath, String(args.repo), entry)
          : await addWorkspaceKnowledge(ctx.workspacePath, entry);
        return json(result);
      } catch (error: any) {
        return errorResult(`Error adding knowledge: ${error.message}`);
      }
    },
  },
  {
    name: 'promote_knowledge',
    description:
      "Promote a reusable learning into a repo's persistent base knowledge so it survives across features. Provide the repo, the entry type (decision | gotcha | assumption), and the text.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string', description: 'Target repository (by directory name).' },
        type: { type: 'string', enum: ['decision', 'gotcha', 'assumption'], description: 'The kind of learning to promote.' },
        text: { type: 'string', description: 'The learning text to store in base knowledge.' },
        move: { type: 'boolean', description: 'Reserved; base promotion is additive. Default false.' },
        ...workspaceIdProp,
      },
      required: ['repo', 'type', 'text'],
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const type = args.type as KnowledgeEntryType;
        const textValue = String(args.text ?? '').trim();
        if (!textValue) return errorResult('The learning text is required.');
        // This is a new entry, not the promotion of an existing one, so it goes
        // through the capped writer. Routing it via `promoteKnowledge` stored it
        // verbatim — undated, unformatted, and past the length limit, since that
        // function deliberately preserves the markdown of entries already on
        // disk and cannot tell fabricated input from a parsed line.
        const result = await addBaseKnowledge(ctx.workspacePath, String(args.repo), {
          type,
          message: textValue,
        });
        return json(result);
      } catch (error: any) {
        return errorResult(`Error promoting knowledge: ${error.message}`);
      }
    },
  },
  {
    name: 'finish_workspace',
    description:
      'Finish the feature: commit any remaining changes (with the given message), push every repo, and return per-repo PR/compare links. Does NOT delete anything — to remove the workspace, the user runs `nexusflow finish --cleanup` from outside it.',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Commit message for any remaining changes.' },
        skipPush: { type: 'boolean', description: 'Commit but do not push. Default false.' },
        ...workspaceIdProp,
      },
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const report = await finishWorkspace(ctx.workspacePath, {
          message: args.message ? String(args.message) : undefined,
          skipPush: Boolean(args.skipPush),
          createPrs: true,
        });
        // MCP never deletes worktrees (an agent's CWD is usually inside the
        // workspace). Point the user at the CLI for cleanup instead.
        return json({
          ...report,
          note: report.safeToCleanup
            ? 'Workspace is fully pushed. To remove it, run `nexusflow finish --cleanup` from outside the workspace.'
            : 'Some repos are still dirty or unpushed — see the per-repo report.',
        });
      } catch (error: any) {
        return errorResult(`Error finishing workspace: ${error.message}`);
      }
    },
  },
  {
    name: 'get_service_logs',
    description: 'Get the recent logs for a specific running service in the workspace to debug runtime issues.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        serviceName: { type: 'string', description: 'The name of the service to fetch logs for (e.g. "frontend", "backend-api")' },
        lines: { type: 'number', description: 'Number of lines to fetch. Default 50.' },
        ...workspaceIdProp,
      },
      required: ['serviceName'],
    },
    handler: async (args, ctx) => {
      const serviceName = args.serviceName as string;
      const lines = (args.lines as number) || 50;
      try {
        const logFilePath = path.join(ctx.workspacePath, '.nexusflow-logs', `${serviceName}.log`);
        try {
          await fs.access(logFilePath);
        } catch {
          return errorResult(`Log file for service "${serviceName}" not found. Ensure the service is running via "nexusflow start".`);
        }
        const content = await fs.readFile(logFilePath, 'utf8');
        const tail = content.split('\n').slice(-lines).join('\n');
        return text(tail || '(empty log)');
      } catch (error: any) {
        return errorResult(`Error reading logs: ${error.message}`);
      }
    },
  },
  {
    name: 'isolate_repo',
    description:
      'Dynamically isolate a repository in an in-place workspace into a dedicated worktree before writing code. This creates a dedicated feature branch and worktree directory so the repository default/main branch remains clean and untouched.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        repo: {
          type: 'string',
          description: 'Name or path of the repository to isolate.',
        },
        branchName: {
          type: 'string',
          description: 'Optional feature branch name to create/checkout. Defaults to feat/<repo>-<workspaceId>.',
        },
        baseBranch: {
          type: 'string',
          description: 'Optional base branch to branch off. Defaults to repository default branch.',
        },
        ...workspaceIdProp,
      },
      required: ['repo'],
    },
    handler: async (args, ctx) => {
      try {
        await requireWorkspace(ctx);
        const repoName = String(args.repo || '').trim();
        if (!repoName) return errorResult('Repository name is required.');
        const result = await isolateWorkspaceRepo(ctx.workspacePath, repoName, {
          branchName: args.branchName ? String(args.branchName) : undefined,
          baseBranch: args.baseBranch ? String(args.baseBranch) : undefined,
        });
        return json(result);
      } catch (error: any) {
        return errorResult(`Error isolating repository: ${error.message}`);
      }
    },
  }
];

/** Returns the tools enabled for the given config. */
export function enabledTools(config: NexusFlowConfig): NexusFlowTool[] {
  return tools.filter((t) => !t.enabled || t.enabled(config));
}

/** Finds a tool by name (regardless of enabled state). */
export function findTool(name: string): NexusFlowTool | undefined {
  return tools.find((t) => t.name === name);
}
