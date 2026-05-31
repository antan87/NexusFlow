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
  // Fetch latest remote state.
  await execa('git', ['fetch', 'origin'], { cwd: repoPath });

  // Create the worktree with a new branch based on the remote base branch.
  await execa(
    'git',
    ['worktree', 'add', targetPath, '-b', branchName, `origin/${baseBranch}`],
    { cwd: repoPath },
  );
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
