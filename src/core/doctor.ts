/**
 * @module core/doctor
 * Headless workspace diagnostics. Produces a structured {@link DoctorReport}
 * shared by the CLI `doctor` renderer and the MCP `run_doctor` tool.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import { globby } from 'globby';

import { loadConfig } from './config.js';
import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { isInPlace, resolveFeatureRepoPath } from '../utils/feature.js';
import { getConventionalTestCommand } from '../utils/test-command.js';
import { getRepoStatus } from '../utils/multi-git.js';
import { workspaceFileExists, baseFileExists } from './storage.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { findExecutable } from '../agent/cliAvailability.js';

import type { ProjectAnalysis } from '../types.js';

export type DoctorCheckStatus = 'pass' | 'warn' | 'fail' | 'info';

/** A single diagnostic result. */
export interface DoctorCheck {
  category: string;
  name: string;
  status: DoctorCheckStatus;
  message: string;
}

/** Full diagnostic report for a workspace. */
export interface DoctorReport {
  workspacePath: string;
  branchName: string;
  checks: DoctorCheck[];
  errors: string[];
  warnings: string[];
  healthy: boolean;
  /** True when worktree-path errors aborted the deeper checks. */
  aborted: boolean;
}


/**
 * Runs all workspace diagnostics and returns a structured report.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @throws If the workspace manifest cannot be loaded.
 */
export async function runDoctor(workspacePath: string): Promise<DoctorReport> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error('Failed to load workspace configuration. Ensure nexusflow.json exists.');
  }

  const resolvedPaths = feature.repos.map((r) => resolveFeatureRepoPath(feature, workspacePath, r));
  const allRepos = await resolveRepoInfos(resolvedPaths);
  const checks: DoctorCheck[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  const report = (): DoctorReport => ({
    workspacePath,
    branchName: feature.branchName,
    checks,
    errors,
    warnings,
    healthy: errors.length === 0 && warnings.length === 0,
    aborted: false,
  });

  // ── 1. Worktree Paths ──────────────────────────────────────────────────
  let worktreeErrors = false;
  for (const repo of allRepos) {
    try {
      const stat = await fs.stat(repo.path);
      if (!stat.isDirectory()) {
        errors.push(`Worktree path for "${repo.name}" is not a directory.`);
        checks.push({ category: 'Worktree Paths', name: repo.name, status: 'fail', message: 'Path is not a directory' });
        worktreeErrors = true;
      } else {
        checks.push({ category: 'Worktree Paths', name: repo.name, status: 'pass', message: 'Directory exists' });
      }
    } catch {
      errors.push(`Worktree path for "${repo.name}" does not exist: ${repo.path}`);
      checks.push({ category: 'Worktree Paths', name: repo.name, status: 'fail', message: 'Path does not exist' });
      worktreeErrors = true;
    }
  }

  if (worktreeErrors) {
    return { ...report(), aborted: true };
  }

  // ── 2. Analysis (feeds later checks) ───────────────────────────────────
  const { analysis } = await analyzeAllReposCached(allRepos, workspacePath);

  // ── 3. Branch Alignment & Git Status ───────────────────────────────────
  for (const repo of allRepos) {
    let branch = 'unknown';
    try {
      const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo.path });
      branch = stdout.trim();
    } catch {
      // Detached HEAD or git failure — leave as 'unknown'.
    }

    if (isInPlace(feature)) {
      const isolated = feature.isolatedRepos?.[repo.name] ?? feature.isolatedRepos?.[repo.path];
      if (isolated) {
        const expectedBranch = isolated.branchName;
        if (branch !== expectedBranch) {
          warnings.push(`Repository "${repo.name}" is checked out on branch "${branch}", but isolated worktree branch is "${expectedBranch}".`);
          checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'warn', message: `Branch mismatch (${branch} vs expected ${expectedBranch} [isolated worktree])` });
        } else {
          checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'pass', message: `Aligned on branch "${branch}" (isolated worktree)` });
        }
      } else {
        // In-place workspaces have no expected branch — the user manages
        // branches; a mismatch warning here would fire for every repo forever.
        checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'info', message: `On branch "${branch}" (in-place workspace — branches managed by you)` });
      }
    } else {
      // Per-repo existing-branch overrides are expected to differ from the
      // feature branch.
      const expectedBranch = feature.repoBranches?.[repo.name] ?? feature.branchName;
      if (branch !== expectedBranch) {
        warnings.push(`Repository "${repo.name}" is checked out on branch "${branch}", but workspace branch is "${expectedBranch}".`);
        checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'warn', message: `Branch mismatch (${branch} vs expected ${expectedBranch})` });
      } else {
        checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'pass', message: `Aligned on branch "${branch}"` });
      }
    }

    const status = await getRepoStatus(repo.path);
    if (status.hasChanges) {
      warnings.push(`Repository "${repo.name}" has uncommitted changes.`);
      checks.push({ category: 'Branch Alignment & Git Status', name: repo.name, status: 'warn', message: `Has uncommitted changes (${status.summary})` });
    }
  }

  // ── 4. Local Package Setup & Reference Versioning ──────────────────────
  let hasCsharp = false;
  let hasNode = false;

  for (const repo of allRepos) {
    const a = analysis.get(repo.path);
    if (!a) continue;

    if (a.techStack.languages.includes('csharp')) hasCsharp = true;
    if (a.techStack.languages.includes('typescript') || a.techStack.languages.includes('javascript')) hasNode = true;

    if (a.techStack.languages.includes('csharp')) {
      try {
        const csprojs = await globby('**/*.csproj', {
          cwd: repo.path,
          absolute: true,
          ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
        });
        for (const csproj of csprojs) {
          const content = await fs.readFile(csproj, 'utf-8');
          if (content.toLowerCase().includes('-local') || content.toLowerCase().includes('-dev')) {
            warnings.push(`Temporary package version (e.g. ending in "-local" or "-dev") found in "${path.basename(csproj)}".`);
            checks.push({ category: 'Local Package Setup', name: repo.name, status: 'warn', message: `Temporary local package version in "${path.basename(csproj)}"` });
          }
        }
      } catch {}

      if (a.nugetFeeds && a.nugetFeeds.length === 0) {
        try {
          const nugetConfigs = await globby('**/NuGet.config', {
            cwd: repo.path,
            ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
          });
          if (nugetConfigs.length === 0) {
            warnings.push(`Repository "${repo.name}" does not have a NuGet.config. It might not resolve local package dependencies.`);
            checks.push({ category: 'Local Package Setup', name: repo.name, status: 'warn', message: 'No NuGet.config found (needed for local package feeds)' });
          }
        } catch {}
      }
    }

    if (a.techStack.languages.includes('typescript') || a.techStack.languages.includes('javascript')) {
      try {
        const pjs = await globby('**/package.json', {
          cwd: repo.path,
          absolute: true,
          ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
        });
        for (const pj of pjs) {
          const content = await fs.readFile(pj, 'utf-8');
          if (content.includes('"file:') || content.includes('"link:')) {
            warnings.push(`Temporary package link/file reference (e.g., "file:../") found in "${path.basename(pj)}".`);
            checks.push({ category: 'Local Package Setup', name: repo.name, status: 'warn', message: `Temporary local dependency reference ("file:" or "link:") in "${path.basename(pj)}"` });
          }
        }
      } catch {}
    }
  }

  if (hasCsharp || hasNode) {
    checks.push({ category: 'Local Package Setup', name: 'validation', status: 'pass', message: 'Local registry feeds/link validation completed.' });
  } else {
    checks.push({ category: 'Local Package Setup', name: 'validation', status: 'info', message: 'No C# or Node.js repositories to validate.' });
  }

  // ── 5. Test Commands ───────────────────────────────────────────────────
  for (const repo of allRepos) {
    const a = analysis.get(repo.path);
    if (!a) continue;

    const testCommand = getConventionalTestCommand(a);
    if (testCommand === 'npm test' && !a.techStack.languages.includes('typescript') && !a.techStack.languages.includes('javascript')) {
      warnings.push(`Repository "${repo.name}" fell back to default test command "npm test".`);
      checks.push({ category: 'Test Commands', name: repo.name, status: 'warn', message: 'Using default fallback test command "npm test"' });
    } else {
      checks.push({ category: 'Test Commands', name: repo.name, status: 'pass', message: `Test command is "${testCommand}"` });
    }
  }

  // ── 6. Core Artifacts ──────────────────────────────────────────────────
  const featureId = path.basename(workspacePath);
  const coreFiles: Array<{ name: string; exists: () => Promise<boolean> }> = [
    // AGENTS.md first: it is the one file an assistant actually loads, and
    // CLAUDE.md is only an `@AGENTS.md` import of it. Without it a workspace has
    // no context at all, and the import fails silently — so a doctor run that
    // did not check it reported a clean bill of health on a workspace that could
    // tell an assistant nothing.
    { name: 'AGENTS.md', exists: () => workspaceFileExists(workspacePath, featureId, 'AGENTS.md') },
    { name: 'WORKSPACE.md', exists: () => workspaceFileExists(workspacePath, featureId, 'WORKSPACE.md') },
    { name: 'nexusflow-knowledge.md', exists: () => workspaceFileExists(workspacePath, featureId, 'nexusflow-knowledge.md') },
    { name: 'nexusflow-plan.md', exists: () => workspaceFileExists(workspacePath, featureId, 'nexusflow-plan.md') },
  ];
  // Per-repo architecture maps are no longer generated — everything they held
  // came from the repo's package.json — so their absence is not a fault.

  for (const file of coreFiles) {
    if (await file.exists()) {
      checks.push({ category: 'Core Artifacts', name: file.name, status: 'pass', message: 'exists' });
    } else {
      warnings.push(`Missing core workspace artifact: "${file.name}".`);
      checks.push({ category: 'Core Artifacts', name: file.name, status: 'warn', message: 'is missing' });
    }
  }

  const workspaceName = path.basename(workspacePath);
  const codeWorkspacePath = path.join(workspacePath, `${workspaceName}.code-workspace`);
  try {
    await fs.access(codeWorkspacePath);
    checks.push({ category: 'Core Artifacts', name: `${workspaceName}.code-workspace`, status: 'pass', message: 'exists' });
  } catch {
    warnings.push(`Missing ${workspaceName}.code-workspace. VS Code SCM will not show changes inside repo sub-folders. Run \`nexusflow refresh\` to regenerate it.`);
    checks.push({ category: 'Core Artifacts', name: `${workspaceName}.code-workspace`, status: 'warn', message: 'is missing' });
  }

  const vscodeSettingsPath = path.join(workspacePath, '.vscode', 'settings.json');
  try {
    const content = await fs.readFile(vscodeSettingsPath, 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed['search.useIgnoreFiles'] === false) {
      checks.push({ category: 'Core Artifacts', name: '.vscode/settings.json', status: 'pass', message: 'configured correctly (search.useIgnoreFiles: false)' });
    } else {
      warnings.push('.vscode/settings.json search.useIgnoreFiles is not set to false. VS Code global search may ignore repository files.');
      checks.push({ category: 'Core Artifacts', name: '.vscode/settings.json', status: 'warn', message: 'search.useIgnoreFiles is not set to false' });
    }
  } catch {
    warnings.push('Missing .vscode/settings.json. VS Code search might not work properly inside sub-repos.');
    checks.push({ category: 'Core Artifacts', name: '.vscode/settings.json', status: 'warn', message: 'is missing or invalid' });
  }

  // ── 7. AI Assistant CLIs ────────────────────────────────────────────────
  const astMap: Record<string, string> = {
    claude: 'claude',
    codex: 'codex',
    antigravity: 'agy',
    copilot: 'copilot',
    cursor: 'cursor-agent',
  };

  if (feature.assistants && feature.assistants.length > 0) {
    for (const a of feature.assistants) {
      const bin = astMap[a.toLowerCase()] ?? a.toLowerCase();
      const resolved = findExecutable(bin);
      if (!resolved) {
        warnings.push(`Workspace assistant "${a}" (${bin}) is not on system PATH.`);
        checks.push({ category: 'AI Assistants', name: a, status: 'warn', message: `CLI binary "${bin}" is not on PATH` });
      } else {
        checks.push({ category: 'AI Assistants', name: a, status: 'pass', message: `binary "${bin}" is available` });
      }
    }
  }

  // ── 8. System & OS Environment ──────────────────────────────────────────
  const gitBin = findExecutable('git');
  if (gitBin) {
    try {
      const gitVersionRes = await execa('git', ['--version'], { reject: false });
      const versionMatch = gitVersionRes.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
      if (versionMatch) {
        const major = parseInt(versionMatch[1]!, 10);
        const minor = parseInt(versionMatch[2]!, 10);
        if (major < 2 || (major === 2 && minor < 20)) {
          warnings.push(`git version ${versionMatch[0]} is older than recommended (>= 2.20 recommended for worktree operations).`);
          checks.push({ category: 'Environment', name: 'git', status: 'warn', message: `version ${versionMatch[0]} (>= 2.20 recommended)` });
        } else {
          checks.push({ category: 'Environment', name: 'git', status: 'pass', message: `version ${versionMatch[0]} (>= 2.20)` });
        }
      } else {
        checks.push({ category: 'Environment', name: 'git', status: 'pass', message: 'installed and available on PATH' });
      }
    } catch {
      checks.push({ category: 'Environment', name: 'git', status: 'pass', message: 'installed and available on PATH' });
    }
  } else {
    errors.push('git is not found on PATH. Git is required for workspace operations.');
    checks.push({ category: 'Environment', name: 'git', status: 'fail', message: 'git is not on PATH' });
  }

  if (process.platform === 'linux') {
    const xdgOpen = findExecutable('xdg-open');
    if (xdgOpen) {
      checks.push({ category: 'Environment', name: 'xdg-utils', status: 'pass', message: 'xdg-open is available for desktop integration' });
    } else {
      warnings.push('xdg-open is not installed. Installing xdg-utils is recommended for opening browsers and editors on Linux.');
      checks.push({ category: 'Environment', name: 'xdg-utils', status: 'warn', message: 'xdg-open not found (install xdg-utils)' });
    }
  }

  return report();
}
