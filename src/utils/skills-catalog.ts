/**
 * @module utils/skills-catalog
 * Manages built-in template categories, user-defined custom categories,
 * portable skills packages (SKILL.md), and workspace skills assignments.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import fse from 'fs-extra';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

import { slugify } from './slug.js';
import { acquireLock, createMutationQueue } from '../core/locks.js';
import { resolveBrandHomeDir } from '../core/constants.js';
import {
  formatValidationError,
  resourceIdSchema,
  skillCategorySchema,
  skillFrontmatterSchema,
  workspaceResourcesConfigSchema,
} from '../resources/contracts.js';
import {
  assertNoLinkedPathComponents,
  assertPathWithin,
  assertPathIsNotLink,
  atomicWriteJson,
} from '../resources/fs-safety.js';
import type {
  SkillCategory,
  SkillItem,
  SkillParameter,
  WorkspaceSkillsConfig,
} from '../types.js';

// ─── Frontmatter Helper ───────────────────────────────────────────────────

export interface ParsedFrontmatter {
  name?: string;
  title?: string;
  category?: string;
  description?: string;
  tags?: string[];
  'allowed-tools'?: string[];
  allowedTools?: string[];
  parameters?: SkillParameter[];
  model?: string;
  'permission-mode'?: 'plan' | 'default' | 'strict';
  permissionMode?: 'plan' | 'default' | 'strict';
  [key: string]: unknown;
}

/**
 * Parses YAML frontmatter delimited by `---`, handling CRLF line endings.
 */
export function parseSkillMarkdown(raw: string): { metadata: ParsedFrontmatter; content: string } {
  // Normalize CRLF to LF
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized.startsWith('---')) {
    return { metadata: {}, content: raw };
  }

  const endIndex = normalized.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { metadata: {}, content: raw };
  }

  const yamlBlock = normalized.substring(3, endIndex).trim();
  const content = normalized.substring(endIndex + 4).trim();
  let metadata: ParsedFrontmatter = {};

  try {
    const loaded = yamlLoad(yamlBlock);
    if (loaded && typeof loaded === 'object') {
      metadata = loaded as ParsedFrontmatter;
    }
  } catch (err) {
    console.error('Failed to parse YAML frontmatter:', err);
  }

  return { metadata, content };
}

/**
 * Serializes metadata and content into YAML frontmatter markdown.
 */
export function serializeSkillMarkdown(
  metadata: Record<string, unknown>,
  content: string,
): string {
  const cleanMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (v !== undefined && v !== null && v !== '') {
      cleanMeta[k] = v;
    }
  }

  const yamlString = yamlDump(cleanMeta, { lineWidth: -1 }).trim();
  return `---\n${yamlString}\n---\n\n${content.trim()}\n`;

}


// ─── Security Helpers ─────────────────────────────────────────────────────

const runCatalogMutation = createMutationQueue();
const runWorkspaceConfigMutation = createMutationQueue();

export class WorkspaceResourceRevisionError extends Error {
  constructor(expected: number, current: number) {
    super(`Workspace resource configuration changed (expected revision ${expected}, current ${current}).`);
    this.name = 'WorkspaceResourceRevisionError';
  }
}

async function withCatalogLock<T>(operation: () => Promise<T>): Promise<T> {
  return runCatalogMutation(async () => {
    const release = await acquireLock(path.join(getNexusFlowHome(), '.locks', 'resource-catalog.lock'), {
      staleMs: 60_000,
      timeoutMs: 10_000,
      timeoutMessage: 'Timed out waiting for the resource catalog lock.',
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  });
}

// ─── Default Template Categories & Skills ─────────────────────────────────

export const DEFAULT_CATEGORIES: SkillCategory[] = [
  {
    id: 'pull-requests',
    name: 'Pull Requests & Review',
    description: 'Workflows for authoring, analyzing, and reviewing pull requests and merge readiness.',
    icon: 'git-pull-request',
    color: '#3b82f6',
    custom: false,
    isTemplate: true,
    skills: ['pr-review-toolkit', 'pr-description-gen', 'merge-conflict-resolver'],
  },
  {
    id: 'testing-qa',
    name: 'Testing & Quality Assurance',
    description: 'Test automation, coverage verification, and local runtime verifier recipes.',
    icon: 'flask-conical',
    color: '#10b981',
    custom: false,
    isTemplate: true,
    skills: ['verifier-workspace', 'e2e-runner', 'unit-test-coverage'],
  },
  {
    id: 'cross-repo-release',
    name: 'Cross-Repo & Release Ordering',
    description: 'Managing multi-repo dependency loops, package packing, and merge ordering.',
    icon: 'package',
    color: '#8b5cf6',
    custom: false,
    isTemplate: true,
    skills: ['nexusflow-local-package-loop', 'nexusflow-release-ordering'],
  },
  {
    id: 'database-migrations',
    name: 'Database & Migrations',
    description: 'Safe schema migrations, rollback procedures, and SQL performance checks.',
    icon: 'database',
    color: '#f59e0b',
    custom: false,
    isTemplate: true,
    skills: ['schema-migration-validator', 'sql-fluff-linter'],
  },
  {
    id: 'security-auditing',
    name: 'Security & Auditing',
    description: 'OWASP vulnerability scanning, secret leak detection, and compliance auditing.',
    icon: 'shield-check',
    color: '#ef4444',
    custom: false,
    isTemplate: true,
    skills: ['secret-scanner', 'security-auditor'],
  },
];

export const DEFAULT_SKILLS: SkillItem[] = [
  {
    id: 'pr-review-toolkit',
    name: 'pr-review-toolkit',
    title: 'Pull Request Review Toolkit',
    category: 'pull-requests',
    description:
      'Reviews pull requests for breaking changes, code style, edge cases, and test coverage. Use when user asks to "review PR", "audit changes", or "check diff".',
    tags: ['git', 'pr', 'review', 'quality'],
    allowedTools: ['run_command', 'view_file', 'grep_search'],
    custom: false,
    content: `# Pull Request Review Toolkit

This skill guides the AI assistant through a structured, multi-file pull request review.

## Review Steps
1. **Analyze Diff Scope**:
   - Inspect uncommitted changes or branch diff using \`git diff origin/main...HEAD\`.
   - Identify affected modules, interfaces, and public API boundaries.
2. **Contract & Regression Check**:
   - Verify that existing function signatures and data contracts remain backwards-compatible.
   - Check error handling, boundary conditions, and null safety.
3. **Test Coverage & Verification**:
   - Confirm unit or integration tests exist for newly added logic.
   - Run verification commands (\`npm test\`, \`dotnet test\`, or project test runner).
4. **Structured Feedback**:
   - Return findings organized by Severity (Critical, High, Medium, Minor) with exact line references and remediation suggestions.
`,
  },
  {
    id: 'pr-description-gen',
    name: 'pr-description-gen',
    title: 'PR Description Generator',
    category: 'pull-requests',
    description:
      'Generates conventional, well-structured Pull Request descriptions with summaries, diff breakdowns, and test checklists.',
    tags: ['git', 'pr', 'documentation'],
    allowedTools: ['run_command'],
    custom: false,
    content: `# Pull Request Description Generator

Automatically writes standardized, clear PR descriptions based on git history and repository changes.

## Procedure
1. Extract commit messages on the feature branch via \`git log origin/main..HEAD --oneline\`.
2. Inspect the file change stats via \`git diff --stat origin/main..HEAD\`.
3. Format output with:
   - **Summary**: 2-3 sentences explaining the "why" and "what".
   - **Key Changes**: Bulleted list of architectural and implementation updates.
   - **Testing Plan**: Exact verification commands run and outcomes.
   - **Breaking Changes**: Explicit flag if public APIs or database schemas were altered.
`,
  },
  {
    id: 'merge-conflict-resolver',
    name: 'merge-conflict-resolver',
    title: 'Merge Conflict Resolver',
    category: 'pull-requests',
    description:
      'Guides step-by-step resolution of git merge conflicts, ensuring neither upstream updates nor local feature intent are lost.',
    tags: ['git', 'merge', 'conflict'],
    allowedTools: ['run_command', 'view_file', 'replace_file_content'],
    custom: false,
    content: `# Merge Conflict Resolver

Guidelines for resolving complex git merge and rebase conflicts across workspace repositories.

## Workflow
1. Run \`git status\` to locate unmerged paths (\`UU\` status).
2. For each conflicted file, inspect both the incoming (HEAD) and current versions.
3. Identify semantic intent of both sides before removing conflict markers (\`<<<<<<<\`, \`=======\`, \`>>>>>>>\`).
4. Re-run project tests and type-checks to verify resolution.
`,
  },
  {
    id: 'verifier-workspace',
    name: 'verifier-workspace',
    title: 'Local Runtime Verifier',
    category: 'testing-qa',
    description:
      'Guidelines and recipes to safely launch, mock, and verify services locally across workspace repositories.',
    tags: ['testing', 'runtime', 'verifier', 'ports'],
    allowedTools: ['run_command'],
    custom: false,
    content: `# Local Runtime Verifier

Guidelines to safely launch, mock, and verify services locally in this workspace.

## Verification Recipe
1. **Check local ports**: Ensure target ports do not conflict with running services.
2. **Run mocks**: Spin up local databases/caches before starting services.
3. **Watch out for shared staging environment**: Never publish messages or write data to staging infrastructure while testing locally unless explicitly requested.
`,
  },
  {
    id: 'e2e-runner',
    name: 'e2e-runner',
    title: 'End-to-End Test Runner',
    category: 'testing-qa',
    description:
      'Orchestrates end-to-end testing (Playwright, Cypress) with failure triage and trace analysis.',
    tags: ['e2e', 'playwright', 'testing'],
    allowedTools: ['run_command', 'view_file'],
    custom: false,
    content: `# End-to-End Test Runner

Guides executing and debugging end-to-end browser and API tests.

## Instructions
1. Run headless test suite: \`npx playwright test\` or \`npm run test:e2e\`.
2. On failure, inspect generated screenshots, videos, or trace logs in the test results directory.
3. Fix underlying selector mismatches, timing issues, or backend regressions.
`,
  },
  {
    id: 'unit-test-coverage',
    name: 'unit-test-coverage',
    title: 'Unit Test Coverage & TDD',
    category: 'testing-qa',
    description:
      'Implements comprehensive unit tests for new or modified modules, adhering to test-driven development best practices.',
    tags: ['unit-test', 'tdd', 'coverage'],
    allowedTools: ['run_command', 'view_file', 'write_to_file', 'replace_file_content'],
    custom: false,
    content: `# Unit Test Coverage & TDD

Guides writing high-coverage, maintainable unit tests.

## Guidelines
- Test behavior, not implementation details.
- Mock external network calls, database connections, and file system I/O.
- Verify edge cases: empty collections, null inputs, unexpected exceptions, timeouts.
- Target >80% statement and branch coverage on critical business logic.
`,
  },
  {
    id: 'nexusflow-local-package-loop',
    name: 'nexusflow-local-package-loop',
    title: 'Local Package Development Loop',
    category: 'cross-repo-release',
    description:
      'Guides testing cross-repo package dependencies locally without publishing to external registries.',
    tags: ['cross-repo', 'npm', 'nuget', 'packages'],
    allowedTools: ['run_command', 'view_file'],
    custom: false,
    content: `# Local Package Development Loop

This skill guides the AI assistant through local package testing across repositories in this workspace.

## Workflow
When modifying a shared package in one repository, you must test its effect on downstream consumer repositories before pushing.

### npm / JS/TS:
1. Run \`npm pack\` inside the producing package directory.
2. Copy the generated \`.tgz\` file to \`local-packages/\`.
3. Reference the local tarball in consumer \`package.json\`.

### NuGet / .NET:
1. Run \`dotnet pack -c Release -o ./local-packages\` in producer.
2. Reference local package version in consumer \`.csproj\`.
`,
  },
  {
    id: 'nexusflow-release-ordering',
    name: 'nexusflow-release-ordering',
    title: 'Release & Merge Ordering',
    category: 'cross-repo-release',
    description:
      'Computes and explains the correct topological merge and release order when cross-repo dependencies change.',
    tags: ['release', 'dependencies', 'ordering'],
    allowedTools: ['view_file'],
    custom: false,
    content: `# Release and Merge Ordering Guidelines

Answers what repositories must be merged and released in what order when cross-repo dependencies are modified.

## Principles
1. **Producer First**: Repositories producing shared packages must be merged, tagged, and published first.
2. **Consumer Bump**: Downstream consumer repositories must update their version reference and be merged next.
3. **Reversion Check**: Ensure all temporary local package references are reverted before merging consumer branches.
`,
  },
  {
    id: 'schema-migration-validator',
    name: 'schema-migration-validator',
    title: 'Schema Migration Validator',
    category: 'database-migrations',
    description:
      'Validates database schema migrations for safety, lock contention risks, and backwards compatibility.',
    tags: ['database', 'migrations', 'sql', 'prisma'],
    allowedTools: ['run_command', 'view_file'],
    custom: false,
    content: `# Database Schema Migration Validator

Guidelines for evaluating database migrations before running them against shared environments.

## Checklist
- **No Table Locks**: Avoid adding non-null columns without default values to large existing tables.
- **Index Creation**: Use concurrent index creation (e.g. \`CREATE INDEX CONCURRENTLY\`) on production databases.
- **Rollback Safety**: Verify a corresponding down/revert migration script exists and works.
`,
  },
  {
    id: 'sql-fluff-linter',
    name: 'sql-fluff-linter',
    title: 'SQL Quality & Linter',
    category: 'database-migrations',
    description:
      'Lints SQL queries and migration scripts for formatting, performance traps, and ANSI SQL standards.',
    tags: ['sql', 'lint', 'database'],
    allowedTools: ['run_command', 'view_file'],
    custom: false,
    content: `# SQL Quality & Linter

Enforces clean, performant SQL syntax across migrations and query templates.

## Rules
- Use explicit column names in SELECT queries (avoid \`SELECT *\`).
- Ensure all JOIN conditions use indexed foreign keys.
- Uppercase SQL keywords (\`SELECT\`, \`WHERE\`, \`GROUP BY\`, \`ORDER BY\`).
`,
  },
  {
    id: 'secret-scanner',
    name: 'secret-scanner',
    title: 'Secret & Credential Scanner',
    category: 'security-auditing',
    description:
      'Scans source files, commit history, and configuration files for exposed API keys, private certificates, and secrets.',
    tags: ['security', 'secrets', 'credentials'],
    allowedTools: ['grep_search', 'view_file'],
    custom: false,
    content: `# Secret & Credential Scanner

Proactively prevents committing confidential credentials to version control.

## High-Risk Patterns
- AWS access keys (\`AKIA...\`), GitHub PATs (\`ghp_...\`), OpenAI keys (\`sk-...\`).
- RSA / SSH private keys (\`-----BEGIN PRIVATE KEY-----\`).
- Hardcoded connection strings with passwords in source code.
`,
  },
  {
    id: 'security-auditor',
    name: 'security-auditor',
    title: 'Security Audit Playbook',
    category: 'security-auditing',
    description:
      'Use when auditing code for OWASP Top 10 vulnerabilities, access-control gaps, injection, or cryptographic failures.',
    tags: ['security', 'audit', 'owasp'],
    allowedTools: ['view_file', 'grep_search'],
    custom: false,
    content: `# Security Audit Playbook

Instructions for conducting deep application security audits.

## Focus Areas
1. **Injection Vectors**: SQL, Command, LDAP, and XSS vulnerabilities.
2. **Broken Access Control**: Missing authorization checks on sensitive REST / RPC routes.
3. **Cryptographic Failures**: Deprecated hashing algorithms (MD5/SHA1) or unencrypted tokens.
`,
  },
];

// ─── Categories Management ────────────────────────────────────────────────

export function getContextSpaceHome(): string {
  return resolveBrandHomeDir();
}

export const getNexusFlowHome = getContextSpaceHome;


export function getUserCategoriesPath(): string {
  return path.join(getContextSpaceHome(), 'categories.json');
}

export function getUserSkillsDir(): string {
  return path.join(getContextSpaceHome(), 'skills');
}

const PORTABLE_SKILL_SUPPORT_DIRECTORIES = new Set(['scripts', 'references', 'assets', 'agents']);

async function copySkillSupportTree(sourceDir: string, targetDir: string): Promise<void> {
  await fse.ensureDir(targetDir);
  for (const entry of await fs.readdir(sourceDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw new Error(`Linked skill support files are not allowed: ${entry.name}`);
    }
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copySkillSupportTree(source, target);
    } else if (entry.isFile()) {
      await fs.copyFile(source, target);
    } else {
      throw new Error(`Unsupported skill support entry: ${entry.name}`);
    }
  }
}

async function readUserSkillCategories(userPath: string): Promise<SkillCategory[]> {
  if (!(await fse.pathExists(userPath))) {
    return [];
  }

  const data: unknown = await fse.readJson(userPath);
  if (!Array.isArray(data)) {
    throw new Error('Custom skill categories must be stored as an array.');
  }

  const categories: SkillCategory[] = [];
  for (const item of data) {
    const parsed = skillCategorySchema.safeParse(item);
    if (!parsed.success) {
      console.warn(`Ignoring invalid custom skill category: ${formatValidationError(parsed.error)}`);
      continue;
    }
    categories.push(parsed.data);
  }
  return categories;
}


/**
 * Loads all skill categories (merging built-in templates and user custom categories).
 */
export async function getSkillCategories(): Promise<SkillCategory[]> {
  const categoryMap = new Map<string, SkillCategory>();

  // 1. Seed with default template categories
  for (const cat of DEFAULT_CATEGORIES) {
    categoryMap.set(cat.id, { ...cat });
  }

  // 2. Load user categories from ~/.nexusflow/categories.json if present
  try {
    const userPath = getUserCategoriesPath();
    if (await fse.pathExists(userPath)) {
      const data = await readUserSkillCategories(userPath);
      for (const item of data) {
        categoryMap.set(item.id, {
          ...item,
          custom: item.custom !== undefined ? item.custom : true,
          isTemplate: item.isTemplate !== undefined ? item.isTemplate : false,
        });
      }
    }
  } catch (err) {
    console.error('Failed to read user categories:', err);
  }

  return Array.from(categoryMap.values());
}

/**
 * Saves or updates a custom skill category.
 */
export async function saveSkillCategory(
  category: Partial<SkillCategory> & { name: string },
): Promise<SkillCategory> {
  const rawId = category.id || slugify(category.name);
  const id = slugify(rawId);
  if (!id) {
    throw new Error('Category name cannot be empty');
  }

  return withCatalogLock(async () => {
    const userPath = getUserCategoriesPath();
    await fse.ensureDir(path.dirname(userPath));
    const userItems = await readUserSkillCategories(userPath);
    const existing = userItems.find((item) => item.id === id)
      ?? DEFAULT_CATEGORIES.find((item) => item.id === id);

    const candidate: SkillCategory = {
      id,
      name: category.name.trim(),
      description: category.description?.trim() || '',
      icon: category.icon || existing?.icon || 'folder',
      color: category.color || existing?.color || '#3b82f6',
      custom: true,
      isTemplate: existing?.isTemplate || false,
      skills: category.skills || existing?.skills || [],
    };
    const parsed = skillCategorySchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(`Invalid skill category: ${formatValidationError(parsed.error)}`);
    }

    const filtered = userItems.filter((item) => item.id !== id);
    filtered.push(parsed.data);
    await atomicWriteJson(userPath, filtered);
    return parsed.data;
  });
}

/**
 * Deletes a custom skill category or resets a customized template override.
 */
export async function deleteSkillCategory(id: string): Promise<void> {
  const sanitizedId = slugify(id);
  if (!sanitizedId) {
    throw new Error('Invalid category ID');
  }

  await withCatalogLock(async () => {
    const userPath = getUserCategoriesPath();
    const userItems = await readUserSkillCategories(userPath);
    const isCustomized = userItems.some((item) => item.id === sanitizedId);
    const defaultTemplate = DEFAULT_CATEGORIES.find((item) => item.id === sanitizedId);

    if (!isCustomized && defaultTemplate) {
      throw new Error('Cannot delete built-in template categories');
    }

    if (!isCustomized && !defaultTemplate) {
      throw new Error('Category not found');
    }

    // Removing an override resets it back to the built-in category.
    const filtered = userItems.filter((item) => item.id !== sanitizedId);
    await atomicWriteJson(userPath, filtered);
  });
}

// ─── Skills Management ────────────────────────────────────────────────────

/**
 * Reads a skill package from a directory containing SKILL.md.
 */
async function loadSkillFromDir(
  skillDir: string,
  custom: boolean,
  catalogRoot = path.dirname(skillDir),
): Promise<SkillItem | null> {
  await assertNoLinkedPathComponents(catalogRoot, skillDir);
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!(await fse.pathExists(skillFile))) {
    return null;
  }

  const raw = await fs.readFile(skillFile, 'utf-8');
  const { metadata, content } = parseSkillMarkdown(raw);
  const parsedMetadata = skillFrontmatterSchema.safeParse(metadata);
  if (!parsedMetadata.success) {
    throw new Error(`Invalid SKILL.md: ${formatValidationError(parsedMetadata.error)}`);
  }
  const id = parsedMetadata.data.name;
  const directoryId = path.basename(skillDir);
  if (id !== directoryId) {
    throw new Error(`Skill name "${id}" must match directory identity "${directoryId}".`);
  }
  const name = id;
  const nexusflowMetadata =
    parsedMetadata.data.metadata &&
    typeof parsedMetadata.data.metadata.nexusflow === 'object' &&
    parsedMetadata.data.metadata.nexusflow !== null
      ? (parsedMetadata.data.metadata.nexusflow as Record<string, unknown>)
      : {};
  const title =
    parsedMetadata.data.title ||
    (typeof nexusflowMetadata.title === 'string' ? nexusflowMetadata.title : undefined) ||
    name
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  const category =
    parsedMetadata.data.category ||
    (typeof nexusflowMetadata.category === 'string' ? nexusflowMetadata.category : undefined) ||
    'general';
  const description = parsedMetadata.data.description;
  const tags =
    parsedMetadata.data.tags ||
    (Array.isArray(nexusflowMetadata.tags)
      ? nexusflowMetadata.tags.filter((tag): tag is string => typeof tag === 'string')
      : []);
  const rawAllowedTools = parsedMetadata.data['allowed-tools'];
  const allowedTools = Array.isArray(rawAllowedTools)
    ? rawAllowedTools
    : rawAllowedTools
      ? rawAllowedTools.split(/\s+/).filter(Boolean)
      : [];

  // Inspect references/ and scripts/ if present
  const referencesDir = path.join(skillDir, 'references');
  const scriptsDir = path.join(skillDir, 'scripts');

  const references: { name: string; relativePath: string }[] = [];
  const scripts: { name: string; relativePath: string }[] = [];

  if (await fse.pathExists(referencesDir)) {
    try {
      await assertNoLinkedPathComponents(skillDir, referencesDir);
      const files = await fs.readdir(referencesDir, { withFileTypes: true });
      for (const file of files) {
        if (file.isSymbolicLink()) throw new Error(`Linked skill files are not allowed: ${file.name}`);
        if (file.isFile()) {
          references.push({ name: file.name, relativePath: path.join('references', file.name) });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Linked skill files')) throw error;
    }
  }

  if (await fse.pathExists(scriptsDir)) {
    try {
      await assertNoLinkedPathComponents(skillDir, scriptsDir);
      const files = await fs.readdir(scriptsDir, { withFileTypes: true });
      for (const file of files) {
        if (file.isSymbolicLink()) throw new Error(`Linked skill files are not allowed: ${file.name}`);
        if (file.isFile()) {
          scripts.push({ name: file.name, relativePath: path.join('scripts', file.name) });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Linked skill files')) throw error;
    }
  }

  return {
    id,
    name,
    title,
    category,
    description,
    tags,
    allowedTools,
    content,
    custom,
    sourcePath: skillDir,
    references: references.length > 0 ? references : undefined,
    scripts: scripts.length > 0 ? scripts : undefined,
  };
}

/**
 * Retrieves all available skills (built-in templates + user directory + optional workspace directory).
 */
export async function getAllSkills(_workspacePath?: string): Promise<SkillItem[]> {
  const skillMap = new Map<string, SkillItem>();

  // 1. Built-in template skills
  for (const s of DEFAULT_SKILLS) {
    skillMap.set(s.id, { ...s });
  }

  // 2. User directory (~/.nexusflow/skills/)
  const userSkillsDir = getUserSkillsDir();
  if (await fse.pathExists(userSkillsDir)) {
    try {
      await assertPathIsNotLink(userSkillsDir);
      const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const isDir = typeof entry === 'string' ? true : entry.isDirectory ? entry.isDirectory() : true;
          const entryName = typeof entry === 'string' ? entry : entry.name;
          if (isDir) {
            try {
              const loaded = await loadSkillFromDir(path.join(userSkillsDir, entryName), true, userSkillsDir);
              if (loaded) {
                if (skillMap.has(loaded.id)) {
                  throw new Error(`A resource named "${loaded.id}" already exists in the built-in catalog.`);
                }
                skillMap.set(loaded.id, loaded);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.warn(`Skipping invalid skill "${entryName}": ${message}`);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load user skills:', err);
    }
  }

  return Array.from(skillMap.values());
}

/**
 * Saves or updates a portable skill package.
 */
export async function saveSkill(
  skill: Partial<SkillItem> & { name: string; content: string },
  options: {
    readonly beforeCommit?: () => Promise<void>;
    readonly supportFileModes?: Readonly<Record<string, number>>;
  } = {},
): Promise<SkillItem> {
  const rawId = skill.id || skill.name;
  const idResult = resourceIdSchema.safeParse(rawId);
  if (!idResult.success) {
    throw new Error(`Invalid skill ID: ${formatValidationError(idResult.error)}`);
  }
  if (idResult.data !== rawId) throw new Error('Invalid skill ID format.');
  const id = idResult.data;
  const nameResult = resourceIdSchema.safeParse(skill.name);
  if (!nameResult.success || nameResult.data !== skill.name || nameResult.data !== id) {
    throw new Error('Skill id and name must match.');
  }
  if (DEFAULT_SKILLS.some((builtIn) => builtIn.id === id)) {
    throw new Error('Built-in skills cannot be overwritten. Create a custom skill with a new identifier.');
  }
  const description = skill.description?.trim();
  if (!description) throw new Error('Skill description is required.');
  if (!skill.content.trim()) throw new Error('Skill content is required.');

  return withCatalogLock(async () => {
    const userSkillsDir = path.resolve(getUserSkillsDir());
    await fse.ensureDir(userSkillsDir);
    await assertPathIsNotLink(userSkillsDir);
    const targetDir = assertPathWithin(userSkillsDir, path.join(userSkillsDir, id));
    await assertNoLinkedPathComponents(userSkillsDir, targetDir);

    const stagingDir = await fs.mkdtemp(path.join(userSkillsDir, `.staging-${id}-`));
    const backupDir = path.join(userSkillsDir, `.backup-${id}-${randomUUID()}`);
    let movedExisting = false;
    let installedStaging = false;
    try {
      let existingFrontmatter: ReturnType<typeof skillFrontmatterSchema.parse> | undefined;
      if (await fse.pathExists(targetDir)) {
        await assertNoLinkedPathComponents(userSkillsDir, targetDir);
        for (const entry of await fs.readdir(targetDir, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) {
            throw new Error(`Linked skill package entries are not allowed: ${entry.name}`);
          }
          if (entry.name === 'SKILL.md') continue;
          if (!entry.isDirectory() || !PORTABLE_SKILL_SUPPORT_DIRECTORIES.has(entry.name)) {
            throw new Error(`Unsupported top-level skill package entry: ${entry.name}`);
          }
          await copySkillSupportTree(path.join(targetDir, entry.name), path.join(stagingDir, entry.name));
        }
        const currentSkillMarkdown = parseSkillMarkdown(
          await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf-8'),
        );
        const parsedCurrentFrontmatter = skillFrontmatterSchema.safeParse(currentSkillMarkdown.metadata);
        if (parsedCurrentFrontmatter.success) existingFrontmatter = parsedCurrentFrontmatter.data;
      }

      const existingNexusFlowMetadata =
        existingFrontmatter?.metadata &&
        typeof existingFrontmatter.metadata.nexusflow === 'object' &&
        existingFrontmatter.metadata.nexusflow !== null
          ? existingFrontmatter.metadata.nexusflow as Record<string, unknown>
          : {};
      const metadata: Record<string, unknown> = {
        name: id,
        description,
        license: existingFrontmatter?.license,
        compatibility: existingFrontmatter?.compatibility,
        metadata: {
          ...(existingFrontmatter?.metadata ?? {}),
          nexusflow: {
            ...existingNexusFlowMetadata,
            title: skill.title || id,
            category: skill.category || 'general',
            tags: skill.tags || [],
          },
        },
      };
      const allowedTools = skill.allowedTools === undefined
        ? existingFrontmatter?.['allowed-tools']
        : skill.allowedTools;
      if (allowedTools?.length) metadata['allowed-tools'] = allowedTools;
      await fs.writeFile(
        path.join(stagingDir, 'SKILL.md'),
        serializeSkillMarkdown(metadata, skill.content),
        'utf-8',
      );

      for (const [directory, files] of [
        ['references', skill.references],
        ['scripts', skill.scripts],
      ] as const) {
        if (files === undefined) continue;
        const supportDir = path.join(stagingDir, directory);
        await fse.remove(supportDir);
        if (!files.length) continue;
        await fse.ensureDir(supportDir);
        for (const file of files) {
          if (!file.name || path.basename(file.name) !== file.name || file.content === undefined) {
            throw new Error(`Invalid ${directory} file name: ${file.name || '(empty)'}`);
          }
          const supportPath = path.join(supportDir, file.name);
          await fs.writeFile(supportPath, file.content, 'utf-8');
          const relativePath = `${directory}/${file.name}`;
          const mode = options.supportFileModes?.[relativePath];
          if (mode !== undefined) {
            try {
              await fs.chmod(supportPath, mode);
            } catch (error) {
              if (process.platform !== 'win32') throw error;
            }
          }
        }
      }

      await options.beforeCommit?.();

      if (await fse.pathExists(targetDir)) {
        await assertNoLinkedPathComponents(userSkillsDir, targetDir);
        await fs.rename(targetDir, backupDir);
        movedExisting = true;
      }
      await fs.rename(stagingDir, targetDir);
      installedStaging = true;
      const loaded = await loadSkillFromDir(targetDir, true, userSkillsDir);
      if (!loaded) throw new Error('Saved skill could not be loaded.');
      if (movedExisting) await fse.remove(backupDir).catch(() => {});
      return loaded;
    } catch (error) {
      await fse.remove(stagingDir).catch(() => {});
      if (installedStaging) await fse.remove(targetDir).catch(() => {});
      if (movedExisting && (await fse.pathExists(backupDir))) {
        await fs.rename(backupDir, targetDir).catch(() => {});
      }
      throw error;
    }
  });
}

/**
 * Deletes a user custom skill safely.
 */
export async function deleteSkill(id: string): Promise<void> {
  const idResult = resourceIdSchema.safeParse(id);
  if (!idResult.success || idResult.data !== id) {
    throw new Error('Invalid skill ID format.');
  }
  await withCatalogLock(async () => {
    const userSkillsDir = path.resolve(getUserSkillsDir());
    await fse.ensureDir(userSkillsDir);
    await assertPathIsNotLink(userSkillsDir);
    const targetDir = assertPathWithin(userSkillsDir, path.join(userSkillsDir, id));
    if (!(await fse.pathExists(targetDir))) throw new Error('Skill not found.');
    await assertNoLinkedPathComponents(userSkillsDir, targetDir);
    await fse.remove(targetDir);
  });
}

// ─── Workspace Skills Assignment Config ────────────────────────────────────

/**
 * Loads workspace skills assignment config from `.nexusflow/skills.json` or returns defaults.
 */
export async function getWorkspaceSkillsConfig(workspacePath: string): Promise<WorkspaceSkillsConfig> {
  const canonicalWorkspace = await fs.realpath(workspacePath);
  const configFile = path.join(canonicalWorkspace, '.nexusflow', 'skills.json');
  if (await fse.pathExists(configFile)) {
    await assertNoLinkedPathComponents(canonicalWorkspace, configFile);
    const rawData = await fse.readJson(configFile) as unknown;
    const legacyData =
      typeof rawData === 'object' && rawData !== null && !('schemaVersion' in rawData)
        ? { schemaVersion: 1, revision: 0, ...rawData }
        : rawData;
    const result = workspaceResourcesConfigSchema.safeParse(legacyData);
    if (!result.success) {
      throw new Error(`Invalid workspace resource configuration: ${formatValidationError(result.error)}`);
    }
    return result.data;
  }

  return {
    schemaVersion: 1,
    revision: 0,
    enabledSkills: [],
    enabledAgents: [],
    enabledCategories: [],
  };
}

/**
 * Saves workspace skills assignment config.
 */
export async function saveWorkspaceSkillsConfig(
  workspacePath: string,
  config: WorkspaceSkillsConfig,
  expectedRevision?: number,
): Promise<WorkspaceSkillsConfig> {
  return runWorkspaceConfigMutation(async () => {
    const canonicalWorkspace = await fs.realpath(workspacePath);
    const configDir = path.join(canonicalWorkspace, '.nexusflow');
    await fse.ensureDir(configDir);
    await assertNoLinkedPathComponents(canonicalWorkspace, configDir);
    await assertPathIsNotLink(configDir);

    const release = await acquireLock(path.join(configDir, 'resource-config.lock'), {
      staleMs: 60_000,
      timeoutMs: 10_000,
      timeoutMessage: 'Timed out waiting for the workspace resource configuration lock.',
    });
    try {
      const current = await getWorkspaceSkillsConfig(canonicalWorkspace);
      const currentRevision = current.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new WorkspaceResourceRevisionError(expectedRevision, currentRevision);
      }
      const parsed = workspaceResourcesConfigSchema.safeParse({
        schemaVersion: 1,
        revision: currentRevision + 1,
        enabledSkills: config.enabledSkills,
        enabledAgents: config.enabledAgents ?? current.enabledAgents ?? [],
        enabledCategories: config.enabledCategories ?? [],
      });
      if (!parsed.success) {
        throw new Error(`Invalid workspace resource configuration: ${formatValidationError(parsed.error)}`);
      }
      await atomicWriteJson(path.join(configDir, 'skills.json'), parsed.data);
      return parsed.data;
    } finally {
      await release();
    }
  });
}
