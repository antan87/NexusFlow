/**
 * @module utils/git
 * Low-level git helper functions used throughout NexusFlow.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

/**
 * Checks whether the given directory is a git repository
 * by testing for the presence of a `.git` entry.
 *
 * @param dirPath - Absolute path to the directory.
 * @returns `true` if a `.git` file or directory exists.
 */
export async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const gitPath = path.join(dirPath, '.git');
    await fs.access(gitPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs `git fetch origin` inside the given repository.
 *
 * @param repoPath - Absolute path to the repo root.
 */
export async function gitFetch(repoPath: string): Promise<void> {
  await execa('git', ['fetch', 'origin'], { cwd: repoPath });
}

/**
 * Detects the default branch of a repository by inspecting remote branches.
 * Prefers `main` over `master`. Falls back to `'main'` when neither is found.
 *
 * @param repoPath - Absolute path to the repo root.
 * @returns The name of the default branch.
 */
export async function detectDefaultBranch(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['branch', '-r'], { cwd: repoPath });
    const branches = stdout.split('\n').map((b) => b.trim());

    if (branches.some((b) => b === 'origin/main' || b.endsWith('/origin/main'))) {
      return 'main';
    }

    if (branches.some((b) => b === 'origin/master' || b.endsWith('/origin/master'))) {
      return 'master';
    }

    // Fallback — assume main.
    return 'main';
  } catch {
    return 'main';
  }
}
