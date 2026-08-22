/**
 * @module core/worktree
 * Git worktree operations — create and remove worktrees for feature branches.
 */

import { execa } from 'execa';
import { isValidBranchName } from '../utils/git.js';

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
}

/**
 * Creates a git worktree for a branch, materializing the branch as needed:
 *
 * 1. `git fetch origin` — ensure we have the latest remote refs.
 * 2. If `branchName` exists locally, check it out into the worktree.
 * 3. Else if `origin/<branchName>` exists, create a tracking local branch
 *    from it in the worktree.
 * 4. Else create a new branch from `origin/<baseBranch>` (or the local
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

  let fetched = false;
  // Fetch latest remote state.
  try {
    await execa('git', ['fetch', 'origin'], { cwd: repoPath });
    fetched = true;
  } catch {
    // Silently ignore fetch failures (e.g., offline or no remote origin)
  }

  // Update local base branch, main, and master to keep them in sync with remote before branching
  if (fetched) {
    try {
      const { stdout: currentBranchRaw } = await execa('git', ['branch', '--show-current'], { cwd: repoPath });
      const currentBranch = currentBranchRaw.trim();
      
      const branchesToUpdate = Array.from(new Set([baseBranch, 'main', 'master']));
      
      for (const branch of branchesToUpdate) {
        try {
          if (currentBranch === branch) {
            // Safe fast-forward merge from remote tracking branch for the currently checked-out branch
            await execa('git', ['merge', '--ff-only', `origin/${branch}`], { cwd: repoPath });
          } else {
            // Fast-forward local ref from remote ref without checkout
            await execa('git', ['fetch', 'origin', `${branch}:${branch}`], { cwd: repoPath });
          }
        } catch {
          // Ignore individual branch update failures
        }
      }
    } catch {
      // Ignore failures
    }
  }

  // Determine starting point: remote branch if fetched successfully and exists, else local branch.
  let startPoint = baseBranch;
  if (fetched) {
    try {
      await execa('git', ['rev-parse', '--verify', `origin/${baseBranch}`], { cwd: repoPath });
      startPoint = `origin/${baseBranch}`;
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

  // Check for a remote-only branch (origin/<branchName> without a local ref).
  let remoteBranchExists = false;
  if (!branchExists) {
    try {
      await execa('git', ['rev-parse', '--verify', `refs/remotes/origin/${branchName}`], { cwd: repoPath });
      remoteBranchExists = true;
    } catch {
      // Branch does not exist on origin either
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
      ['worktree', 'add', '--track', '-b', branchName, targetPath, `origin/${branchName}`],
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

