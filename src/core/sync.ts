/**
 * @module core/sync
 * Headless workspace sync — rebases every repo in a workspace onto its base
 * branch, records the per-repo outcome to workspace state, and regenerates
 * context files. Produces no console output, so it can back the CLI, the HTTP
 * API, and the MCP tool alike.
 */

import * as path from 'node:path';

import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { isInPlace } from '../utils/feature.js';
import { recordRepoSync } from './workspace-state.js';
import { getWorkspaceRepos, rebaseRepo } from '../utils/multi-git.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import type { SyncStatus, WorkspaceContext } from '../types.js';

/** Sync outcome for a single repo. */
export interface RepoSyncReport {
  /** Directory name of the repo. */
  name: string;
  /** Base branch the repo rebases onto (e.g. 'main'). */
  baseBranch: string;
  /** Classified outcome. */
  status: SyncStatus;
  /** Human-readable message. */
  message: string;
  /** Conflict stderr — populated only for `status === 'conflict'`. */
  conflict?: string;
  /** Paths that had merge conflicts — populated only for `status === 'conflict'`. */
  conflictFiles?: string[];
}

/** Aggregated result of syncing an entire workspace. */
export interface SyncReport {
  /** Absolute path to the workspace. */
  workspacePath: string;
  /** Feature branch name being synced. */
  branchName: string;
  /** Per-repo outcomes, in workspace order. */
  repos: RepoSyncReport[];
  /** Count of repos that landed cleanly (up-to-date, rebased, or stash-conflict). */
  syncedCount: number;
  /** Count of repos with a genuine merge conflict. */
  conflictCount: number;
  /** Count of repos that failed for infrastructure reasons (fetch/auth, etc.). */
  errorCount: number;
  /** Whether context files/maps were regenerated (only when content changed). */
  contextRefreshed: boolean;
}

/** A sync status counts as "synced" when the rebase itself landed. */
function isSynced(status: SyncStatus): boolean {
  return status === 'up-to-date' || status === 'rebased' || status === 'stash-conflict';
}

/**
 * Syncs all repos in a workspace. Throws if the workspace configuration cannot
 * be loaded; individual repo failures are captured in the returned report
 * rather than thrown.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @returns A structured report of every repo's outcome.
 */
export async function syncWorkspace(workspacePath: string): Promise<SyncReport> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(
      `Failed to load workspace configuration. Ensure nexusflow.json exists at ${workspacePath}.`,
    );
  }

  // In-place workspaces work directly in the source repos on whatever branch
  // the user has checked out — rebasing those from under them would be a
  // destructive surprise. Sync is a deliberate no-op.
  if (isInPlace(feature)) {
    return {
      workspacePath,
      branchName: feature.branchName,
      repos: feature.repos.map((repoPath) => ({
        name: path.basename(repoPath),
        baseBranch: '',
        status: 'up-to-date' as SyncStatus,
        message: 'In-place workspace — branches are managed by you; sync skipped.',
      })),
      syncedCount: 0,
      conflictCount: 0,
      errorCount: 0,
      contextRefreshed: false,
    };
  }

  const repos = await getWorkspaceRepos(workspacePath);

  const repoReports: RepoSyncReport[] = [];
  let syncedCount = 0;
  let conflictCount = 0;
  let errorCount = 0;

  for (const repo of repos) {
    const defaultBranch = repo.defaultBranch || 'main';
    const result = await rebaseRepo(repo.path, defaultBranch);

    await recordRepoSync(workspacePath, repo.name, {
      status: result.status,
      message: result.message,
    });

    repoReports.push({
      name: repo.name,
      baseBranch: defaultBranch,
      status: result.status,
      message: result.message,
      conflict: result.conflict,
      conflictFiles: result.conflictFiles,
    });

    if (isSynced(result.status)) syncedCount++;
    else if (result.status === 'conflict') conflictCount++;
    else errorCount++;
  }

  // Regenerate context only when a rebase actually changed repo content
  // ('rebased' or 'stash-conflict'). When every repo was already up to date,
  // skipping regeneration keeps the context files byte-identical — no wasted
  // analysis and no invalidated AI prompt caches. The cached analyzer then
  // limits the work to the repos that changed. A regen failure must never
  // fail the sync itself — the rebases already happened.
  const contentChanged = repoReports.some(
    (r) => r.status === 'rebased' || r.status === 'stash-conflict',
  );
  let contextRefreshed = false;
  if (contentChanged) {
    try {
      const allRepos = await resolveRepoInfos(feature.repos);

      const { analysis, analyzed } = await analyzeAllReposCached(allRepos, workspacePath);
      const ctx: WorkspaceContext = { feature, repos: allRepos, analysis };
      await generateContextFiles(ctx, feature.assistants, workspacePath);
      contextRefreshed = true;
    } catch {
      // Best-effort regeneration; ignore failures.
    }
  }

  return {
    workspacePath,
    branchName: feature.branchName,
    repos: repoReports,
    syncedCount,
    conflictCount,
    errorCount,
    contextRefreshed,
  };
}
