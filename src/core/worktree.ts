/**
 * @module core/worktree
 * Git worktree operations — create and remove worktrees for feature branches.
 */

import { execa } from 'execa';

/** Result of creating a worktree. */
export interface CreateWorktreeResult {
  /**
   * True when this call created a new local branch (`-b`). False when it
   * checked out a branch that already existed. Used by rollback to decide
   * whether deleting the branch is safe.
   */
  createdBranch: boolean;
}

/**
 * Creates a new git worktree for a feature branch.
 *
 * Runs:
 * 1. `git fetch origin` — ensure we have the latest remote refs.
 * 2. `git worktree add <targetPath> -b <branchName> origin/<baseBranch>`
 *
 * @param repoPath   - Absolute path to the main repo checkout.
 * @param targetPath - Absolute path where the worktree should be created.
 * @param branchName - Name of the new local branch to create.
 * @param baseBranch - Remote branch to base the new branch on (e.g. 'main').
 * @returns Whether a new branch was created (vs. checking out an existing one).
 */
export async function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string,
  baseBranch: string,
): Promise<CreateWorktreeResult> {
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
            // Safe fast-forward pull for the currently checked-out branch
            await execa('git', ['pull', '--ff-only'], { cwd: repoPath });
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
    await execa('git', ['rev-parse', '--verify', branchName], { cwd: repoPath });
    branchExists = true;
  } catch {
    // Branch does not exist locally
  }

  // Create the worktree
  if (branchExists) {
    // If the branch already exists, checkout the existing branch
    await execa(
      'git',
      ['worktree', 'add', targetPath, branchName],
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

