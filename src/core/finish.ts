/**
 * @module core/finish
 * Headless "finish a feature" engine shared by the CLI `finish` command and the
 * MCP `finish_workspace` tool. Commits remaining changes, pushes branches, and
 * surfaces a way to open a PR for each repo (via `gh` when available, otherwise
 * a compare URL). It never promotes knowledge or deletes anything — those are
 * interactive concerns owned by the command.
 */

import { getWorkspaceStatusReport, type WorkspaceStatusReport } from './status.js';
import { commitWorkspace } from './commit.js';
import { pushRepo } from '../utils/multi-git.js';
import { detectGh, createPrWithGh, parseRemoteUrl, buildCompareUrl } from '../utils/pr.js';

/** Options for {@link finishWorkspace}. */
export interface FinishOptions {
  /** Commit message for any remaining dirty changes. */
  message?: string;
  /** Do not push after committing. */
  skipPush?: boolean;
  /** Attempt `gh pr create` when the GitHub CLI is installed and authenticated. */
  createPrs?: boolean;
  prTitle?: string;
  prBody?: string;
}

/** Per-repo finish outcome. */
export interface RepoFinishReport {
  name: string;
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
  /** PR URL created via `gh`, when available. */
  prUrl?: string;
  /** Compare/create-PR URL to open in a browser (fallback and default path). */
  compareUrl?: string;
  /** Set when the repo was intentionally skipped (wrong branch, no remote, …). */
  skipped?: string;
  /** Set when an operation failed for this repo. */
  error?: string;
}

/** Aggregate finish report. */
export interface FinishReport {
  workspacePath: string;
  branchName: string;
  preflight: WorkspaceStatusReport;
  repos: RepoFinishReport[];
  /** True when `gh` was used to create PRs. */
  ghUsed: boolean;
  /** True when, after finishing, every repo is clean and pushed. */
  safeToCleanup: boolean;
}

/**
 * Runs the finish sequence: preflight → commit dirty repos → push → PR links →
 * recheck. Repos on the wrong branch or in a detached-HEAD state are skipped
 * (never committed) so a stray checkout can't push to the wrong branch.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param options       - Finish options.
 */
export async function finishWorkspace(
  workspacePath: string,
  options: FinishOptions = {},
): Promise<FinishReport> {
  const preflight = await getWorkspaceStatusReport(workspacePath);
  const reports = new Map<string, RepoFinishReport>();
  for (const repo of preflight.repos) {
    reports.set(repo.name, { name: repo.name, committed: false, pushed: false });
  }

  // Repos we are allowed to act on: on the expected branch, not detached.
  const actionable = preflight.repos.filter((r) => r.onExpectedBranch && r.branch);
  for (const repo of preflight.repos) {
    if (!r_isActionable(repo.name, actionable)) {
      const rep = reports.get(repo.name)!;
      rep.skipped = repo.branch
        ? `on branch "${repo.branch}", not the feature branch "${repo.expectedBranch}"`
        : 'detached HEAD';
    }
  }

  // ── Commit dirty, actionable repos ──────────────────────────────────────
  const dirtyActionable = actionable.filter((r) => r.dirty);
  if (dirtyActionable.length > 0) {
    if (!options.message || !options.message.trim()) {
      for (const r of dirtyActionable) {
        reports.get(r.name)!.error = 'uncommitted changes and no commit message provided';
      }
    } else {
      const commitReport = await commitWorkspace(workspacePath, options.message, {
        noPush: true, // push is handled uniformly below
        repos: dirtyActionable.map((r) => r.name),
      });
      for (const c of commitReport.repos) {
        const rep = reports.get(c.name)!;
        rep.committed = c.success;
        rep.commitHash = c.commitHash || undefined;
        if (!c.success) rep.error = c.message;
      }
    }
  }

  // ── Push actionable repos with a remote ─────────────────────────────────
  for (const repo of actionable) {
    const rep = reports.get(repo.name)!;
    if (rep.error) continue;
    if (!repo.remoteUrl) {
      rep.skipped = rep.skipped ?? 'no remote configured';
      continue;
    }
    if (options.skipPush) continue;

    // Push when we committed, when the branch is ahead, or when it was never pushed.
    const needsPush = rep.committed || repo.ahead === null || (repo.ahead ?? 0) > 0;
    if (needsPush) {
      const result = await pushRepo(repo.path, repo.expectedBranch);
      rep.pushed = result.success;
      if (!result.success) rep.error = result.message;
    }
  }

  // ── PR links ────────────────────────────────────────────────────────────
  const gh = options.createPrs ? await detectGh() : { installed: false, authenticated: false };
  const ghUsed = Boolean(options.createPrs && gh.installed && gh.authenticated);

  for (const repo of actionable) {
    const rep = reports.get(repo.name)!;
    if (!repo.remoteUrl || rep.error) continue;
    // Nothing to compare when the work happened directly on the default
    // branch (typical for in-place workspaces) — a default...default PR link
    // would be meaningless.
    if (repo.expectedBranch === repo.defaultBranch) continue;

    const remote = parseRemoteUrl(repo.remoteUrl);
    if (remote) {
      rep.compareUrl = buildCompareUrl(remote, repo.defaultBranch, repo.expectedBranch) ?? undefined;
    }

    if (ghUsed && rep.pushed) {
      const title = options.prTitle?.trim() || repo.expectedBranch;
      const body = options.prBody ?? '';
      const pr = await createPrWithGh(repo.path, {
        base: repo.defaultBranch,
        head: repo.expectedBranch,
        title,
        body,
      });
      if (pr.url) {
        rep.prUrl = pr.url;
      }
      // On gh failure we silently keep compareUrl (already populated above).
    }
  }

  // ── Recheck to decide whether cleanup is safe ───────────────────────────
  const after = await getWorkspaceStatusReport(workspacePath);
  const safeToCleanup = after.allClean && after.allPushed;

  return {
    workspacePath,
    branchName: preflight.branchName,
    preflight,
    repos: preflight.repos.map((r) => reports.get(r.name)!),
    ghUsed,
    safeToCleanup,
  };
}

/** Whether a repo name is in the actionable set. */
function r_isActionable(name: string, actionable: WorkspaceStatusReport['repos']): boolean {
  return actionable.some((r) => r.name === name);
}
