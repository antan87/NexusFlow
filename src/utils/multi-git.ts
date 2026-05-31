/**
 * @module utils/multi-git
 * Shared utility functions for multi-repo git operations.
 *
 * Provides helpers for querying repo status, rebasing, committing, pushing,
 * and generating diff summaries across all repos in a NexusFlow workspace.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import type { Feature } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Metadata about a single repo within a workspace. */
export interface WorkspaceRepo {
  /** Directory name of the repo (e.g. 'api-gateway'). */
  name: string;
  /** Absolute path to the repo worktree inside the workspace. */
  path: string;
  /** Feature branch name shared across the workspace. */
  branchName: string;
}

/** Result of inspecting the working-tree status of a repo. */
export interface RepoStatus {
  /** Whether any tracked or untracked files have been modified. */
  hasChanges: boolean;
  /** List of changed file paths (relative to repo root). */
  changedFiles: string[];
  /** Human-readable summary, e.g. '3 files changed'. */
  summary: string;
}

/** Result of a rebase operation. */
export interface RebaseResult {
  /** Whether the rebase completed without conflicts. */
  success: boolean;
  /** Human-readable outcome message. */
  message: string;
  /** Stderr output when a conflict is detected. */
  conflict?: string;
}

/** Result of a commit-and-push operation. */
export interface CommitResult {
  /** Whether the commit (and optional push) succeeded. */
  success: boolean;
  /** Short commit hash, e.g. 'a1b2c3d'. */
  commitHash: string;
  /** Number of files included in the commit. */
  filesChanged: number;
  /** Human-readable outcome message. */
  message: string;
}

/** Result of a diff summary. */
export interface DiffSummary {
  /** Combined human-readable diff stat output. */
  summary: string;
  /** Total number of added lines. */
  additions: number;
  /** Total number of deleted lines. */
  deletions: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses the shortstat line produced by `git diff --stat` to extract
 * insertions and deletions counts.
 *
 * @param statOutput - Raw stdout from `git diff --stat`.
 * @returns A tuple of [additions, deletions].
 */
function parseStatCounts(statOutput: string): [number, number] {
  let additions = 0;
  let deletions = 0;

  // The last line of --stat output looks like:
  //   3 files changed, 12 insertions(+), 4 deletions(-)
  const summaryLine = statOutput.trim().split('\n').pop() ?? '';

  const insertMatch = summaryLine.match(/(\d+)\s+insertion/);
  if (insertMatch) additions = parseInt(insertMatch[1], 10);

  const deleteMatch = summaryLine.match(/(\d+)\s+deletion/);
  if (deleteMatch) deletions = parseInt(deleteMatch[1], 10);

  return [additions, deletions];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads the `nexusflow.json` manifest from a workspace directory and returns
 * metadata for each repo contained in the workspace.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @returns Array of repo metadata objects.
 * @throws If `nexusflow.json` cannot be read or parsed.
 */
export async function getWorkspaceRepos(
  workspacePath: string,
): Promise<WorkspaceRepo[]> {
  const manifestPath = path.join(workspacePath, 'nexusflow.json');
  const raw = await fs.readFile(manifestPath, 'utf-8');
  const feature = JSON.parse(raw) as Feature;

  return feature.repos.map((repoPath) => {
    const name = path.basename(repoPath);
    const absolutePath = path.resolve(workspacePath, name);
    return {
      name,
      path: absolutePath,
      branchName: feature.branchName,
    };
  });
}

/**
 * Inspects the working-tree status of a git repository.
 *
 * Runs `git status --porcelain` and parses the output to determine which
 * files have been modified, added, or deleted.
 *
 * @param repoPath - Absolute path to the repo root.
 * @returns Status information including changed file list and summary string.
 */
export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], {
      cwd: repoPath,
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const changedFiles = lines.map((line) => line.slice(3).trim());

    return {
      hasChanges: changedFiles.length > 0,
      changedFiles,
      summary:
        changedFiles.length === 0
          ? 'Clean'
          : `${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'} changed`,
    };
  } catch (error) {
    return {
      hasChanges: false,
      changedFiles: [],
      summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Rebases the current branch on top of the latest upstream base branch.
 *
 * Fetches from origin first, then attempts `git rebase origin/{baseBranch}`.
 * If a conflict occurs the rebase is aborted and the conflict details are
 * returned.
 *
 * @param repoPath   - Absolute path to the repo root.
 * @param baseBranch - The upstream branch to rebase onto (e.g. 'main').
 * @returns Result indicating success or conflict information.
 */
export async function rebaseRepo(
  repoPath: string,
  baseBranch: string,
): Promise<RebaseResult> {
  try {
    // Fetch latest from origin.
    await execa('git', ['fetch', 'origin'], { cwd: repoPath });

    // Attempt rebase.
    const { stdout } = await execa(
      'git',
      ['rebase', `origin/${baseBranch}`],
      { cwd: repoPath },
    );

    // Determine how far ahead the branch is.
    const message = stdout.includes('up to date')
      ? 'Up to date'
      : stdout.includes('Applied')
        ? stdout.trim()
        : 'Rebased successfully';

    return { success: true, message };
  } catch (error) {
    // Abort the in-progress rebase so the repo isn't left in a broken state.
    try {
      await execa('git', ['rebase', '--abort'], { cwd: repoPath });
    } catch {
      // Best-effort abort; ignore if it fails.
    }

    const stderr =
      error instanceof Error && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr)
        : String(error);

    return {
      success: false,
      message: 'Conflict during rebase',
      conflict: stderr,
    };
  }
}

/**
 * Stages all changes, commits with the given message, and pushes to origin.
 *
 * @param repoPath   - Absolute path to the repo root.
 * @param message    - Commit message.
 * @param branchName - Branch to push to on origin.
 * @param options    - Optional flags to skip the push step.
 * @returns Result with commit hash, file count, and outcome message.
 */
export async function commitAndPush(
  repoPath: string,
  message: string,
  branchName: string,
  options?: { noPush?: boolean },
): Promise<CommitResult> {
  try {
    // Stage everything.
    await execa('git', ['add', '.'], { cwd: repoPath });

    // Commit.
    const { stdout: commitOutput } = await execa(
      'git',
      ['commit', '-m', message],
      { cwd: repoPath },
    );

    // Parse short hash — git outputs something like "[branch abc1234] message"
    const hashMatch = commitOutput.match(/\[[\w/.-]+\s+([a-f0-9]+)\]/);
    const commitHash = hashMatch ? hashMatch[1] : '';

    // Parse file count — e.g. "3 files changed"
    const fileMatch = commitOutput.match(/(\d+)\s+file/);
    const filesChanged = fileMatch ? parseInt(fileMatch[1], 10) : 0;

    // Push unless opted out.
    if (!options?.noPush) {
      await execa('git', ['push', 'origin', branchName], { cwd: repoPath });
    }

    const action = options?.noPush ? 'Committed' : 'Committed and pushed';
    return { success: true, commitHash, filesChanged, message: action };
  } catch (error) {
    return {
      success: false,
      commitHash: '',
      filesChanged: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generates a combined diff summary (staged + unstaged) for a repository.
 *
 * Runs `git diff --stat` for working-tree changes and
 * `git diff --cached --stat` for staged changes, then merges the results.
 *
 * @param repoPath - Absolute path to the repo root.
 * @returns Combined summary string with total additions and deletions.
 */
export async function getDiffSummary(repoPath: string): Promise<DiffSummary> {
  try {
    const { stdout: unstaged } = await execa('git', ['diff', '--stat'], {
      cwd: repoPath,
    });
    const { stdout: staged } = await execa(
      'git',
      ['diff', '--cached', '--stat'],
      { cwd: repoPath },
    );

    const [unstagedAdd, unstagedDel] = parseStatCounts(unstaged);
    const [stagedAdd, stagedDel] = parseStatCounts(staged);

    const additions = unstagedAdd + stagedAdd;
    const deletions = unstagedDel + stagedDel;

    const parts: string[] = [];
    if (unstaged.trim()) parts.push(unstaged.trim());
    if (staged.trim()) parts.push(staged.trim());

    return {
      summary: parts.join('\n') || 'No changes',
      additions,
      deletions,
    };
  } catch (error) {
    return {
      summary: `Error: ${error instanceof Error ? error.message : String(error)}`,
      additions: 0,
      deletions: 0,
    };
  }
}
