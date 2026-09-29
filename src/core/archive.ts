/**
 * @module core/archive
 * Archive completes a workspace without losing its record. It returns the
 * worktrees the workspace created and keeps the workspace directory: manifest,
 * lifecycle and verification state, milestones, planning notes, knowledge,
 * assignment and documents.
 *
 * An archived workspace becomes an in-place workspace whose repositories are
 * read-only references to the user's own checkouts, so every read path keeps
 * working. Operations that change repositories or start processes refuse it
 * ({@link assertWorkspaceActive}). Unarchive clears the flag; repositories are
 * prepared for editing again on demand.
 *
 * Safety contract:
 * - Worktrees are removed without `--force`, only after every editable repo is
 *   clean and its tip is merged, or pushed and explicitly parked. A blocked
 *   repo blocks the whole archive and nothing is removed.
 * - The user's own checkouts are never changed; branches are kept.
 * - Each run is journaled in workspace state. Git effects are not atomic
 *   across repositories, so a re-run resumes where an interrupted run stopped.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import { ArchivedWorkspaceError, assertWorkspaceActive, isArchived } from './archive-guard.js';
import { describeEditBoundaries, type RepoAccess, type RepoEditBoundary } from './edit-policy.js';
import { checkMerged, fetchDefaultBranch, type MergeEvidence } from './merge-detection.js';
import { loadFeatureConfig, saveFeatureConfig } from './workspace.js';
import { loadWorkspaceState, mutateWorkspaceState } from './workspace-state.js';
import { removeWorktree } from './worktree.js';
import { detectDefaultBranch } from '../utils/git.js';
import { getAheadBehind, getRemoteUrl } from '../utils/multi-git.js';
import type { ArchiveRecord, ArchiveRun, ArchiveRunRepo, ArchivedRepoRecord, Feature } from '../types.js';

export { ArchivedWorkspaceError, assertWorkspaceActive, isArchived };

/** Loads the manifest and applies {@link assertWorkspaceActive}. A missing manifest is left to the caller. */
export async function assertWorkspacePathActive(workspacePath: string, operation: string): Promise<void> {
  assertWorkspaceActive(await loadFeatureConfig(workspacePath), operation);
}

/** What archive will do with one repository. */
export type ArchiveRepoAction =
  /** A clean, delivered or parked worktree that archive removes. */
  | 'remove-worktree'
  /** The worktree is already gone (an earlier run, or removed by hand). */
  | 'already-removed'
  /** A read-only reference: archive never touches it. */
  | 'untouched'
  /** Work would be lost; nothing in the workspace is removed. */
  | 'blocked';

/** Per-repo archive decision. */
export interface ArchiveRepoPlan {
  name: string;
  access: RepoAccess;
  sourcePath: string;
  worktreePath?: string;
  branch: string | null;
  headSha: string | null;
  action: ArchiveRepoAction;
  /** Why, in one sentence. */
  reason: string;
  branchState: ArchivedRepoRecord['branchState'] | 'unmerged' | 'unpushed' | 'dirty' | 'unreadable';
  mergeEvidence?: MergeEvidence;
  prUrl?: string;
  /** Carried from an interrupted run that already deleted the branch. */
  branchDeleted?: boolean;
  remoteBranchDeleted?: boolean;
}

/** Options for {@link planArchive} and {@link archiveWorkspace}. */
export interface ArchiveOptions {
  /** Archive pushed-but-unmerged work, keeping its branch (decision B). */
  park?: boolean;
  /** Report what would happen without changing anything. */
  dryRun?: boolean;
  /** Fetch each default branch before judging merges (default true). */
  fetch?: boolean;
  /** Keep every branch, even merged ones this workspace created. */
  keepBranches?: boolean;
  /** Also delete merged branches on `origin` (decision A: off by default). */
  deleteRemoteBranches?: boolean;
}

/** What archive does with one feature branch, locally and on `origin`. */
export interface BranchCleanupPlan {
  repo: string;
  branch: string;
  /** The commit the branch must still point at to be deleted. */
  sha: string;
  sourcePath: string;
  local: 'delete' | 'keep' | 'absent';
  remote: 'delete' | 'keep' | 'absent' | 'not-requested' | 'not-checked';
  /** Why, in one sentence. */
  reason: string;
  /** After the run: what actually happened. */
  result?: { local: 'deleted' | 'kept' | 'absent' | 'failed'; remote: 'deleted' | 'kept' | 'absent' | 'failed' | 'not-requested' | 'not-checked'; error?: string };
}

/** Result of {@link planArchive} / {@link archiveWorkspace}. */
export interface ArchiveReport {
  workspacePath: string;
  workspaceId: string;
  dryRun: boolean;
  /** The workspace was already archived; nothing was done. */
  alreadyArchived: boolean;
  /** True when every repo can be archived. */
  ready: boolean;
  /** One sentence per blocked repo. Non-empty means nothing was removed. */
  blockers: string[];
  repos: ArchiveRepoPlan[];
  /** Workspace entries that stay after archive (the record). */
  kept: string[];
  /** Non-fatal observations: failed fetches, services not stopped, refresh failures. */
  notes: string[];
  /** Status of a previous run this one resumed. */
  resumedFrom?: ArchiveRun['status'];
  /** True when this run archived the workspace. */
  archived: boolean;
  archivedAt?: string;
  /** Failures while removing worktrees; re-run to resume. */
  errors: string[];
  /** Feature branches and whether archive deletes them. */
  branches: BranchCleanupPlan[];
}

async function exists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function gitOut(cwd: string, args: string[]): Promise<string | null> {
  const result = await execa('git', args, { cwd, reject: false }).catch(() => null);
  return result && result.exitCode === 0 ? result.stdout.trim() : null;
}

/** Porcelain status including untracked files; `null` when Git cannot read it. */
async function changedFileCount(repoPath: string): Promise<number | null> {
  const out = await gitOut(repoPath, ['status', '--porcelain', '-uall']);
  return out === null ? null : out.split('\n').filter(Boolean).length;
}

/** Branches checked out in any worktree of a repository, with their paths. */
function editableSignature(entries: Array<[string, string]>): string {
  return entries.map(([name, worktree]) => `${name}\0${path.resolve(worktree)}`).sort().join('\n');
}

async function realPath(target: string): Promise<string> {
  return fs.realpath(target).catch(() => path.resolve(target));
}

async function checkedOutBranches(sourcePath: string): Promise<Map<string, string>> {
  const out = await gitOut(sourcePath, ['worktree', 'list', '--porcelain']);
  const branches = new Map<string, string>();
  let worktree = '';
  for (const line of (out ?? '').split('\n')) {
    if (line.startsWith('worktree ')) worktree = line.slice('worktree '.length);
    else if (line.startsWith('branch refs/heads/')) branches.set(line.slice('branch refs/heads/'.length), worktree);
  }
  return branches;
}

/**
 * Decides what happens to each feature branch. A branch is deleted only when
 * it is proven merged, this workspace created it, it still points at the
 * archived commit, and no other worktree has it checked out.
 */
async function planBranches(feature: Feature, repos: ArchiveRepoPlan[], options: ArchiveOptions): Promise<BranchCleanupPlan[]> {
  const plans: BranchCleanupPlan[] = [];
  for (const repo of repos) {
    if (repo.access === 'reference' || !repo.branch || !repo.headSha || repo.action === 'blocked') continue;
    const plan: BranchCleanupPlan = {
      repo: repo.name,
      branch: repo.branch,
      sha: repo.headSha,
      sourcePath: repo.sourcePath,
      local: 'keep',
      remote: options.deleteRemoteBranches ? 'keep' : 'not-requested',
      reason: '',
    };
    plans.push(plan);
    const created = feature.createdBranches?.[repo.name];
    const tip = await gitOut(repo.sourcePath, ['rev-parse', '--verify', '--quiet', `refs/heads/${repo.branch}`]);
    const defaultBranch = await detectDefaultBranch(repo.sourcePath);
    // The workspace's own worktree does not count while this run removes it;
    // compare real paths, since Git records worktrees with symlinks resolved.
    const own = repo.action === 'remove-worktree' && repo.worktreePath ? await realPath(repo.worktreePath) : null;
    let elsewhere: [string, string] | undefined;
    for (const [branch, worktree] of (await checkedOutBranches(repo.sourcePath)).entries()) {
      if (branch === repo.branch && (await realPath(worktree)) !== own) {
        elsewhere = [branch, worktree];
        break;
      }
    }

    if (options.keepBranches) plan.reason = 'kept on request';
    else if (repo.branchState !== 'merged') plan.reason = 'not merged; kept so the work can be picked up again';
    else if (repo.branch === defaultBranch) plan.reason = 'the default branch is never deleted';
    else if (created === undefined) plan.reason = feature.createdBranches ? 'this workspace did not create it' : 'provenance unknown: this workspace predates branch records';
    else if (created !== repo.branch) plan.reason = `this workspace created "${created}", not this branch`;
    else if (elsewhere) plan.reason = `checked out in ${path.resolve(elsewhere[1])}`;
    else if (tip !== null && tip !== repo.headSha) plan.reason = `moved to ${tip.slice(0, 7)} since it was merged`;
    else {
      plan.local = tip === null ? 'absent' : 'delete';
      plan.reason = repo.mergeEvidence === 'pull-request' ? `merged through ${repo.prUrl ?? 'a pull request'}` : 'merged into the default branch';
    }

    if (!options.deleteRemoteBranches || plan.local === 'keep') continue;
    if (options.fetch === false) {
      plan.remote = 'not-checked';
      continue;
    }
    const remote = await execa('git', ['ls-remote', '--heads', 'origin', `refs/heads/${repo.branch}`], { cwd: repo.sourcePath, reject: false, timeout: 60_000 }).catch(() => null);
    const remoteSha = remote && remote.exitCode === 0 ? remote.stdout.trim().split(/\s+/)[0] || null : undefined;
    if (remoteSha === undefined) plan.remote = 'not-checked';
    else if (remoteSha === null) plan.remote = 'absent';
    else if (remoteSha === repo.headSha) plan.remote = 'delete';
    else plan.remote = 'keep';
  }
  return plans;
}

/** Deletes the planned branches. Failures are reported, never fatal: the worktrees are already returned. */
async function deleteBranches(plans: BranchCleanupPlan[], notes: string[]): Promise<void> {
  for (const plan of plans) {
    const result: NonNullable<BranchCleanupPlan['result']> = { local: plan.local === 'delete' ? 'kept' : plan.local === 'absent' ? 'absent' : 'kept', remote: plan.remote === 'delete' ? 'kept' : plan.remote === 'keep' ? 'kept' : plan.remote };
    if (plan.local === 'delete') {
      // Compare-and-delete: refuses when the branch moved after planning.
      const deleted = await execa('git', ['update-ref', '-d', `refs/heads/${plan.branch}`, plan.sha], { cwd: plan.sourcePath, reject: false }).catch((error: unknown) => ({ exitCode: 1, stderr: String(error) }));
      if (deleted.exitCode === 0) result.local = 'deleted';
      else {
        result.local = 'failed';
        result.error = String(deleted.stderr ?? '').split('\n')[0];
      }
    }
    if (plan.remote === 'delete') {
      const pushed = await execa('git', ['push', `--force-with-lease=refs/heads/${plan.branch}:${plan.sha}`, 'origin', '--delete', `refs/heads/${plan.branch}`], { cwd: plan.sourcePath, reject: false, timeout: 120_000 })
        .catch((error: unknown) => ({ exitCode: 1, stderr: String(error) }));
      if (pushed.exitCode === 0) result.remote = 'deleted';
      else {
        result.remote = 'failed';
        result.error = [result.error, String(pushed.stderr ?? '').split('\n').find((l) => l.trim())].filter(Boolean).join('; ');
      }
    }
    if (result.local === 'failed' || result.remote === 'failed') {
      notes.push(`${plan.repo}: branch "${plan.branch}" was not fully deleted (${result.error ?? 'unknown error'}); it points at ${plan.sha.slice(0, 7)}.`);
    }
    plan.result = result;
  }
}

function recordFromJournal(entry: ArchiveRunRepo): ArchiveRepoPlan {
  return {
    name: entry.name,
    access: entry.access,
    sourcePath: entry.sourcePath,
    worktreePath: entry.worktreePath,
    branch: entry.branch ?? null,
    headSha: entry.headSha ?? null,
    action: 'already-removed',
    reason: 'worktree removed by an earlier archive run',
    branchState: entry.branchState,
    mergeEvidence: entry.mergeEvidence,
    prUrl: entry.prUrl,
    ...(entry.branchDeleted ? { branchDeleted: true } : {}),
    ...(entry.remoteBranchDeleted ? { remoteBranchDeleted: true } : {}),
  };
}

async function planRepo(
  boundary: RepoEditBoundary,
  options: ArchiveOptions,
  journal: Map<string, ArchiveRunRepo>,
  notes: string[],
): Promise<ArchiveRepoPlan> {
  const base = {
    name: boundary.name,
    access: boundary.access,
    sourcePath: boundary.sourcePath,
  };
  if (!boundary.editable) {
    return { ...base, branch: null, headSha: null, action: 'untouched', reason: 'read-only reference; never changed', branchState: 'reference' };
  }

  const worktreePath = boundary.path;
  const previous = journal.get(boundary.name);
  // The journal only speaks for a worktree that is still gone. One that exists
  // again (recreated since) is checked from scratch like any other.
  if (previous && !(await exists(worktreePath))) {
    return recordFromJournal({ ...previous, worktreePath });
  }

  if (!(await exists(worktreePath))) {
    // Removed outside ContextSpace. Its branch lives on in the source repo.
    const branch = boundary.branch ?? null;
    const headSha = branch ? await gitOut(boundary.sourcePath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]) : null;
    return {
      ...base,
      worktreePath,
      branch,
      headSha,
      action: 'already-removed',
      reason: 'worktree is already gone; its branch is kept',
      branchState: 'parked',
    };
  }

  const withPath = { ...base, worktreePath };
  const headSha = await gitOut(worktreePath, ['rev-parse', 'HEAD']);
  const symbolic = await gitOut(worktreePath, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const branch = symbolic || null;
  const changed = await changedFileCount(worktreePath);
  if (!headSha || changed === null) {
    return { ...withPath, branch, headSha, action: 'blocked', reason: `${boundary.name}: Git cannot read the worktree at ${worktreePath}.`, branchState: 'unreadable' };
  }
  if (changed > 0) {
    return {
      ...withPath,
      branch,
      headSha,
      action: 'blocked',
      reason: `${boundary.name}: ${changed} uncommitted file(s). Commit and push them, or discard them, first.`,
      branchState: 'dirty',
    };
  }

  const defaultBranch = await detectDefaultBranch(worktreePath);
  const remoteUrl = await getRemoteUrl(worktreePath);
  if (remoteUrl && options.fetch !== false) {
    const fetchError = await fetchDefaultBranch(worktreePath, defaultBranch);
    if (fetchError) notes.push(`${boundary.name}: could not fetch origin/${defaultBranch} (${fetchError}); judged against the last fetched state.`);
  }

  const merge = await checkMerged({ repoPath: worktreePath, sha: headSha, branch, defaultBranch, remoteUrl });
  if (merge.merged) {
    return {
      ...withPath,
      branch,
      headSha,
      action: 'remove-worktree',
      reason: `${branch ?? 'HEAD'} is ${merge.detail}`,
      branchState: 'merged',
      mergeEvidence: merge.evidence === 'none' ? undefined : merge.evidence,
      prUrl: merge.prUrl,
    };
  }

  const { ahead } = branch ? await getAheadBehind(worktreePath, branch) : { ahead: null };
  if (!branch) {
    return {
      ...withPath, branch, headSha, action: 'blocked',
      reason: `${boundary.name}: detached HEAD at ${headSha.slice(0, 7)} with commits that are not on ${defaultBranch}. Put them on a pushed branch first.`,
      branchState: 'unpushed',
    };
  }
  if (ahead === null || ahead > 0) {
    return {
      ...withPath, branch, headSha, action: 'blocked',
      reason: ahead === null
        ? `${boundary.name}: branch "${branch}" was never pushed. Push it (ctxspace finish) first.`
        : `${boundary.name}: ${ahead} commit(s) on "${branch}" are not pushed. Push them (ctxspace finish) first.`,
      branchState: 'unpushed',
    };
  }
  if (!options.park) {
    return {
      ...withPath, branch, headSha, action: 'blocked',
      reason: `${boundary.name}: "${branch}" is pushed but not merged into ${defaultBranch} (${merge.detail}). Archive with --park to keep the branch and archive anyway.`,
      branchState: 'unmerged',
    };
  }
  return {
    ...withPath, branch, headSha, action: 'remove-worktree',
    reason: `"${branch}" is pushed but not merged; parked on request, branch kept`,
    branchState: 'parked',
  };
}

/** Top-level workspace entries that are not worktrees archive removes. */
async function keptEntries(workspacePath: string, removed: string[]): Promise<string[]> {
  const entries = await fs.readdir(workspacePath).catch(() => [] as string[]);
  const removedSet = new Set(removed.map((p) => path.resolve(p)));
  return entries
    .filter((name) => !removedSet.has(path.resolve(workspacePath, name)))
    .sort();
}

/**
 * Decides, without changing anything, whether and how a workspace can be archived.
 * Fetches each editable repo's default branch unless `fetch` is false.
 */
export async function planArchive(workspacePath: string, options: ArchiveOptions = {}): Promise<ArchiveReport> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) throw new Error(`No workspace manifest found at ${workspacePath}.`);

  const report: ArchiveReport = {
    workspacePath,
    workspaceId: feature.id,
    dryRun: Boolean(options.dryRun),
    alreadyArchived: isArchived(feature),
    ready: false,
    blockers: [],
    repos: [],
    kept: [],
    notes: [],
    archived: false,
    errors: [],
    branches: [],
  };
  if (report.alreadyArchived) {
    report.archivedAt = feature.archivedAt;
    report.kept = await keptEntries(workspacePath, []);
    return report;
  }

  const state = await loadWorkspaceState(workspacePath);
  const previous = state.lastArchive;
  const resuming = previous && (previous.status === 'running' || previous.status === 'partial');
  if (resuming) report.resumedFrom = previous.status;
  const journal = new Map((resuming ? previous.repos : []).map((entry) => [entry.name, entry]));
  const effective = { ...options, park: options.park || Boolean(resuming && previous.parked) };

  for (const boundary of describeEditBoundaries(feature, workspacePath)) {
    report.repos.push(await planRepo(boundary, effective, journal, report.notes));
  }

  const cwd = process.cwd();
  for (const repo of report.repos) {
    if (repo.action === 'remove-worktree' && repo.worktreePath && isInside(repo.worktreePath, cwd)) {
      repo.action = 'blocked';
      repo.reason = `${repo.name}: this process is running inside ${repo.worktreePath}. Run archive from outside the worktree.`;
    }
  }

  report.blockers = report.repos.filter((r) => r.action === 'blocked').map((r) => r.reason);
  report.ready = report.blockers.length === 0;
  if (report.ready) report.branches = await planBranches(feature, report.repos, options);
  report.kept = await keptEntries(
    workspacePath,
    report.repos.filter((r) => r.action === 'remove-worktree' && r.worktreePath).map((r) => r.worktreePath!),
  );
  return report;
}

function toRecord(repo: ArchiveRepoPlan): ArchivedRepoRecord {
  const branchState = repo.branchState === 'merged' || repo.branchState === 'parked' ? repo.branchState : 'reference';
  return {
    name: repo.name,
    access: repo.access,
    sourcePath: repo.sourcePath,
    ...(repo.worktreePath && repo.access !== 'reference' ? { worktreePath: repo.worktreePath } : {}),
    ...(repo.access !== 'reference' ? { branch: repo.branch, headSha: repo.headSha } : {}),
    branchState,
    ...(repo.mergeEvidence && repo.mergeEvidence !== 'none' ? { mergeEvidence: repo.mergeEvidence } : {}),
    ...(repo.prUrl ? { prUrl: repo.prUrl } : {}),
    ...(repo.branchDeleted ? { branchDeleted: true } : {}),
    ...(repo.remoteBranchDeleted ? { remoteBranchDeleted: true } : {}),
  };
}

/** The manifest an archived workspace keeps: an in-place workspace over the original checkouts. */
function archivedManifest(feature: Feature, record: ArchiveRecord): Feature {
  const sources = feature.repos.map((repo, index) => feature.originalRepos?.[index] ?? repo);
  const next: Feature = {
    ...feature,
    mode: 'in-place',
    repos: sources,
    originalRepos: sources,
    archivedAt: record.archivedAt,
    archive: record,
    ...(feature.archive ? { archiveHistory: [...(feature.archiveHistory ?? []), feature.archive] } : {}),
  };
  delete next.isolatedRepos;
  delete next.repoBranches;
  return next;
}

async function stopWorkspaceServices(workspacePath: string, notes: string[]): Promise<void> {
  try {
    const { readRawRunningState, stopServices } = await import('../orchestration/runner.js');
    const running = await readRawRunningState(workspacePath);
    if ((running?.orchestrators ?? []).length > 0) {
      notes.push('Recorded orchestration tools were not stopped; stop them with ctxspace stop if they still run.');
    }
    if (!running || (running.services ?? []).length === 0) return;
    await stopServices(workspacePath);
  } catch (error) {
    notes.push(`Services could not be stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Archives a workspace: checks every editable repo, removes its worktrees
 * without force, and marks the manifest archived. Returns a blocked report and
 * changes nothing when any repo would lose work. Re-running after an
 * interruption resumes from the journal.
 */
export async function archiveWorkspace(workspacePath: string, options: ArchiveOptions = {}): Promise<ArchiveReport> {
  const previousRun = (await loadWorkspaceState(workspacePath)).lastArchive;
  const report = await planArchive(workspacePath, options);
  if (report.alreadyArchived || !report.ready || options.dryRun) return report;

  // Planning can take a while (fetches, gh). If a repository was prepared for
  // editing or added meanwhile, the plan no longer covers it: stop, change nothing.
  const planned = editableSignature(report.repos.filter((repo) => repo.access !== 'reference').map((repo) => [repo.name, repo.worktreePath ?? '']));
  const changedSincePlanning = async () => {
    const current = await loadFeatureConfig(workspacePath);
    if (!current || isArchived(current)) return true;
    const editable = describeEditBoundaries(current, workspacePath).filter((boundary) => boundary.editable);
    return editableSignature(editable.map((boundary) => [boundary.name, boundary.path])) !== planned;
  };
  const refuseChanged = () => {
    report.ready = false;
    report.blockers = ['The workspace changed while archive was checking it (a repository was prepared for editing or added). Nothing more was removed; run archive again.'];
  };
  if (await changedSincePlanning()) {
    refuseChanged();
    return report;
  }

  const startedAt = new Date().toISOString();
  const journal: ArchiveRunRepo[] = report.repos.map((repo) => ({
    ...toRecord(repo),
    removed: repo.action === 'already-removed',
  }));
  const parked = Boolean(options.park)
    || report.repos.some((r) => r.access !== 'reference' && r.branchState === 'parked')
    || Boolean(previousRun && (previousRun.status === 'running' || previousRun.status === 'partial') && previousRun.parked);
  const persist = (status: ArchiveRun['status']) =>
    mutateWorkspaceState(workspacePath, (state) => {
      state.lastArchive = {
        startedAt,
        completedAt: status === 'running' ? undefined : new Date().toISOString(),
        status,
        parked,
        repos: journal.map((entry) => ({ ...entry })),
      };
    });
  await persist('running');

  await stopWorkspaceServices(workspacePath, report.notes);

  const sources = new Set<string>();
  for (const [index, repo] of report.repos.entries()) {
    if (repo.action !== 'remove-worktree' || !repo.worktreePath) continue;
    sources.add(repo.sourcePath);
    try {
      await removeWorktree(repo.sourcePath, repo.worktreePath, false);
      journal[index]!.removed = true;
      delete journal[index]!.error;
      repo.action = 'already-removed';
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n').find((l) => l.trim()) ?? error.message : String(error);
      journal[index]!.error = message;
      report.errors.push(`${repo.name}: could not remove ${repo.worktreePath}: ${message}`);
    }
    await persist('running');
  }
  for (const source of sources) {
    await execa('git', ['worktree', 'prune'], { cwd: source, reject: false }).catch(() => null);
  }

  if (report.errors.length > 0) {
    await persist('partial');
    return report;
  }

  // Branches go only after their worktrees: Git keeps a checked-out branch.
  await deleteBranches(report.branches, report.notes);
  for (const plan of report.branches) {
    const entry = journal.find((repo) => repo.name === plan.repo);
    if (!entry) continue;
    if (plan.result?.local === 'deleted' || (plan.local === 'absent' && entry.branchDeleted)) entry.branchDeleted = true;
    if (plan.result?.remote === 'deleted') entry.remoteBranchDeleted = true;
  }
  await persist('running');

  if (await changedSincePlanning()) {
    refuseChanged();
    report.errors.push(report.blockers[0]!);
    await persist('partial');
    return report;
  }
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) throw new Error(`No workspace manifest found at ${workspacePath}.`);
  const archivedAt = new Date().toISOString();
  const record: ArchiveRecord = {
    archivedAt,
    previousMode: feature.mode ?? 'worktree',
    parked,
    repos: journal.map(({ removed: _removed, error: _error, ...entry }) => entry),
  };
  await saveFeatureConfig(workspacePath, archivedManifest(feature, record));
  await persist('completed');

  try {
    const { refreshWorkspace } = await import('./refresh.js');
    await refreshWorkspace(workspacePath);
  } catch (error) {
    report.notes.push(`Generated context was not refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }

  report.archived = true;
  report.archivedAt = archivedAt;
  report.kept = await keptEntries(workspacePath, []);
  return report;
}

/** Result of {@link unarchiveWorkspace}. */
export interface UnarchiveReport {
  workspacePath: string;
  workspaceId: string;
  /** False when the workspace was not archived. */
  restored: boolean;
  notes: string[];
}

/**
 * Restores an archived workspace as active. It stays an in-place workspace
 * whose repositories are read-only references; prepare a repository for
 * editing (isolate) to work in it again. Nothing is checked out or recreated.
 */
export async function unarchiveWorkspace(workspacePath: string): Promise<UnarchiveReport> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) throw new Error(`No workspace manifest found at ${workspacePath}.`);
  const report: UnarchiveReport = { workspacePath, workspaceId: feature.id, restored: false, notes: [] };
  if (!isArchived(feature)) return report;

  const next: Feature = { ...feature };
  delete next.archivedAt;
  if (next.archive) next.archive = { ...next.archive, unarchivedAt: new Date().toISOString() };
  await saveFeatureConfig(workspacePath, next);
  report.restored = true;

  try {
    const { refreshWorkspace } = await import('./refresh.js');
    await refreshWorkspace(workspacePath);
  } catch (error) {
    report.notes.push(`Generated context was not refreshed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return report;
}
