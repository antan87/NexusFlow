/**
 * @module core/scanner
 * Scans a development directory tree for git repositories.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RepoInfo } from '../types.js';
import { detectDefaultBranch, isGitRepo } from '../utils/git.js';

/** Directory names to skip while scanning. */
const IGNORED_DIRS = new Set(['node_modules', 'workspaces', '.git']);

/**
 * Recursively scans {@link devDir} for directories containing a `.git`
 * entry, up to the given {@link depth}.
 *
 * Skips `node_modules`, `workspaces`, and `.git` directories to keep
 * scans fast and relevant.
 *
 * @param devDir - Absolute path to the root directory to scan.
 * @param depth  - Maximum directory depth to descend (0 = only devDir itself).
 * @returns An array of discovered {@link RepoInfo} objects.
 */
export async function scanForRepos(
  devDir: string,
  depth: number,
): Promise<RepoInfo[]> {
  const repos: RepoInfo[] = [];
  await walk(devDir, depth, repos);
  return repos;
}

/**
 * Internal recursive walker.
 *
 * When a directory is itself a git repo it is recorded and its children are
 * **not** descended into (a repo inside a repo is unusual and almost always
 * unintentional).
 */
async function walk(
  dir: string,
  remainingDepth: number,
  results: RepoInfo[],
): Promise<void> {
  // Check if the current directory is a git repo.
  if (await isGitRepo(dir)) {
    const defaultBranch = await detectDefaultBranch(dir);
    results.push({
      name: path.basename(dir),
      path: dir,
      defaultBranch,
    });
    // Don't recurse into a repo's subdirectories.
    return;
  }

  if (remainingDepth <= 0) {
    return;
  }

  // Read children and recurse.
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Permission denied or directory disappeared — skip silently.
    return;
  }

  const tasks: Promise<void>[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    // Skip hidden directories (except we already handle .git above).
    if (entry.name.startsWith('.')) {
      continue;
    }

    tasks.push(walk(path.join(dir, entry.name), remainingDepth - 1, results));
  }

  await Promise.all(tasks);
}
