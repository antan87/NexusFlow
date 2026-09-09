/**
 * @module core/worktree
 * Git worktree operations — create and remove worktrees for feature branches.
 */

import { execa } from 'execa';
import { isValidBranchName } from '../utils/git.js';
import { resolveTrackingBranch, fastForwardBranch } from '../utils/repo-freshness.js';

/** Result of creating a worktree. */
export interface CreateWorktreeResult {
  /**
   * True when this call created a new local branch (`-b`). False when it
   * checked out a branch that already existed. Used by rollback to decide
   * whether deleting the branch is safe.
   */
  createdBranch: boolean;
}

/** Options for {@link createWorktree}. */
export interface CreateWorktreeOptions {
  /**
   * Require `branchName` to already exist (locally or on origin) and fail
   * instead of creating a new branch. Set when the user explicitly picked an
   * existing branch, where silently creating a fresh one would be wrong.
   */
  mustExist?: boolean;
  /**
   * Whether to attempt fast-forwarding the base branch to remote tracking before branching.
   * Defaults to true.
   */
  autoUpdateBase?: boolean;
}

/**
 * Creates a git worktree for a branch, materializing the branch as needed:
 *
 * 1. Resolves remote tracking branch (origin, upstream, etc.) and fetches remote refs.
 * 2. Safely fast-forwards the local base branch if clean and autoUpdateBase is not false.
 * 3. If `branchName` exists locally, check it out into the worktree.
 * 4. Else if `<remote>/<branchName>` exists, create a tracking local branch
 *    from it in the worktree.
 * 5. Else create a new branch from `<remote>/<baseBranch>` (or the local
 *    `baseBranch` when there is no remote).
 *
 * @param repoPath   - Absolute path to the main repo checkout.
 * @param targetPath - Absolute path where the worktree should be created.
 * @param branchName - Branch to check out or create.
 * @param baseBranch - Branch to base a newly created branch on (e.g. 'main').
 * @param options    - See {@link CreateWorktreeOptions}.
 * @returns Whether a new local branch ref was created (vs. checking out an existing one).
 */
export async function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string,
  baseBranch: string,
  options: CreateWorktreeOptions = {},
): Promise<CreateWorktreeResult> {
  if (!isValidBranchName(branchName)) {
    throw new Error(`Invalid branch name "${branchName}".`);
  }
  if (!isValidBranchName(baseBranch)) {
    throw new Error(`Invalid base branch name "${baseBranch}".`);
  }

  // Resolve tracking branch for baseBranch (checks origin, upstream, etc.)
  const { trackingBranch, remoteName, hasRemote } = await resolveTrackingBranch(
    repoPath,
    baseBranch,
  );

  // If remote exists and autoUpdateBase is enabled, safely fast-forward clean repos
  if (hasRemote && options.autoUpdateBase !== false) {
    try {
      await fastForwardBranch(repoPath, baseBranch);
    } catch {
      // Best-effort fast-forward; uncommitted work is preserved on dirty trees
    }
  }

  // Determine starting point: remote tracking ref if verified, else local baseBranch
  let startPoint = baseBranch;
  if (hasRemote && trackingBranch) {
    try {
      await execa('git', ['rev-parse', '--verify', `refs/remotes/${trackingBranch}`], {
        cwd: repoPath,
      });
      startPoint = trackingBranch;
    } catch {
      // remote tracking branch does not exist, fallback to local branch
    }
  }

  // Check if the target branch already exists locally
  let branchExists = false;
  try {
    await execa('git', ['rev-parse', '--verify', `refs/heads/${branchName}`], { cwd: repoPath });
    branchExists = true;
  } catch {
    // Branch does not exist locally
  }

  // Check for a remote-only branch (<remote>/<branchName> without a local ref).
  let remoteBranchExists = false;
  let remoteRefToTrack = `origin/${branchName}`;
  if (!branchExists && hasRemote) {
    const targetTracking = await resolveTrackingBranch(repoPath, branchName);
    if (targetTracking.trackingBranch) {
      try {
        await execa('git', ['rev-parse', '--verify', `refs/remotes/${targetTracking.trackingBranch}`], {
          cwd: repoPath,
        });
        remoteBranchExists = true;
        remoteRefToTrack = targetTracking.trackingBranch;
      } catch {
        // Branch does not exist on remote either
      }
    }
  }

  if (options.mustExist && !branchExists && !remoteBranchExists) {
    throw new Error(
      `Branch "${branchName}" does not exist locally or on origin in ${repoPath}.`,
    );
  }

  // Create the worktree
  if (branchExists) {
    // If the branch already exists, checkout the existing branch
    await execa(
      'git',
      ['worktree', 'add', targetPath, branchName],
      { cwd: repoPath },
    );
  } else if (remoteBranchExists) {
    // Materialize the remote-only branch as a local tracking branch. The local
    // ref is new, so rollback may delete it — the remote still has the branch.
    await execa(
      'git',
      ['worktree', 'add', '--track', '-b', branchName, targetPath, remoteRefToTrack],
      { cwd: repoPath },
    );
  } else {
    // If the branch does not exist, create a new branch based on the start point without tracking it
    await execa(
      'git',
      ['worktree', 'add', '--no-track', targetPath, '-b', branchName, startPoint],
      { cwd: repoPath },
    );
  }

  return { createdBranch: !branchExists };
}

/**
 * Removes an existing git worktree.
 *
 * Runs `git worktree remove [--force] <worktreePath>` from the main repo.
 *
 * @param repoPath     - Absolute path to the main repo checkout.
 * @param worktreePath - Absolute path to the worktree to remove.
 * @param force        - Whether to force removal (cleanly removes modified files).
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = false,
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) {
    args.push('--force');
  }
  args.push(worktreePath);
  await execa('git', args, { cwd: repoPath });
}

