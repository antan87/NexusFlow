/**
 * @module core/merge-detection
 * Decides whether a branch tip is already part of a repository's default
 * branch. Archive uses it to tell delivered work from parked work, and branch
 * cleanup uses it to decide what may be deleted.
 *
 * Two kinds of evidence count, in order:
 *
 * 1. **Ancestry** — the tip is an ancestor of the fetched remote default
 *    branch (merge commits and fast-forwards).
 * 2. **A merged pull request for that exact tip** — squash and rebase merges
 *    rewrite commits, so ancestry misses them. `gh` must report a merged PR
 *    whose head SHA equals the tip; a PR whose head moved on does not count.
 *
 * Anything else is "not proven merged". Callers must treat that as "keep".
 */

import { execa } from 'execa';

import { detectGh, parseRemoteUrl } from '../utils/pr.js';

/** Which evidence proved a merge, or `none`. */
export type MergeEvidence = 'ancestor' | 'pull-request' | 'none';

/** Outcome of {@link checkMerged}. */
export interface MergeCheck {
  merged: boolean;
  evidence: MergeEvidence;
  /** One sentence for reports: why the tip is or is not considered merged. */
  detail: string;
  /** The merged PR that proved it, when {@link evidence} is `pull-request`. */
  prUrl?: string;
}

/** Input for {@link checkMerged}. */
export interface MergeCheckInput {
  /** Repository (or worktree) to run Git and `gh` in. */
  repoPath: string;
  /** The commit to test, normally the branch tip. */
  sha: string;
  /** Branch name used to look up pull requests; omit for a detached HEAD. */
  branch?: string | null;
  defaultBranch: string;
  remoteUrl?: string | null;
  /** Consult `gh` for squash/rebase merges (default true). */
  usePullRequests?: boolean;
}

const GH_STATUS_TTL_MS = 5 * 60_000;
let ghStatus: { at: number; status: Promise<{ installed: boolean; authenticated: boolean }> } | null = null;

/**
 * `gh` availability, cached briefly: a long-running app server notices a later
 * `gh auth login` without probing `gh` for every repository.
 */
function ghAvailable(): Promise<{ installed: boolean; authenticated: boolean }> {
  if (!ghStatus || Date.now() - ghStatus.at > GH_STATUS_TTL_MS) ghStatus = { at: Date.now(), status: detectGh() };
  return ghStatus.status;
}

/** Test hook: forget the cached `gh` detection. */
export function resetMergeDetectionCache(): void {
  ghStatus = null;
}

/**
 * Updates `origin/<defaultBranch>` so ancestry is judged against the remote's
 * current state. Never throws; a failed fetch leaves the last fetched state.
 *
 * @returns An error message when the fetch failed, otherwise `null`.
 */
export async function fetchDefaultBranch(repoPath: string, defaultBranch: string): Promise<string | null> {
  const result = await execa(
    'git',
    ['fetch', '--quiet', 'origin', `+refs/heads/${defaultBranch}:refs/remotes/origin/${defaultBranch}`],
    { cwd: repoPath, reject: false, timeout: 60_000 },
  ).catch((error: unknown) => ({ exitCode: 1, stderr: error instanceof Error ? error.message : String(error) }));
  if (result.exitCode === 0) return null;
  const first = String(result.stderr ?? '').split('\n').find((line) => line.trim()) ?? 'git fetch failed';
  return first.trim();
}

async function refExists(repoPath: string, ref: string): Promise<boolean> {
  const result = await execa('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoPath, reject: false });
  return result.exitCode === 0;
}

/** The ref ancestry is judged against: the remote default, else the local one. */
export async function resolveDefaultRef(repoPath: string, defaultBranch: string): Promise<string | null> {
  for (const ref of [`refs/remotes/origin/${defaultBranch}`, `refs/heads/${defaultBranch}`]) {
    if (await refExists(repoPath, ref)) return ref;
  }
  return null;
}

async function isAncestor(repoPath: string, sha: string, ref: string): Promise<boolean> {
  const result = await execa('git', ['merge-base', '--is-ancestor', sha, ref], { cwd: repoPath, reject: false });
  return result.exitCode === 0;
}

export interface GhPullRequest {
  url?: string;
  headRefOid?: string;
  baseRefName?: string;
}

async function mergedPullRequestFor(input: MergeCheckInput): Promise<GhPullRequest | null> {
  if (!input.branch || !input.remoteUrl) return null;
  if (parseRemoteUrl(input.remoteUrl)?.kind !== 'github') return null;
  const gh = await ghAvailable();
  if (!gh.installed || !gh.authenticated) return null;
  const result = await execa(
    'gh',
    ['pr', 'list', '--state', 'merged', '--head', input.branch, '--json', 'url,headRefOid,baseRefName', '--limit', '50'],
    { cwd: input.repoPath, reject: false, timeout: 30_000 },
  ).catch(() => null);
  if (!result || result.exitCode !== 0) return null;
  let prs: GhPullRequest[];
  try {
    prs = JSON.parse(result.stdout) as GhPullRequest[];
  } catch {
    return null;
  }
  return findMergedPullRequest(prs, input.sha, input.defaultBranch);
}

/**
 * The merged PR that proves `sha` landed on `defaultBranch`: its head must be
 * exactly that commit. A PR merged from an earlier tip proves nothing about
 * commits added afterwards.
 */
export function findMergedPullRequest(prs: GhPullRequest[], sha: string, defaultBranch: string): GhPullRequest | null {
  return prs.find((pr) => pr.headRefOid === sha && pr.baseRefName === defaultBranch) ?? null;
}

/**
 * Decides whether `sha` is proven merged into the default branch.
 * Never throws: an unreadable repository reports "not proven merged".
 */
export async function checkMerged(input: MergeCheckInput): Promise<MergeCheck> {
  const ref = await resolveDefaultRef(input.repoPath, input.defaultBranch);
  if (ref && await isAncestor(input.repoPath, input.sha, ref)) {
    return {
      merged: true,
      evidence: 'ancestor',
      detail: `contained in ${ref.replace(/^refs\/(remotes\/)?(heads\/)?/, '')}`,
    };
  }
  if (input.usePullRequests !== false) {
    const pr = await mergedPullRequestFor(input);
    if (pr) {
      return {
        merged: true,
        evidence: 'pull-request',
        detail: `merged through ${pr.url ?? 'a pull request'} at this exact commit`,
        prUrl: pr.url,
      };
    }
  }
  return {
    merged: false,
    evidence: 'none',
    detail: ref
      ? `not contained in ${ref.replace(/^refs\/(remotes\/)?(heads\/)?/, '')} and no merged pull request for this exact commit`
      : `default branch "${input.defaultBranch}" not found`,
  };
}
