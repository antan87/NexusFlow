/**
 * @module core/worktree
 * Git worktree operations — create and remove worktrees for feature branches.
 */

import { execa } from 'execa';

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
 */
export async function createWorktree(
  repoPath: string,
  targetPath: string,
  branchName: string,
  baseBranch: string,
): Promise<void> {
  let fetched = false;
  // Fetch latest remote state.
  try {
    await execa('git', ['fetch', 'origin'], { cwd: repoPath });
    fetched = true;
  } catch {
    // Silently ignore fetch failures (e.g., offline or no remote origin)
  }

  // Update local baseBranch to keep it in sync with remote before branching
  if (fetched) {
    try {
      // Find out if the main repo currently has baseBranch checked out
      const { stdout: currentBranch } = await execa('git', ['branch', '--show-current'], { cwd: repoPath });
      if (currentBranch.trim() === baseBranch) {
        // Safe fast-forward pull
        await execa('git', ['pull', '--ff-only'], { cwd: repoPath });
      } else {
        // Fast-forward local ref from remote ref without checkout
        await execa('git', ['fetch', 'origin', `${baseBranch}:${baseBranch}`], { cwd: repoPath });
      }
    } catch {
      // Ignore failures (e.g. non-fast-forward, uncommitted changes, or no upstream tracking branch)
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
    // If the branch does not exist, create a new branch based on the start point
    await execa(
      'git',
      ['worktree', 'add', targetPath, '-b', branchName, startPoint],
      { cwd: repoPath },
    );
  }
}

/**
 * Removes an existing git worktree.
 *
 * Runs `git worktree remove <worktreePath>` from the main repo.
 *
 * @param repoPath     - Absolute path to the main repo checkout.
 * @param worktreePath - Absolute path to the worktree to remove.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
): Promise<void> {
  await execa('git', ['worktree', 'remove', worktreePath], { cwd: repoPath });
}
