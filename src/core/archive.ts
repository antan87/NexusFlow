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
}

/** Options for {@link planArchive} and {@link archiveWorkspace}. */
export interface ArchiveOptions {
  /** Archive pushed-but-unmerged work, keeping its branch (decision B). */
  park?: boolean;
  /** Report what would happen without changing anything. */
  dryRun?: boolean;
  /** Fetch each default branch before judging merges (default true). */
  fetch?: boolean;
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
  if (previous?.removed || (previous && !(await exists(worktreePath)))) {
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
  const report = await planArchive(workspacePath, options);
  if (report.alreadyArchived || !report.ready || options.dryRun) return report;

  const startedAt = new Date().toISOString();
  const journal: ArchiveRunRepo[] = report.repos.map((repo) => ({
    ...toRecord(repo),
    removed: repo.action === 'already-removed',
  }));
  const parked = Boolean(options.park) || report.repos.some((r) => r.branchState === 'parked' && r.action === 'remove-worktree');
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
