/**
 * @module core/isolate
 * Provides on-demand worktree isolation for repositories in in-place workspaces.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import { createWorktree, removeWorktree } from './worktree.js';
import { loadFeatureConfig, saveFeatureConfig } from './workspace.js';
import { refreshWorkspace } from './refresh.js';
import { acquireLock, type ReleaseLock } from './locks.js';
import { detectDefaultBranch, isValidBranchName } from '../utils/git.js';
import { isInPlace } from '../utils/feature.js';
import type { Feature, IsolatedRepoInfo } from '../types.js';
import { assertWorkspaceActive } from './archive-guard.js';

export interface IsolateRepoOptions {
  /** Target feature branch name to create/checkout in the worktree. */
  branchName?: string;
  /** Base branch to branch off (defaults to repo's default branch). */
  baseBranch?: string;
}

export interface IsolateRepoResult {
  repoName: string;
  sourcePath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  alreadyIsolated: boolean;
}

/** What {@link isolateWorkspaceRepo} would do, computed without changing anything. */
export interface IsolationPlan extends IsolateRepoResult {
  /**
   * Reasons isolation cannot proceed (path or branch collisions, a missing
   * base). Isolation refuses to start while any are present, so a collision
   * never leaves a half-created worktree or touches the source checkout.
   */
  conflicts: string[];
}

/** Raised when an isolation plan has conflicts; nothing was changed. */
export class IsolationConflictError extends Error {
  readonly code = 'ISOLATION_CONFLICT';
  constructor(readonly plan: IsolationPlan) {
    super(`Cannot prepare "${plan.repoName}" for editing: ${plan.conflicts.join(' ')}`);
    this.name = 'IsolationConflictError';
  }
}

function assertWithin(baseDir: string, target: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Target path "${target}" escapes workspace base directory "${baseDir}".`);
  }
  return resolved;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Branch → checkout path for every worktree registered on the source repository. */
async function checkedOutBranches(sourcePath: string): Promise<Map<string, string>> {
  const branches = new Map<string, string>();
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: sourcePath, reject: false });
  let current = '';
  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) current = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/')) branches.set(line.slice('branch refs/heads/'.length), current);
  }
  return branches;
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoPath, reject: false });
  return result.exitCode === 0;
}

/**
 * Computes where and on which branch a repository would be prepared for
 * editing, and whether anything is in the way. Read-only: it neither fetches
 * nor prunes, so it is safe to call for a confirmation preview.
 *
 * @param workspacePath  - Absolute path to the workspace directory.
 * @param repoNameOrPath - Name or absolute path of the repository to isolate.
 * @param options        - Branch and base branch options.
 */
export async function planRepoIsolation(
  workspacePath: string,
  repoNameOrPath: string,
  options: IsolateRepoOptions = {},
): Promise<IsolationPlan> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace manifest not found at ${workspacePath}`);
  }
  assertWorkspaceActive(feature, 'prepare repositories for editing');

  const trimmed = repoNameOrPath.trim();
  if (!trimmed || /[\r\n]/.test(trimmed)) {
    throw new Error(`Invalid repository name or path: "${repoNameOrPath}".`);
  }

  const normalizedTarget = path.normalize(trimmed).toLowerCase();
  const targetBasename = path.basename(trimmed).toLowerCase();

  // Match against feature.repos (case-insensitive for Windows resilience)
  const repoIndex = feature.repos.findIndex((r) => {
    const norm = path.normalize(r).toLowerCase();
    return norm === normalizedTarget || path.basename(r).toLowerCase() === targetBasename;
  });

  if (repoIndex === -1) {
    throw new Error(`Repository "${repoNameOrPath}" is not part of workspace "${feature.id}".`);
  }

  const repoEntry = feature.repos[repoIndex]!;
  const repoName = path.basename(repoEntry);
  const sourcePath = feature.originalRepos?.[repoIndex] ?? repoEntry;

  // If not in-place mode, all repos are already isolated worktrees
  if (!isInPlace(feature)) {
    return {
      repoName,
      sourcePath,
      worktreePath: path.resolve(workspacePath, repoName),
      branchName: feature.repoBranches?.[repoName] ?? feature.branchName,
      baseBranch: await detectDefaultBranch(sourcePath),
      alreadyIsolated: true,
      conflicts: [],
    };
  }

  // Case-insensitive lookup for existing isolation
  const isolatedKey = Object.keys(feature.isolatedRepos || {}).find(
    (k) => k.toLowerCase() === repoName.toLowerCase() || k.toLowerCase() === trimmed.toLowerCase(),
  );
  const existingIsolation = isolatedKey ? feature.isolatedRepos?.[isolatedKey] : undefined;
  if (existingIsolation && await pathExists(existingIsolation.worktreePath)) {
    return {
      repoName,
      sourcePath,
      worktreePath: existingIsolation.worktreePath,
      branchName: existingIsolation.branchName,
      baseBranch: existingIsolation.baseBranch ?? (await detectDefaultBranch(sourcePath)),
      alreadyIsolated: true,
      conflicts: [],
    };
  }

  const defaultBranch = await detectDefaultBranch(sourcePath);
  const baseBranch = options.baseBranch || defaultBranch || 'main';
  const branchName =
    options.branchName ||
    (feature.branchName && feature.branchName !== feature.id
      ? feature.branchName
      : `feat/${repoName}-${feature.id}`);

  if (!isValidBranchName(branchName)) {
    throw new Error(`Invalid branch name "${branchName}".`);
  }
  if (!isValidBranchName(baseBranch)) {
    throw new Error(`Invalid base branch name "${baseBranch}".`);
  }

  const worktreePath = assertWithin(workspacePath, path.join(workspacePath, repoName));
  const conflicts: string[] = [];
  if (await pathExists(worktreePath)) {
    conflicts.push(`A folder already exists at ${worktreePath}. Move or remove it first.`);
  }
  const checkedOut = await checkedOutBranches(sourcePath);
  const branchLocation = checkedOut.get(branchName);
  if (branchLocation) {
    conflicts.push(`Branch "${branchName}" is already checked out at ${branchLocation}. Choose another branch name.`);
  }
  const baseKnown = (await refExists(sourcePath, baseBranch))
    || (await refExists(sourcePath, `refs/remotes/origin/${baseBranch}`));
  if (!baseKnown) {
    conflicts.push(`Base branch "${baseBranch}" was not found in ${sourcePath}.`);
  }

  return { repoName, sourcePath, worktreePath, branchName, baseBranch, alreadyIsolated: false, conflicts };
}

/**
 * Prepares a reference repository for editing: creates a dedicated worktree
 * inside the workspace on its own branch.
 *
 * If the workspace is in worktree mode, or the repository is already isolated,
 * this is a safe no-op that returns existing isolation details. The source
 * checkout is never changed: its branch, working tree and local base branch
 * stay as they were (the worktree starts from the remote base when one exists).
 *
 * @param workspacePath  - Absolute path to the workspace directory.
 * @param repoNameOrPath - Name or absolute path of the repository to isolate.
 * @param options        - Branch and base branch options.
 * @throws {IsolationConflictError} When a path or branch collision is detected.
 */
export async function isolateWorkspaceRepo(
  workspacePath: string,
  repoNameOrPath: string,
  options: IsolateRepoOptions = {},
): Promise<IsolateRepoResult> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace manifest not found at ${workspacePath}`);
  }
  assertWorkspaceActive(feature, 'prepare repositories for editing');

  // A recorded worktree whose directory vanished: drop the stale registration
  // so planning sees the real state.
  const requestedName = path.basename(repoNameOrPath.trim()).toLowerCase();
  const stale = Object.entries(feature.isolatedRepos ?? {})
    .find(([key]) => key.toLowerCase() === requestedName)?.[1];
  if (stale && !(await pathExists(stale.worktreePath))) {
    const index = feature.repos.findIndex((r) => path.basename(r).toLowerCase() === requestedName);
    const source = index >= 0 ? feature.originalRepos?.[index] ?? feature.repos[index] : undefined;
    if (source) await execa('git', ['worktree', 'prune'], { cwd: source }).catch(() => {});
  }

  const plan = await planRepoIsolation(workspacePath, repoNameOrPath, options);
  const { repoName, sourcePath, worktreePath, branchName, baseBranch } = plan;
  if (plan.alreadyIsolated) {
    const { conflicts: _conflicts, ...result } = plan;
    return result;
  }
  if (plan.conflicts.length > 0) {
    throw new IsolationConflictError(plan);
  }

  // Prune any stale worktree registrations prior to creation
  try {
    await execa('git', ['worktree', 'prune'], { cwd: sourcePath });
  } catch {}

  let worktreeCreated = false;
  let branchCreated = false;

  try {
    // 1. Create the git worktree
    // Never fast-forward the source repository's base branch: that would change
    // the user's own checkout. The worktree starts from the remote base instead.
    const wtRes = await createWorktree(sourcePath, worktreePath, branchName, baseBranch, { autoUpdateBase: false });
    worktreeCreated = true;
    branchCreated = wtRes.createdBranch;

    // 2. Update .gitignore in workspace root to ignore the newly created worktree folder
    try {
      const gitignorePath = path.join(workspacePath, '.gitignore');
      let gitignoreContent = '';
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      } catch {}

      const entry = `/${repoName}/`;
      if (!gitignoreContent.includes(entry)) {
        await fs.writeFile(
          gitignorePath,
          gitignoreContent ? `${gitignoreContent.trimEnd()}\n${entry}\n` : `${entry}\n`,
          'utf-8',
        );
      }
    } catch (error) {
      console.warn(`Warning: failed to update .gitignore for isolated repo ${repoName}:`, error);
    }

    // 3. Atomically update manifest using freshest state with lock
    const lockPath = path.join(workspacePath, '.isolate.lock');
    let releaseLock: ReleaseLock | null = null;
    try {
      releaseLock = await acquireLock(lockPath, {
        staleMs: 10_000,
        timeoutMs: 15_000,
        timeoutMessage: 'Timed out acquiring lock to update workspace manifest',
      });
    } catch {
      // If locking fails, proceed best-effort
    }

    try {
      const freshFeature = (await loadFeatureConfig(workspacePath)) ?? feature;
      if (!freshFeature.isolatedRepos) {
        freshFeature.isolatedRepos = {};
      }
      const isolatedInfo: IsolatedRepoInfo = {
        worktreePath,
        branchName,
        baseBranch,
        isolatedAt: new Date().toISOString(),
      };
      freshFeature.isolatedRepos[repoName] = isolatedInfo;
      // Provenance: archive deletes only branches this workspace created.
      if (branchCreated) freshFeature.createdBranches = { ...freshFeature.createdBranches, [repoName]: branchName };
      await saveFeatureConfig(workspacePath, freshFeature);
    } finally {
      if (releaseLock) {
        await releaseLock().catch(() => {});
      }
    }

    // 4. Refresh workspace context files (.code-workspace, AGENTS.md, etc.)
    try {
      await refreshWorkspace(workspacePath);
    } catch (error) {
      console.warn(`Warning: failed to refresh workspace context after isolating ${repoName}:`, error);
    }

    return {
      repoName,
      sourcePath,
      worktreePath,
      branchName,
      baseBranch,
      alreadyIsolated: false,
    };
  } catch (error) {
    if (worktreeCreated) {
      try {
        await removeWorktree(sourcePath, worktreePath, true);
      } catch {}
      if (branchCreated) {
        try {
          await execa('git', ['branch', '-D', branchName], { cwd: sourcePath });
        } catch {}
      }
    }
    throw error;
  }
}
