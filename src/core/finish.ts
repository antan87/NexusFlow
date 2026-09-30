/**
 * @module core/finish
 * Headless "finish a feature" engine shared by the CLI `finish` command, the
 * GUI server and the MCP `finish_workspace` tool. Checks verification evidence,
 * commits remaining changes, pushes branches, and surfaces a way to open a PR
 * for each repo (via `gh` when available, otherwise a compare URL). It never
 * promotes knowledge or deletes anything — those are interactive concerns
 * owned by the command.
 *
 * Git effects across repositories are not atomic. Every run is recorded in
 * workspace state as it goes, and a re-run resumes from the last safe point:
 * committed repos are clean, so they are pushed rather than committed again.
 */

import { getWorkspaceStatusReport, type RepoStatusReport, type WorkspaceStatusReport } from './status.js';
import { commitWorkspace } from './commit.js';
import { referenceRepoMessage } from './edit-policy.js';
import {
  evaluateProgression,
  recordVerificationOverride,
  validateOverrideReason,
  type ProgressionDecision,
  type VerificationOverride,
} from './progression-policy.js';
import { loadWorkspaceState, mutateWorkspaceState } from './workspace-state.js';
import { assertWorkspaceActive } from './archive-guard.js';
import { loadFeatureConfig } from './workspace.js';
import { pushRepo } from '../utils/multi-git.js';
import { detectGh, createPrWithGh, parseRemoteUrl, buildCompareUrl } from '../utils/pr.js';
import type { FinishRecord, VerificationOverrideRecord } from '../types.js';

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
  /**
   * Finish even though verification evidence is missing, failed or stale.
   * The reason is recorded and returned; without it such a finish is refused.
   */
  override?: VerificationOverride;
  /** Report what would happen, including remote effects, without changing anything. */
  dryRun?: boolean;
}

/** Per-repo finish outcome. */
export interface RepoFinishReport {
  name: string;
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
  /** Branch the repo is expected to finish on. */
  branch: string;
  remoteUrl: string | null;
  /** PR URL created via `gh`, when available. */
  prUrl?: string;
  /** Compare/create-PR URL to open in a browser (fallback and default path). */
  compareUrl?: string;
  /** Set when the repo was intentionally skipped (reference, wrong branch, no remote, …). */
  skipped?: string;
  /** Set when an operation failed for this repo. */
  error?: string;
  /** Dry run: whether the remaining changes would be committed. */
  wouldCommit?: boolean;
  /** Dry run: whether the branch would be pushed. */
  wouldPush?: boolean;
}

/** Aggregate finish report. */
export interface FinishReport {
  workspacePath: string;
  branchName: string;
  preflight: WorkspaceStatusReport;
  /** The verification policy decision this run was checked against. */
  policy: ProgressionDecision;
  /**
   * True when the policy refused the finish and nothing was changed. Supply a
   * reasoned override, or verify again, to proceed.
   */
  blocked: boolean;
  /** The override this run proceeded under, if any. */
  override?: VerificationOverrideRecord;
  /** True when this was a dry run; nothing was changed. */
  dryRun: boolean;
  /** Status of the previous finish run when it had not completed. */
  resumedFrom?: FinishRecord['status'];
  repos: RepoFinishReport[];
  /** True when `gh` was used to create PRs. */
  ghUsed: boolean;
  /** True when, after finishing, every editable repo is clean and pushed. */
  safeToCleanup: boolean;
}

/** Whether the branch still has commits the remote does not. */
function needsPush(repo: RepoStatusReport, committed: boolean): boolean {
  return committed || repo.ahead === null || (repo.ahead ?? 0) > 0;
}

function toRecord(reports: RepoFinishReport[]): FinishRecord['repos'] {
  return reports.map(({ name, committed, commitHash, pushed, prUrl, compareUrl, skipped, error }) => ({
    name, committed, commitHash, pushed, prUrl, compareUrl, skipped, error,
  }));
}

/**
 * Runs the finish sequence: preflight → verification policy → commit dirty
 * repos → push → PR links → recheck. Read-only reference repos are never
 * touched. Repos on the wrong branch or in a detached-HEAD state are skipped
 * (never committed) so a stray checkout can't push to the wrong branch.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param options       - Finish options.
 * @throws If an override is supplied with an unacceptable reason.
 */
export async function finishWorkspace(
  workspacePath: string,
  options: FinishOptions = {},
): Promise<FinishReport> {
  if (options.override) {
    const invalid = validateOverrideReason(options.override.reason);
    if (invalid) throw new Error(invalid);
  }

  assertWorkspaceActive(await loadFeatureConfig(workspacePath), 'finish');

  const preflight = await getWorkspaceStatusReport(workspacePath);
  const policy = await evaluateProgression(workspacePath);
  const previous = (await loadWorkspaceState(workspacePath)).lastFinish;
  const resumedFrom = previous && (previous.status === 'running' || previous.status === 'partial')
    ? previous.status
    : undefined;

  const reports = new Map<string, RepoFinishReport>();
  for (const repo of preflight.repos) {
    reports.set(repo.name, {
      name: repo.name,
      committed: false,
      pushed: false,
      branch: repo.expectedBranch,
      remoteUrl: repo.remoteUrl,
    });
  }

  // Repos we are allowed to act on: editable, on the expected branch, not detached.
  const actionable = preflight.repos.filter((r) => r.editable && r.onExpectedBranch && r.branch);
  for (const repo of preflight.repos) {
    if (actionable.includes(repo)) continue;
    const rep = reports.get(repo.name)!;
    rep.skipped = !repo.editable
      ? referenceRepoMessage(repo.name)
      : repo.branch
        ? `on branch "${repo.branch}", not the feature branch "${repo.expectedBranch}"`
        : 'detached HEAD';
  }

  const base = {
    workspacePath,
    branchName: preflight.branchName,
    preflight,
    policy,
    resumedFrom,
    ghUsed: false,
  };
  const safeToCleanupNow = (status: WorkspaceStatusReport) =>
    status.repos.filter((r) => r.editable).every((r) => !r.dirty && r.ahead === 0);

  // ── Verification policy ─────────────────────────────────────────────────
  if (!policy.ready && !options.override) {
    return {
      ...base,
      blocked: true,
      dryRun: Boolean(options.dryRun),
      repos: preflight.repos.map((r) => reports.get(r.name)!),
      safeToCleanup: false,
    };
  }

  // ── Dry run: preview every effect, change nothing ────────────────────────
  if (options.dryRun) {
    for (const repo of actionable) {
      const rep = reports.get(repo.name)!;
      rep.wouldCommit = repo.dirty && Boolean(options.message?.trim());
      if (repo.dirty && !options.message?.trim()) rep.error = 'uncommitted changes and no commit message provided';
      rep.wouldPush = !options.skipPush && Boolean(repo.remoteUrl) && needsPush(repo, Boolean(rep.wouldCommit));
      if (!repo.remoteUrl) rep.skipped = 'no remote configured';
      const remote = repo.remoteUrl ? parseRemoteUrl(repo.remoteUrl) : null;
      if (remote && repo.expectedBranch !== repo.defaultBranch) {
        rep.compareUrl = buildCompareUrl(remote, repo.defaultBranch, repo.expectedBranch) ?? undefined;
      }
    }
    return {
      ...base,
      blocked: false,
      dryRun: true,
      repos: preflight.repos.map((r) => reports.get(r.name)!),
      safeToCleanup: false,
    };
  }

  const override = options.override && !policy.ready
    ? await recordVerificationOverride(workspacePath, options.override, policy)
    : undefined;

  const startedAt = new Date().toISOString();
  const persist = (status: FinishRecord['status'], safeToCleanup = false) =>
    mutateWorkspaceState(workspacePath, (state) => {
      state.lastFinish = {
        startedAt,
        completedAt: status === 'running' ? undefined : new Date().toISOString(),
        status,
        repos: toRecord(preflight.repos.map((r) => reports.get(r.name)!)),
        override,
        safeToCleanup,
      };
    });
  await persist('running');

  // ── Commit dirty, actionable repos ──────────────────────────────────────
  const dirtyActionable = actionable.filter((r) => r.dirty);
  if (dirtyActionable.length > 0) {
    if (!options.message || !options.message.trim()) {
      for (const r of dirtyActionable) {
        reports.get(r.name)!.error = 'uncommitted changes and no commit message provided';
      }
    } else {
      try {
        const commitReport = await commitWorkspace(workspacePath, options.message, {
          noPush: true, // push is handled uniformly below
          repos: dirtyActionable.map((r) => r.name),
        });
        for (const c of commitReport.repos) {
          const rep = reports.get(c.name)!;
          rep.committed = c.committed;
          rep.commitHash = c.commitHash || undefined;
          if (!c.success) rep.error = c.message;
        }
        for (const s of commitReport.skipped) reports.get(s.name)!.skipped = s.reason;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        for (const r of dirtyActionable) reports.get(r.name)!.error = message;
      }
    }
    await persist('running');
  }

  // ── Push actionable repos with a remote ─────────────────────────────────
  for (const repo of actionable) {
    const rep = reports.get(repo.name)!;
    if (rep.error || rep.skipped) continue;
    if (!repo.remoteUrl) {
      rep.skipped = 'no remote configured';
      continue;
    }
    if (options.skipPush) continue;

    // Push when we committed, when the branch is ahead, or when it was never pushed.
    if (needsPush(repo, rep.committed)) {
      const result = await pushRepo(repo.path, repo.expectedBranch);
      rep.pushed = result.success;
      if (!result.success) rep.error = result.message;
      await persist('running');
    }
  }

  // ── PR links ────────────────────────────────────────────────────────────
  const gh = options.createPrs ? await detectGh() : { installed: false, authenticated: false };
  const ghUsed = Boolean(options.createPrs && gh.installed && gh.authenticated);

  for (const repo of actionable) {
    const rep = reports.get(repo.name)!;
    if (!repo.remoteUrl || rep.error) continue;
    // Nothing to compare when the work happened directly on the default branch.
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
  const safeToCleanup = safeToCleanupNow(after);
  const failed = [...reports.values()].some((r) => r.error);
  await persist(failed ? 'partial' : 'completed', safeToCleanup);

  return {
    ...base,
    blocked: false,
    dryRun: false,
    override,
    repos: preflight.repos.map((r) => reports.get(r.name)!),
    ghUsed,
    safeToCleanup,
  };
}
