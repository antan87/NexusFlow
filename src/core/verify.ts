/**
 * @module core/verify
 * Mechanical verification gate for repositories in a ContextSpace workspace.
 *
 * Runs detected or configured test commands, captures process exit codes,
 * execution duration, stdout/stderr, and anchors validation proof to the Git
 * HEAD commit SHA and working-tree clean status.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import type {
  RepoVerificationReport,
  VerificationStatus,
  WorkspaceVerificationReport,
} from '../types.js';
import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { resolveFeatureRepoPath } from '../utils/feature.js';
import { getRepoStatus } from '../utils/multi-git.js';
import { recordVerificationReport } from './workspace-state.js';
import { resolveActiveDomainRules, getDomainPack } from './domain-packs.js';

export interface VerifyCommandSpec {
  command: string;
  args: string[];
  runner: string;
}

export interface VerifyRepoOptions {
  filter?: string;
  command?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  allowDirty?: boolean;
}

export interface VerifyWorkspaceOptions extends VerifyRepoOptions {
  repoName?: string;
  tag?: string;
}

/**
 * Checks whether a file exists at the given path.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects the appropriate test command and runner for a repository path.
 */
export async function detectTestCommand(
  repoPath: string,
  preferredCommand?: string,
): Promise<VerifyCommandSpec | null> {
  if (preferredCommand && preferredCommand.trim()) {
    const parts = preferredCommand.trim().split(/\s+/);
    return {
      command: parts[0]!,
      args: parts.slice(1),
      runner: 'custom',
    };
  }

  // 1. Node.js / JavaScript / TypeScript
  const pkgPath = path.join(repoPath, 'package.json');
  if (await fileExists(pkgPath)) {
    try {
      const raw = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      if (pkg.scripts && typeof pkg.scripts.test === 'string') {
        if (await fileExists(path.join(repoPath, 'pnpm-lock.yaml'))) {
          return { command: 'pnpm', args: ['test'], runner: 'pnpm' };
        }
        if (await fileExists(path.join(repoPath, 'yarn.lock'))) {
          return { command: 'yarn', args: ['test'], runner: 'yarn' };
        }
        if (
          (await fileExists(path.join(repoPath, 'bun.lockb'))) ||
          (await fileExists(path.join(repoPath, 'bun.lock')))
        ) {
          return { command: 'bun', args: ['test'], runner: 'bun' };
        }
        return { command: 'npm', args: ['test'], runner: 'npm' };
      }
    } catch {
      // Ignore parse failure; continue detection
    }
  }

  // 2. Rust
  if (await fileExists(path.join(repoPath, 'Cargo.toml'))) {
    return { command: 'cargo', args: ['test'], runner: 'cargo' };
  }

  // 3. Go
  if (await fileExists(path.join(repoPath, 'go.mod'))) {
    return { command: 'go', args: ['test', './...'], runner: 'go' };
  }

  // 4. Python
  if (
    (await fileExists(path.join(repoPath, 'pytest.ini'))) ||
    (await fileExists(path.join(repoPath, 'pyproject.toml'))) ||
    (await fileExists(path.join(repoPath, 'setup.cfg'))) ||
    (await fileExists(path.join(repoPath, 'tests')))
  ) {
    return { command: 'pytest', args: [], runner: 'pytest' };
  }

  // 5. Makefile
  const makefilePath = path.join(repoPath, 'Makefile');
  if (await fileExists(makefilePath)) {
    try {
      const makeContent = await fs.readFile(makefilePath, 'utf-8');
      if (/^test\s*:/m.test(makeContent)) {
        return { command: 'make', args: ['test'], runner: 'make' };
      }
    } catch {
      // Ignore
    }
  }

  // 6. Java (Maven / Gradle)
  if (await fileExists(path.join(repoPath, 'pom.xml'))) {
    return { command: 'mvn', args: ['test'], runner: 'maven' };
  }
  if (
    (await fileExists(path.join(repoPath, 'build.gradle'))) ||
    (await fileExists(path.join(repoPath, 'build.gradle.kts')))
  ) {
    const hasWrapper = await fileExists(path.join(repoPath, 'gradlew'));
    return { command: hasWrapper ? './gradlew' : 'gradle', args: ['test'], runner: 'gradle' };
  }

  // 7. .NET / C#
  try {
    const entries = await fs.readdir(repoPath);
    if (entries.some((e) => e.endsWith('.sln') || e.endsWith('.csproj'))) {
      return { command: 'dotnet', args: ['test'], runner: 'dotnet' };
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Builds the arguments list including any test filter.
 */
function buildArgsWithFilter(spec: VerifyCommandSpec, filter?: string): string[] {
  if (!filter || !filter.trim()) return [...spec.args];
  const trimmed = filter.trim();

  switch (spec.runner) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return [...spec.args, '--', trimmed];
    case 'cargo':
      return [...spec.args, '--', trimmed];
    case 'pytest':
      return [...spec.args, '-k', trimmed];
    case 'go':
      return ['test', '-run', trimmed, './...'];
    case 'dotnet':
      return [...spec.args, '--filter', trimmed];
    default:
      return [...spec.args, trimmed];
  }
}

/**
 * Runs mechanical verification for a single repository.
 */
export async function verifyRepo(
  repoPath: string,
  repoName: string,
  options: VerifyRepoOptions = {},
): Promise<RepoVerificationReport> {
  const verifiedAt = new Date().toISOString();
  let headSha = 'unknown';
  let clean = true;
  let dirtyFiles: string[] = [];

  try {
    const { stdout: shaOut } = await execa('git', ['rev-parse', 'HEAD'], { cwd: repoPath });
    headSha = shaOut.trim();
  } catch {
    // Graceful fallback for non-git directories
  }

  try {
    const repoStatus = await getRepoStatus(repoPath);
    clean = !repoStatus.hasChanges;
    dirtyFiles = repoStatus.files.map((f) => f.path);
  } catch {
    // Graceful fallback
  }

  const spec = await detectTestCommand(repoPath, options.command);
  if (!spec) {
    return {
      repoName,
      repoPath,
      status: 'no-tests',
      command: 'none',
      exitCode: null,
      headSha,
      clean,
      dirtyFiles: dirtyFiles.length > 0 ? dirtyFiles : undefined,
      durationMs: 0,
      verifiedAt,
    };
  }

  const finalArgs = buildArgsWithFilter(spec, options.filter);
  const fullCommandStr = `${spec.command} ${finalArgs.join(' ')}`.trim();
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 300_000;

  try {
    const result = await execa(spec.command, finalArgs, {
      cwd: repoPath,
      reject: false,
      timeout: timeoutMs,
      env: {
        ...process.env,
        CI: 'true',
        ...(options.env ?? {}),
      },
    });

    const durationMs = Date.now() - startTime;
    const exitCode = result.exitCode ?? (result.timedOut ? 124 : 1);

    let status: VerificationStatus;
    if (result.timedOut) {
      status = 'timeout';
    } else if (exitCode === 0) {
      status = clean ? 'pass' : 'pass_dirty';
    } else {
      status = 'fail';
    }

    return {
      repoName,
      repoPath,
      status,
      command: fullCommandStr,
      exitCode,
      headSha,
      clean,
      dirtyFiles: dirtyFiles.length > 0 ? dirtyFiles : undefined,
      durationMs,
      stdout: result.stdout ? result.stdout.slice(-10000) : undefined,
      stderr: result.stderr ? result.stderr.slice(-10000) : undefined,
      verifiedAt,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    return {
      repoName,
      repoPath,
      status: 'fail',
      command: fullCommandStr,
      exitCode: 1,
      headSha,
      clean,
      dirtyFiles: dirtyFiles.length > 0 ? dirtyFiles : undefined,
      durationMs,
      error: err.message,
      verifiedAt,
    };
  }
}

/**
 * Runs mechanical verification for an entire workspace.
 */
export async function verifyWorkspace(
  workspacePath: string,
  options: VerifyWorkspaceOptions = {},
): Promise<WorkspaceVerificationReport> {
  const verifiedAt = new Date().toISOString();
  const startTime = Date.now();

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace configuration not found at ${workspacePath}`);
  }

  const resolvedPaths = feature.repos.map((r) => resolveFeatureRepoPath(feature, workspacePath, r));
  const repoInfos = await resolveRepoInfos(resolvedPaths);

  const targets = options.repoName
    ? repoInfos.filter((r) => r.name === options.repoName)
    : repoInfos;

  if (options.repoName && targets.length === 0) {
    throw new Error(`Repository "${options.repoName}" not found in workspace.`);
  }

  const domainRules = resolveActiveDomainRules(feature.organizationId, feature.domainPacks ?? []);
  let domainVerifyCmd: string | undefined = undefined;
  if (options.tag) {
    const pack = getDomainPack(options.tag);
    if (!pack) {
      throw new Error(`Category / tag pack "${options.tag}" not found.`);
    }
    domainVerifyCmd = pack.verifyCommand;
  } else if (domainRules.compositeVerifyCommand) {
    domainVerifyCmd = domainRules.compositeVerifyCommand;
  }

  const repoReports: RepoVerificationReport[] = [];
  for (const target of targets) {
    const customCommand =
      options.command ?? domainVerifyCmd ?? feature.resumption?.verifyCommand ?? feature.resumption?.testCommand;
    const report = await verifyRepo(target.path, target.name, {
      ...options,
      command: customCommand,
    });
    repoReports.push(report);
  }

  let overallStatus: VerificationStatus = 'pass';
  if (repoReports.some((r) => r.status === 'fail')) {
    overallStatus = 'fail';
  } else if (repoReports.some((r) => r.status === 'timeout')) {
    overallStatus = 'timeout';
  } else if (repoReports.some((r) => r.status === 'pass_dirty')) {
    overallStatus = 'pass_dirty';
  } else if (repoReports.every((r) => r.status === 'no-tests')) {
    overallStatus = 'no-tests';
  }

  const canProgress =
    overallStatus === 'pass' ||
    overallStatus === 'no-tests' ||
    (overallStatus === 'pass_dirty' && options.allowDirty === true);

  const totalDurationMs = Date.now() - startTime;
  const workspaceReport: WorkspaceVerificationReport = {
    workspacePath,
    overallStatus,
    canProgress,
    verifiedAt,
    durationMs: totalDurationMs,
    repos: repoReports,
  };

  // Record verification proof in workspace state
  await recordVerificationReport(workspacePath, workspaceReport);

  return workspaceReport;
}
