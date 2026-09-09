/**
 * @module utils/repo-freshness
 * Base repository freshness inspection and safe fast-forward synchronization.
 *
 * Helps developers detect when a base repository's default branch (or custom branch)
 * is behind remote tracking commits before creating a new workspace, and safely
 * fast-forwards clean repositories without disturbing dirty working trees.
 */

import { execa } from 'execa';
import { detectDefaultBranch } from './git.js';

export type FreshnessStatus =
  | 'up-to-date'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'untracked'
  | 'offline'
  | 'error';

export interface RepoFreshness {
  /** Absolute path to the repository. */
  repoPath: string;
  /** Repository name (directory basename). */
  repoName: string;
  /** The branch inspected. */
  branch: string;
  /** The repository's detected default branch. */
  defaultBranch: string;
  /** Remote tracking branch ref, e.g. 'origin/main' or 'upstream/main', or null if untracked. */
  trackingBranch: string | null;
  /** The name of the remote, e.g. 'origin' or 'upstream', or null. */
  remoteName: string | null;
  /** Whether the repository has at least one remote configured. */
  hasRemote: boolean;
  /** Whether the working tree is clean (no uncommitted or untracked changes). */
  isClean: boolean;
  /** Number of commits local is ahead of tracking branch. */
  ahead: number;
  /** Number of commits local is behind tracking branch. */
  behind: number;
  /** Classified freshness status. */
  status: FreshnessStatus;
  /** Human-readable status message. */
  message: string;
  /** Error detail if an error occurred during fetch or inspection. */
  error?: string;
}

export type FastForwardStatus =
  | 'up-to-date'
  | 'fast-forwarded'
  | 'ahead'
  | 'dirty'
  | 'diverged'
  | 'untracked'
  | 'offline'
  | 'error';

export interface FastForwardResult {
  success: boolean;
  repoPath: string;
  repoName: string;
  branch: string;
  status: FastForwardStatus;
  message: string;
  ahead: number;
  behind: number;
  error?: string;
}

export interface CheckFreshnessOptions {
  /** Whether to run `git fetch` before checking status (default: true). */
  fetch?: boolean;
  /** Timeout in milliseconds for git network operations (default: 10000ms). */
  timeoutMs?: number;
}

/**
 * Gets the configured or inferred remote tracking branch for a given branch in a repository.
 * Tries `git rev-parse --abbrev-ref <branch>@{u}` first. If no upstream is configured,
 * scans available remotes ('origin', 'upstream', etc.) for a matching remote branch ref.
 */
export async function resolveTrackingBranch(
  repoPath: string,
  branch: string,
): Promise<{ trackingBranch: string | null; remoteName: string | null; hasRemote: boolean }> {
  // 1. Check if git has an explicit upstream tracking branch configured
  try {
    const { stdout } = await execa(
      'git',
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{u}`],
      { cwd: repoPath },
    );
    const tracking = stdout.trim();
    if (tracking && !tracking.endsWith('@{u}')) {
      const slashIndex = tracking.indexOf('/');
      const remoteName = slashIndex > 0 ? tracking.slice(0, slashIndex) : null;
      return { trackingBranch: tracking, remoteName, hasRemote: true };
    }
  } catch {
    // No explicit upstream configured
  }

  // 2. Discover remotes
  let remotes: string[] = [];
  try {
    const { stdout } = await execa('git', ['remote'], { cwd: repoPath });
    remotes = stdout
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
  } catch {
    return { trackingBranch: null, remoteName: null, hasRemote: false };
  }

  if (remotes.length === 0) {
    return { trackingBranch: null, remoteName: null, hasRemote: false };
  }

  // Prioritize origin, then upstream, then any other remote
  const candidateRemotes = [
    ...remotes.filter((r) => r === 'origin'),
    ...remotes.filter((r) => r === 'upstream'),
    ...remotes.filter((r) => r !== 'origin' && r !== 'upstream'),
  ];

  for (const remote of candidateRemotes) {
    try {
      await execa('git', ['rev-parse', '--verify', `refs/remotes/${remote}/${branch}`], {
        cwd: repoPath,
      });
      return { trackingBranch: `${remote}/${branch}`, remoteName: remote, hasRemote: true };
    } catch {
      // Remote branch does not exist on this remote
    }
  }

  return { trackingBranch: null, remoteName: candidateRemotes[0] ?? null, hasRemote: true };
}

/**
 * Checks whether the repository working tree is clean.
 */
export async function isRepoClean(repoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: repoPath });
    return stdout.trim().length === 0;
  } catch {
    return false;
  }
}

/**
 * Checks the freshness of a branch against its remote tracking branch.
 */
export async function checkRepoFreshness(
  repoPath: string,
  targetBranch?: string,
  options: CheckFreshnessOptions = {},
): Promise<RepoFreshness> {
  const repoName = repoPath.split(/[\/\\]/).filter(Boolean).pop() || 'repo';
  let defaultBranch = 'main';
  try {
    defaultBranch = await detectDefaultBranch(repoPath);
  } catch {
    // fallback
  }

  const branch = targetBranch || defaultBranch;
  const isClean = await isRepoClean(repoPath);

  const { trackingBranch, remoteName, hasRemote } = await resolveTrackingBranch(
    repoPath,
    branch,
  );

  if (!hasRemote) {
    return {
      repoPath,
      repoName,
      branch,
      defaultBranch,
      trackingBranch: null,
      remoteName: null,
      hasRemote: false,
      isClean,
      ahead: 0,
      behind: 0,
      status: 'untracked',
      message: 'Local repository (no remotes configured)',
    };
  }

  let fetchFailed = false;
  let fetchErrorMsg: string | undefined;

  // Run fetch if requested and remote is known
  if (options.fetch !== false && remoteName) {
    try {
      await execa('git', ['fetch', remoteName], {
        cwd: repoPath,
        timeout: options.timeoutMs ?? 10000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (err) {
      fetchFailed = true;
      fetchErrorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  // Re-verify tracking branch in case fetch just populated it
  let resolvedTracking = trackingBranch;
  if (!resolvedTracking && remoteName) {
    try {
      await execa('git', ['rev-parse', '--verify', `refs/remotes/${remoteName}/${branch}`], {
        cwd: repoPath,
      });
      resolvedTracking = `${remoteName}/${branch}`;
    } catch {
      // Still untracked
    }
  }

  if (!resolvedTracking) {
    return {
      repoPath,
      repoName,
      branch,
      defaultBranch,
      trackingBranch: null,
      remoteName,
      hasRemote: true,
      isClean,
      ahead: 0,
      behind: 0,
      status: fetchFailed ? 'offline' : 'untracked',
      message: fetchFailed
        ? `Could not reach remote ${remoteName} (offline)`
        : `Branch "${branch}" has no tracking branch on ${remoteName}`,
      error: fetchErrorMsg,
    };
  }

  // Calculate ahead / behind counts
  try {
    const { stdout } = await execa(
      'git',
      ['rev-list', '--left-right', '--count', `${branch}...${resolvedTracking}`],
      { cwd: repoPath },
    );

    const [aheadRaw, behindRaw] = stdout.trim().split(/\s+/);
    const ahead = parseInt(aheadRaw ?? '0', 10) || 0;
    const behind = parseInt(behindRaw ?? '0', 10) || 0;

    let status: FreshnessStatus;
    let message: string;

    if (ahead === 0 && behind === 0) {
      status = 'up-to-date';
      message = `Up to date with ${resolvedTracking}`;
    } else if (ahead === 0 && behind > 0) {
      status = 'behind';
      message = `${behind} commit${behind === 1 ? '' : 's'} behind ${resolvedTracking}`;
    } else if (ahead > 0 && behind === 0) {
      status = 'ahead';
      message = `${ahead} commit${ahead === 1 ? '' : 's'} ahead of ${resolvedTracking}`;
    } else {
      status = 'diverged';
      message = `Diverged (${ahead} ahead, ${behind} behind ${resolvedTracking})`;
    }

    if (fetchFailed) {
      message += ' (offline - using cached refs)';
    }

    return {
      repoPath,
      repoName,
      branch,
      defaultBranch,
      trackingBranch: resolvedTracking,
      remoteName,
      hasRemote: true,
      isClean,
      ahead,
      behind,
      status,
      message,
      error: fetchErrorMsg,
    };
  } catch (err) {
    return {
      repoPath,
      repoName,
      branch,
      defaultBranch,
      trackingBranch: resolvedTracking,
      remoteName,
      hasRemote: true,
      isClean,
      ahead: 0,
      behind: 0,
      status: 'error',
      message: `Failed to compare branch ${branch} with ${resolvedTracking}`,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Safely fast-forwards a repository branch to its remote tracking branch.
 *
 * Rules:
 * 1. If up-to-date, does nothing and reports success.
 * 2. If diverged, fails cleanly without modifying anything.
 * 3. If the inspected branch is currently checked out:
 *    - Fails if the working tree is dirty (protects user's uncommitted work).
 *    - Runs `git merge --ff-only <trackingBranch>` if clean.
 * 4. If another branch is checked out:
 *    - Safely fast-forwards the ref via `git fetch <remote> <remoteBranch>:<branch>`
 *      or `git update-ref` without touching the active working directory.
 */
export async function fastForwardBranch(
  repoPath: string,
  targetBranch?: string,
  options: { timeoutMs?: number } = {},
): Promise<FastForwardResult> {
  const freshness = await checkRepoFreshness(repoPath, targetBranch, {
    fetch: true,
    timeoutMs: options.timeoutMs,
  });

  const { repoName, branch, trackingBranch, remoteName, isClean, ahead, behind, status } = freshness;

  if (status === 'up-to-date') {
    return {
      success: true,
      repoPath,
      repoName,
      branch,
      status: 'up-to-date',
      message: `Already up to date with ${trackingBranch}`,
      ahead: 0,
      behind: 0,
    };
  }

  if (status === 'ahead') {
    return {
      success: true,
      repoPath,
      repoName,
      branch,
      status: 'ahead',
      message: `Branch "${branch}" is ahead of ${trackingBranch} by ${ahead} commit(s)`,
      ahead,
      behind: 0,
    };
  }

  if (status === 'diverged') {
    return {
      success: false,
      repoPath,
      repoName,
      branch,
      status: 'diverged',
      message: `Cannot fast-forward: branch "${branch}" has diverged from ${trackingBranch} (${ahead} ahead, ${behind} behind). Manual merge or rebase required.`,
      ahead,
      behind,
    };
  }

  if (status === 'untracked') {
    return {
      success: false,
      repoPath,
      repoName,
      branch,
      status: 'untracked',
      message: freshness.message,
      ahead: 0,
      behind: 0,
    };
  }

  if (status === 'offline') {
    return {
      success: false,
      repoPath,
      repoName,
      branch,
      status: 'offline',
      message: freshness.message,
      ahead: 0,
      behind: 0,
      error: freshness.error,
    };
  }

  if (status === 'error' || !trackingBranch) {
    return {
      success: false,
      repoPath,
      repoName,
      branch,
      status: 'error',
      message: freshness.message,
      ahead: 0,
      behind: 0,
      error: freshness.error,
    };
  }

  // Target branch is behind. Determine currently checked out branch
  let currentBranch = '';
  try {
    const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: repoPath });
    currentBranch = stdout.trim();
  } catch {
    // detached HEAD or error
  }

  try {
    if (currentBranch === branch) {
      // Currently checked out: require clean working tree
      if (!isClean) {
        return {
          success: false,
          repoPath,
          repoName,
          branch,
          status: 'dirty',
          message: `Cannot fast-forward: working tree has uncommitted changes in "${branch}". Stash or commit changes first.`,
          ahead,
          behind,
        };
      }

      await execa('git', ['merge', '--ff-only', trackingBranch], { cwd: repoPath });
      return {
        success: true,
        repoPath,
        repoName,
        branch,
        status: 'fast-forwarded',
        message: `Fast-forwarded "${branch}" to ${trackingBranch} (${behind} commit${behind === 1 ? '' : 's'})`,
        ahead: 0,
        behind: 0,
      };
    } else {
      // Not checked out: verify ancestor and update ref safely
      await execa('git', ['merge-base', '--is-ancestor', branch, trackingBranch], { cwd: repoPath });

      // Fast-forward local ref from remote ref without checkout
      const rName = remoteName || trackingBranch.split('/')[0];
      const remoteBranchPart = trackingBranch.slice(rName.length + 1);

      try {
        await execa('git', ['fetch', rName, `${remoteBranchPart}:${branch}`], {
          cwd: repoPath,
          timeout: options.timeoutMs ?? 10000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
      } catch {
        // If git fetch refuses or network is offline, update ref directly since ancestry is verified
        const { stdout: commitSha } = await execa('git', ['rev-parse', trackingBranch], { cwd: repoPath });
        await execa('git', ['update-ref', `refs/heads/${branch}`, commitSha.trim()], { cwd: repoPath });
      }

      return {
        success: true,
        repoPath,
        repoName,
        branch,
        status: 'fast-forwarded',
        message: `Fast-forwarded "${branch}" to ${trackingBranch} (${behind} commit${behind === 1 ? '' : 's'})`,
        ahead: 0,
        behind: 0,
      };
    }
  } catch (err) {
    return {
      success: false,
      repoPath,
      repoName,
      branch,
      status: 'error',
      message: `Failed to fast-forward "${branch}" to ${trackingBranch}: ${err instanceof Error ? err.message : String(err)}`,
      ahead,
      behind,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Checks freshness for a batch of repositories.
 */
export async function checkReposFreshness(
  repos: Array<{ path: string; branch?: string }>,
  options: CheckFreshnessOptions = {},
): Promise<RepoFreshness[]> {
  return Promise.all(
    repos.map((r) => checkRepoFreshness(r.path, r.branch, options)),
  );
}

/**
 * Fast-forwards base branches for a batch of repositories.
 */
export async function fastForwardRepos(
  repos: Array<{ path: string; branch?: string }>,
  options: { timeoutMs?: number } = {},
): Promise<FastForwardResult[]> {
  const results: FastForwardResult[] = [];
  for (const repo of repos) {
    results.push(await fastForwardBranch(repo.path, repo.branch, options));
  }
  return results;
}
