/**
 * @module core/isolate
 * Provides on-demand worktree isolation for repositories in in-place workspaces.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { createWorktree } from './worktree.js';
import { loadFeatureConfig, saveFeatureConfig, excludeNexusFlowFiles } from './workspace.js';
import { refreshWorkspace } from './refresh.js';
import { detectDefaultBranch } from '../utils/git.js';
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

  const normalizedTarget = path.normalize(repoNameOrPath).toLowerCase();
  const targetBasename = path.basename(repoNameOrPath).toLowerCase();

  // Match against feature.repos
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

  // Check if already isolated
  const existingIsolation = feature.isolatedRepos?.[repoName];
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
      // Directory no longer exists; recreate below
    }
  }

  const defaultBranch = await detectDefaultBranch(sourcePath);
  const baseBranch = options.baseBranch || defaultBranch || 'main';
  const branchName =
    options.branchName ||
    (feature.branchName && feature.branchName !== feature.id
      ? feature.branchName
      : `feat/${repoName}-${feature.id}`);

  const worktreePath = path.join(workspacePath, repoName);

  // 1. Create the git worktree
  await createWorktree(sourcePath, worktreePath, branchName, baseBranch);

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

  // 3. Update manifest
  if (!feature.isolatedRepos) {
    feature.isolatedRepos = {};
  }
  const isolatedInfo: IsolatedRepoInfo = {
    worktreePath,
    branchName,
    baseBranch,
    isolatedAt: new Date().toISOString(),
  };
  feature.isolatedRepos[repoName] = isolatedInfo;
  await saveFeatureConfig(workspacePath, feature);

  // 4. Exclude NexusFlow files for the new worktree checkout
  try {
    await excludeNexusFlowFiles(workspacePath, feature);
  } catch {}

  // 5. Refresh workspace context files (.code-workspace, AGENTS.md, etc.)
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
}
