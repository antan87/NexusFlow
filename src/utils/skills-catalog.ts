/**
 * @module utils/skills-catalog
 * Manages built-in template categories, user-defined custom categories,
 * portable skills packages (SKILL.md), and workspace skills assignments.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import fse from 'fs-extra';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

import { slugify } from './slug.js';
import type {
  SkillCategory,
  SkillItem,
  SkillParameter,
  AgentPersona,
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

function assertWithinRoot(rootDir: string, targetPath: string): void {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Security Violation: Path "${targetPath}" is outside allowed root directory.`);
  }
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
    title: 'Security Auditor Subagent',
    category: 'security-auditing',
    description:
      'Specialized security auditor subagent specification that evaluates code for OWASP Top 10 vulnerabilities.',
    tags: ['security', 'audit', 'owasp'],
    allowedTools: ['view_file', 'grep_search'],
    custom: false,
    content: `# Security Auditor Subagent

Persona and instructions for conducting deep application security audits.

## Focus Areas
1. **Injection Vectors**: SQL, Command, LDAP, and XSS vulnerabilities.
2. **Broken Access Control**: Missing authorization checks on sensitive REST / RPC routes.
3. **Cryptographic Failures**: Deprecated hashing algorithms (MD5/SHA1) or unencrypted tokens.
`,
  },
];

// ─── Categories Management ────────────────────────────────────────────────

export function getNexusFlowHome(): string {
  if (process.env.NEXUSFLOW_HOME && process.env.NEXUSFLOW_HOME !== 'undefined') {
    return process.env.NEXUSFLOW_HOME;
  }
  return path.join(os.homedir(), '.nexusflow');
}


export function getUserCategoriesPath(): string {
  return path.join(getNexusFlowHome(), 'categories.json');
}

export function getUserSkillsDir(): string {
  return path.join(getNexusFlowHome(), 'skills');
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
      const data = await fse.readJson(userPath);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.id) {
            categoryMap.set(item.id, {
              ...item,
              custom: item.custom !== undefined ? item.custom : true,
              isTemplate: item.isTemplate !== undefined ? item.isTemplate : false,
            });
          }
        }
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

  const existingCategories = await getSkillCategories();
  const existing = existingCategories.find((c) => c.id === id);

  const updated: SkillCategory = {
    id,
    name: category.name.trim(),
    description: category.description?.trim() || '',
    icon: category.icon || existing?.icon || 'folder',
    color: category.color || existing?.color || '#3b82f6',
    custom: true,
    isTemplate: existing?.isTemplate || false,
    skills: category.skills || existing?.skills || [],
  };

  const userPath = getUserCategoriesPath();
  await fse.ensureDir(path.dirname(userPath));

  // Read existing custom items
  let userItems: SkillCategory[] = [];
  try {
    if (await fse.pathExists(userPath)) {
      const parsed = await fse.readJson(userPath);
      if (Array.isArray(parsed)) {
        userItems = parsed;
      }
    }
  } catch {}

  const filtered = userItems.filter((c) => c.id !== id);
  filtered.push(updated);

  await fse.writeJson(userPath, filtered, { spaces: 2 });
  return updated;
}

/**
 * Deletes a custom skill category or resets a customized template override.
 */
export async function deleteSkillCategory(id: string): Promise<void> {
  const sanitizedId = slugify(id);
  if (!sanitizedId) {
    throw new Error('Invalid category ID');
  }

  const userPath = getUserCategoriesPath();
  let userItems: SkillCategory[] = [];
  try {
    if (await fse.pathExists(userPath)) {
      const parsed = await fse.readJson(userPath);
      if (Array.isArray(parsed)) {
        userItems = parsed;
      }
    }
  } catch {}

  const isCustomized = userItems.some((c) => c.id === sanitizedId);
  const defaultTemplate = DEFAULT_CATEGORIES.find((c) => c.id === sanitizedId);

  if (!isCustomized && defaultTemplate) {
    throw new Error('Cannot delete built-in template categories');
  }

  if (!isCustomized && !defaultTemplate) {
    throw new Error('Category not found');
  }

  // Remove from custom file (if it was an override, this resets it back to built-in default)
  const filtered = userItems.filter((c) => c.id !== sanitizedId);
  await fse.writeJson(userPath, filtered, { spaces: 2 });
}

// ─── Skills Management ────────────────────────────────────────────────────

/**
 * Reads a skill package from a directory containing SKILL.md.
 */
async function loadSkillFromDir(skillDir: string, custom: boolean): Promise<SkillItem | null> {
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!(await fse.pathExists(skillFile))) {
    return null;
  }

  const raw = await fs.readFile(skillFile, 'utf-8');
  const { metadata, content } = parseSkillMarkdown(raw);
  const id = (metadata.name as string) || path.basename(skillDir);
  const name = id;
  const title =
    (metadata.title as string) ||
    name
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  const category = (metadata.category as string) || 'general';
  const description = (metadata.description as string) || '';
  const tags = (metadata.tags as string[]) || [];
  const allowedTools =
    (metadata['allowed-tools'] as string[]) || (metadata.allowedTools as string[]) || [];

  // Inspect references/ and scripts/ if present
  const referencesDir = path.join(skillDir, 'references');
  const scriptsDir = path.join(skillDir, 'scripts');

  const references: { name: string; relativePath: string }[] = [];
  const scripts: { name: string; relativePath: string }[] = [];

  if (await fse.pathExists(referencesDir)) {
    try {
      const files = await fs.readdir(referencesDir);
      for (const f of files) {
        references.push({ name: f, relativePath: path.join('references', f) });
      }
    } catch {}
  }

  if (await fse.pathExists(scriptsDir)) {
    try {
      const files = await fs.readdir(scriptsDir);
      for (const f of files) {
        scripts.push({ name: f, relativePath: path.join('scripts', f) });
      }
    } catch {}
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
export async function getAllSkills(workspacePath?: string): Promise<SkillItem[]> {
  const skillMap = new Map<string, SkillItem>();

  // 1. Built-in template skills
  for (const s of DEFAULT_SKILLS) {
    skillMap.set(s.id, { ...s });
  }

  // 2. User directory (~/.nexusflow/skills/)
  const userSkillsDir = getUserSkillsDir();
  if (await fse.pathExists(userSkillsDir)) {
    try {
      const entries = await fs.readdir(userSkillsDir, { withFileTypes: true });
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const isDir = typeof entry === 'string' ? true : entry.isDirectory ? entry.isDirectory() : true;
          const entryName = typeof entry === 'string' ? entry : entry.name;
          if (isDir) {
            const loaded = await loadSkillFromDir(path.join(userSkillsDir, entryName), true);
            if (loaded) {
              skillMap.set(loaded.id, loaded);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to load user skills:', err);
    }
  }

  // 3. Workspace skills (.agents/skills/, .claude/skills/, .codex/skills/)
  if (workspacePath) {
    const candidateDirs = [
      path.join(workspacePath, '.agents', 'skills'),
      path.join(workspacePath, '.claude', 'skills'),
      path.join(workspacePath, '.codex', 'skills'),
    ];
    for (const cDir of candidateDirs) {
      if (await fse.pathExists(cDir)) {
        try {
          const entries = await fs.readdir(cDir, { withFileTypes: true });
          if (Array.isArray(entries)) {
            for (const entry of entries) {
              const isDir = typeof entry === 'string' ? true : entry.isDirectory ? entry.isDirectory() : true;
              const entryName = typeof entry === 'string' ? entry : entry.name;
              if (isDir) {
                const isDefault = DEFAULT_SKILLS.some((ds) => ds.id === entryName);
                const loaded = await loadSkillFromDir(path.join(cDir, entryName), !isDefault);
                if (loaded) {
                  skillMap.set(loaded.id, loaded);
                }
              }
            }
          }
        } catch {}
      }
    }
  }

  return Array.from(skillMap.values());
}

/**
 * Saves or updates a portable skill package.
 */
export async function saveSkill(skill: Partial<SkillItem> & { name: string; content: string }): Promise<SkillItem> {
  const rawId = skill.id || skill.name;
  if (!rawId || rawId.includes('/') || rawId.includes('\\') || rawId.includes('..')) {
    throw new Error('Invalid skill ID format.');
  }
  const id = slugify(rawId);
  if (!id) {
    throw new Error('Skill name cannot be empty');
  }

  const userSkillsDir = path.resolve(getUserSkillsDir());
  await fse.ensureDir(userSkillsDir);

  const targetDir = path.resolve(userSkillsDir, id);
  assertWithinRoot(userSkillsDir, targetDir);
  await fse.ensureDir(targetDir);


  const metadata: Record<string, unknown> = {
    name: id,
    title: skill.title || id,
    category: skill.category || 'general',
    description: skill.description || '',
  };

  if (skill.tags && skill.tags.length > 0) {
    metadata.tags = skill.tags;
  }
  if (skill.allowedTools && skill.allowedTools.length > 0) {
    metadata['allowed-tools'] = skill.allowedTools;
  }
  if (skill.parameters && skill.parameters.length > 0) {
    metadata.parameters = skill.parameters;
  }

  const rawFile = serializeSkillMarkdown(metadata, skill.content);
  await fs.writeFile(path.join(targetDir, 'SKILL.md'), rawFile, 'utf-8');

  // Handle supporting references/scripts with basename path validation
  if (skill.references && Array.isArray(skill.references)) {
    const refDir = path.join(targetDir, 'references');
    await fse.ensureDir(refDir);
    for (const ref of skill.references) {
      if (ref.name && ref.content !== undefined) {
        const safeName = path.basename(ref.name);
        if (safeName) {
          const filePath = path.join(refDir, safeName);
          assertWithinRoot(refDir, filePath);
          await fs.writeFile(filePath, ref.content, 'utf-8');
        }
      }
    }
  }

  if (skill.scripts && Array.isArray(skill.scripts)) {
    const scriptsDir = path.join(targetDir, 'scripts');
    await fse.ensureDir(scriptsDir);
    for (const sc of skill.scripts) {
      if (sc.name && sc.content !== undefined) {
        const safeName = path.basename(sc.name);
        if (safeName) {
          const filePath = path.join(scriptsDir, safeName);
          assertWithinRoot(scriptsDir, filePath);
          await fs.writeFile(filePath, sc.content, 'utf-8');
        }
      }
    }
  }

  const loaded = await loadSkillFromDir(targetDir, true);
  return (
    loaded || {
      id,
      name: id,
      title: (metadata.title as string) || id,
      category: (metadata.category as string) || 'general',
      description: (metadata.description as string) || '',
      tags: skill.tags,
      allowedTools: skill.allowedTools,
      content: skill.content,
      custom: true,
      sourcePath: targetDir,
    }
  );
}

/**
 * Deletes a user custom skill safely.
 */
export async function deleteSkill(id: string): Promise<void> {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('Invalid skill ID format.');
  }
  const sanitizedId = slugify(id);
  if (!sanitizedId || sanitizedId !== id) {
    throw new Error('Invalid skill ID format.');
  }

  const userSkillsDir = path.resolve(getUserSkillsDir());
  const targetDir = path.resolve(userSkillsDir, sanitizedId);
  assertWithinRoot(userSkillsDir, targetDir);


  if (await fse.pathExists(targetDir)) {
    await fse.remove(targetDir);
  }
}

// ─── Workspace Skills Assignment Config ────────────────────────────────────

/**
 * Loads workspace skills assignment config from `.nexusflow/skills.json` or returns defaults.
 */
export async function getWorkspaceSkillsConfig(workspacePath: string): Promise<WorkspaceSkillsConfig> {
  const configFile = path.join(workspacePath, '.nexusflow', 'skills.json');
  if (await fse.pathExists(configFile)) {
    try {
      const data = await fse.readJson(configFile);
      return {
        enabledSkills: Array.isArray(data.enabledSkills) ? data.enabledSkills : [],
        enabledCategories: Array.isArray(data.enabledCategories) ? data.enabledCategories : [],
      };
    } catch {}
  }

  // Default: enable all template skills
  return {
    enabledSkills: DEFAULT_SKILLS.map((s) => s.id),
    enabledCategories: DEFAULT_CATEGORIES.map((c) => c.id),
  };
}

/**
 * Saves workspace skills assignment config.
 */
export async function saveWorkspaceSkillsConfig(
  workspacePath: string,
  config: WorkspaceSkillsConfig,
): Promise<void> {
  const configDir = path.join(workspacePath, '.nexusflow');
  await fse.ensureDir(configDir);
  await fse.writeJson(path.join(configDir, 'skills.json'), config, { spaces: 2 });
}
