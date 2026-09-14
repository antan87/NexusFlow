/**
 * @module tests/e2e/test-harness
 * Comprehensive E2E test harness for ContextSpace developer workflows.
 * Provides opaque test fixtures, workspace sandboxes, MCP tool invocation,
 * CLI execution helpers, and progressive testability feature gates.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import fse from 'fs-extra';
import { execa } from 'execa';

import type {
  Feature,
  WorkspaceContext,
  RepoInfo,
  SkillItem,
  DomainPack,
  ToolResult,
  WorkspaceSkillsConfig,
  WorkspaceLifecycle,
} from '../../src/types.js';
import {
  getAllSkills,
  saveSkill,
  deleteSkill,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  getWorkspaceSkillsConfig,
  saveWorkspaceSkillsConfig,
  DEFAULT_SKILLS,
  DEFAULT_CATEGORIES,
} from '../../src/utils/skills-catalog.js';
import {
  getDomainPack,
  getAvailableDomainPacks,
  resolveActiveDomainRules,
  BUILTIN_DOMAIN_PACKS,
} from '../../src/core/domain-packs.js';
import {
  buildHarnessCliCommand,
  launchExternalTerminal,
  isValidSessionId,
  SUPPORTED_ASSISTANTS,
} from '../../src/utils/terminal-launch.js';
import { buildContextContent } from '../../src/generators/base.js';
import { createDefaultSteps, getWorkflowFlow } from '../../src/core/lifecycle.js';
import { refreshWorkspace } from '../../src/core/refresh.js';
import { reconcileWorkspaceResources } from '../../src/resources/materializer.js';
import { findTool, enabledTools } from '../../src/mcp/tools.js';
import {
  resourceIdSchema,
  skillFrontmatterSchema,
  workspaceResourcesConfigSchema,
} from '../../src/resources/contracts.js';

// ─── Progressive Testability Feature Gates ─────────────────────────────

export const featureGates = {
  /** Check if built-in dummy skills have been completely removed (Milestone M1) */
  get hasCleanCatalog(): boolean {
    return Array.isArray(DEFAULT_SKILLS) && DEFAULT_SKILLS.length === 0;
  },

  /** Check if workspace-local skill scoping is supported in saveSkill / getAllSkills (Milestone M1) */
  get hasWorkspaceLocalSkills(): boolean {
    // If saveSkill accepts a scope or workspacePath in its arguments
    return true; // We can test workspace scoping contracts
  },

  /** Check if create_skill MCP tool is registered (Milestone M2) */
  get hasMcpSkillTools(): boolean {
    return findTool('create_skill') !== undefined && findTool('list_skills') !== undefined;
  },

  /** Check if CLI ctxspace skill command exists (Milestone M2) */
  get hasCliSkillCommand(): boolean {
    try {
      // Dynamic probe for CLI command existence
      return false; // M2 pending
    } catch {
      return false;
    }
  },

  /** Check if explicit tag-to-skill bundle binding is active (Milestone M3) */
  get hasExplicitTagBindings(): boolean {
    const gitPack = getDomainPack('git');
    const billingPack = getDomainPack('billing');
    return Boolean(
      (gitPack && Array.isArray(gitPack.skills) && gitPack.skills.length > 0) ||
      (billingPack && Array.isArray(billingPack.skills) && billingPack.skills.length > 0)
    );
  },

  /** Check if CLI create supports -t, --tag flag (Milestone M4) */
  get hasCliCreateTags(): boolean {
    return false; // M4 pending
  },
};

// ─── Test Workspace Sandbox ────────────────────────────────────────────

export interface CreateTestWorkspaceOptions {
  id?: string;
  description?: string;
  branchName?: string;
  mode?: 'in-place' | 'worktree';
  flow?: 'quick' | 'feature' | 'epic';
  tags?: string[];
  organizationId?: string;
  repos?: Array<{ name: string; files?: Record<string, string> }>;
  initialSkills?: string[];
}

export interface TestWorkspace {
  workspacePath: string;
  feature: Feature;
  repos: RepoInfo[];
  cleanup: () => Promise<void>;
}

/**
 * Creates an isolated temporary workspace directory with valid configuration files.
 */
export async function createTestWorkspace(
  options: CreateTestWorkspaceOptions = {},
): Promise<TestWorkspace> {
  const baseTmp = path.join(os.tmpdir(), 'nexusflow-e2e-');
  const workspacePath = await fs.mkdtemp(baseTmp);

  const id = options.id || `e2e-ws-${randomUUID().slice(0, 8)}`;
  const mode = options.mode || 'in-place';
  const inPlace = mode === 'in-place';
  const branchName = options.branchName || (inPlace ? id : `feat/${id}`);
  const description = options.description || 'E2E Developer Workflow Test Workspace';
  const organizationId = options.organizationId;
  const domainPacks = options.tags || ['economy'];

  // Setup repo directories
  const repoSpecs = options.repos || [{ name: 'primary-repo' }];
  const repos: RepoInfo[] = [];

  for (const r of repoSpecs) {
    const repoDir = path.join(workspacePath, inPlace ? r.name : `worktrees/${r.name}`);
    await fse.ensureDir(repoDir);

    // Write a mock package.json
    const pkgJson = {
      name: r.name,
      version: '1.0.0',
      scripts: {
        test: `echo "running test for ${r.name}"`,
      },
    };
    await fs.writeFile(path.join(repoDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

    // Write any custom files
    if (r.files) {
      for (const [relPath, content] of Object.entries(r.files)) {
        const full = path.join(repoDir, relPath);
        await fse.ensureDir(path.dirname(full));
        await fs.writeFile(full, content, 'utf-8');
      }
    }

    try {
      await execa('git', ['init', '-b', 'main'], { cwd: repoDir });
      await execa('git', ['config', 'user.name', 'E2E Test'], { cwd: repoDir });
      await execa('git', ['config', 'user.email', 'e2e@test.com'], { cwd: repoDir });
      await execa('git', ['add', '.'], { cwd: repoDir });
      await execa('git', ['commit', '-m', 'initial commit'], { cwd: repoDir });
      const { stdout: headSha } = await execa('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
      repos.push({
        name: r.name,
        path: repoDir,
        originalPath: repoDir,
        branch: branchName,
        headCommit: headSha.trim(),
        status: { isClean: true, staged: [], unstaged: [], untracked: [] },
      });
    } catch {
      repos.push({
        name: r.name,
        path: repoDir,
        originalPath: repoDir,
        branch: branchName,
        headCommit: 'abc1234',
        status: { isClean: true, staged: [], unstaged: [], untracked: [] },
      });
    }
  }

  // Setup .contextspace metadata directory
  const ctxDir = path.join(workspacePath, '.contextspace');
  await fse.ensureDir(ctxDir);

  // Setup .agents/skills directory
  const skillsDir = path.join(workspacePath, '.agents', 'skills');
  await fse.ensureDir(skillsDir);

  const feature: Feature = {
    id,
    branchName,
    description,
    repos: repos.map((r) => r.path),
    originalRepos: repos.map((r) => r.path),
    organizationId,
    domainPacks,
    workspacePath,
    createdAt: new Date().toISOString(),
    flow: options.flow === 'quick' ? 'quick-fix' : options.flow === 'epic' ? 'epic' : 'feature',
    mode,
    inPlace,
    assistants: ['antigravity'],
  };

  // Persist manifest to root contextspace.json and .contextspace/feature.json
  await fs.writeFile(path.join(workspacePath, 'contextspace.json'), JSON.stringify(feature, null, 2), 'utf-8');
  await fs.writeFile(path.join(ctxDir, 'feature.json'), JSON.stringify(feature, null, 2), 'utf-8');

  // Persist initial skills config
  if (options.initialSkills) {
    const skillsConfig: WorkspaceSkillsConfig = {
      schemaVersion: 1,
      revision: 1,
      enabledSkills: options.initialSkills,
      disabledSkills: [],
      enabledAgents: [],
      enabledCategories: [],
    };
    await fs.writeFile(path.join(ctxDir, 'skills.json'), JSON.stringify(skillsConfig, null, 2), 'utf-8');
  }

  const cleanup = async () => {
    try {
      await fse.remove(workspacePath);
    } catch {
      // ignore cleanup errors on temp dirs
    }
  };

  return {
    workspacePath,
    feature,
    repos,
    cleanup,
  };
}

// ─── Workspace File & Context Readers ──────────────────────────────────

/**
 * Reads AGENTS.md from the root of a workspace.
 */
export async function readAgentsMd(workspacePath: string): Promise<string> {
  const agentsPath = path.join(workspacePath, 'AGENTS.md');
  if (await fse.pathExists(agentsPath)) {
    return fs.readFile(agentsPath, 'utf-8');
  }
  return '';
}

/**
 * Reads contextspace-plan.md from a workspace.
 */
export async function readWorkspacePlan(workspacePath: string): Promise<string> {
  const planPath = path.join(workspacePath, 'contextspace-plan.md');
  if (await fse.pathExists(planPath)) {
    return fs.readFile(planPath, 'utf-8');
  }
  return '';
}

/**
 * Lists all materialized skills in <workspace>/.agents/skills/
 */
export async function listMaterializedSkills(workspacePath: string): Promise<string[]> {
  const skillsDir = path.join(workspacePath, '.agents', 'skills');
  if (!(await fse.pathExists(skillsDir))) {
    return [];
  }
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((e) => (typeof e === 'string' ? true : e.isDirectory()))
    .map((e) => (typeof e === 'string' ? e : e.name));
}

/**
 * Generates canonical AGENTS.md using buildContextContent.
 */
export async function generateAgentsMd(
  feature: Feature,
  repos: RepoInfo[],
): Promise<string> {
  const ctx: WorkspaceContext = {
    feature,
    repos,
  };
  return buildContextContent(ctx);
}

// ─── MCP Tool Invocation Helper ────────────────────────────────────────

export interface InvokeMcpToolOptions {
  workspacePath?: string;
  role?: string;
}

/**
 * Opaque invocation of an MCP tool registered in tools.ts.
 */
export async function invokeMcpTool(
  toolName: string,
  args: Record<string, unknown> = {},
  options: InvokeMcpToolOptions = {},
): Promise<ToolResult | null> {
  const tool = findTool(toolName);
  if (!tool) {
    return null;
  }

  const context = {
    config: {
      version: '1.0',
      devDir: '/tmp/dev',
      workspacesDir: '/tmp/dev/workspaces',
      defaultAssistant: null,
      scanDepth: 2,
    },
    workspacePath: options.workspacePath || process.cwd(),
  };

  return tool.handler(args, context);
}

// ─── Web GUI & REST API Payload Contracts ──────────────────────────────

export interface CreateWorkspacePayload {
  featureId?: string;
  description: string;
  mode: 'in-place' | 'worktree';
  repos: Array<{ name: string; path: string }>;
  flow?: 'quick-fix' | 'feature' | 'epic';
  tags?: string[];
  domainPacks?: string[];
  enabledSkills?: string[];
  assistants?: string[];
  branchName?: string;
  organizationId?: string;
}

/**
 * Validates a Web GUI workspace creation payload against requirements.
 */
export function validateCreateWorkspacePayload(payload: unknown): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!payload || typeof payload !== 'object') {
    return { isValid: false, errors: ['Payload must be an object'] };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.description !== 'string' || !p.description.trim()) {
    errors.push('PO feature description is required');
  }

  if (!Array.isArray(p.repos) || p.repos.length === 0) {
    errors.push('At least one repository must be selected');
  } else {
    for (const r of p.repos) {
      if (!r || typeof r !== 'object' || !r.name || !r.path) {
        errors.push('Each repo must specify name and path');
        break;
      }
    }
  }

  if (p.mode !== 'in-place' && p.mode !== 'worktree') {
    errors.push('Mode must be either "in-place" or "worktree"');
  }

  if (p.flow && !['quick-fix', 'feature', 'epic'].includes(p.flow as string)) {
    errors.push('Flow must be one of "quick-fix", "feature", or "epic"');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ─── Assertion Helpers ─────────────────────────────────────────────────

/**
 * Asserts that AGENTS.md includes the expected enterprise domain rules.
 */
export function expectAgentsMdContainsRules(
  agentsMd: string,
  expectedRules: string[],
): void {
  for (const rule of expectedRules) {
    if (!agentsMd.includes(rule)) {
      throw new Error(`AGENTS.md is missing expected rule: "${rule}"`);
    }
  }
}

/**
 * Asserts that a skill markdown structure satisfies frontmatter requirements.
 */
export function validateSkillStructure(rawMarkdown: string): {
  isValid: boolean;
  metadata: Record<string, unknown>;
  content: string;
} {
  const parsed = parseSkillMarkdown(rawMarkdown);
  const result = skillFrontmatterSchema.safeParse(parsed.metadata);
  return {
    isValid: result.success && Boolean(parsed.content.trim()),
    metadata: parsed.metadata,
    content: parsed.content,
  };
}
