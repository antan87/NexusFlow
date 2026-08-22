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

function assertWithin(baseDir: string, target: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`Target path "${target}" escapes workspace base directory "${baseDir}".`);
  }
  return resolved;
}

/**
 * Dynamically isolates a repository in an in-place workspace into a dedicated
 * worktree directory inside the workspace.
 *
 * If the workspace is in worktree mode, or the repository is already isolated,
 * this is a safe no-op that returns existing isolation details.
 *
 * @param workspacePath  - Absolute path to the workspace directory.
 * @param repoNameOrPath - Name or absolute path of the repository to isolate.
 * @param options        - Branch and base branch options.
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
    const worktreePath = path.resolve(workspacePath, repoName);
    return {
      repoName,
      sourcePath,
      worktreePath,
      branchName: feature.repoBranches?.[repoName] ?? feature.branchName,
      baseBranch: await detectDefaultBranch(sourcePath),
      alreadyIsolated: true,
    };
  }

  // Case-insensitive lookup for existing isolation
  const isolatedKey = Object.keys(feature.isolatedRepos || {}).find(
    (k) => k.toLowerCase() === repoName.toLowerCase() || k.toLowerCase() === trimmed.toLowerCase(),
  );
  const existingIsolation = isolatedKey ? feature.isolatedRepos?.[isolatedKey] : undefined;

  if (existingIsolation) {
    try {
      await fs.access(existingIsolation.worktreePath);
      return {
        repoName,
        sourcePath,
        worktreePath: existingIsolation.worktreePath,
        branchName: existingIsolation.branchName,
        baseBranch: existingIsolation.baseBranch ?? (await detectDefaultBranch(sourcePath)),
        alreadyIsolated: true,
      };
    } catch {
      // Directory no longer exists on disk; prune worktree registration and recreate
      try {
        await execa('git', ['worktree', 'prune'], { cwd: sourcePath });
      } catch {}
    }
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

  // Prune any stale worktree registrations prior to creation
  try {
    await execa('git', ['worktree', 'prune'], { cwd: sourcePath });
  } catch {}

  let worktreeCreated = false;
  let branchCreated = false;

  try {
    // 1. Create the git worktree
    const wtRes = await createWorktree(sourcePath, worktreePath, branchName, baseBranch);
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
