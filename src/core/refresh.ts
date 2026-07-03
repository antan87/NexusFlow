/**
 * @module core/refresh
 * Headless workspace refresh — regenerates context files, maps, and plans for
 * a workspace using the analysis cache, so only repos whose content changed
 * are re-analyzed and only their maps are rewritten. Backs the CLI command,
 * the HTTP API, and the scheduler alike.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadFeatureConfig } from './workspace.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import type { WorkspaceContext } from '../types.js';

/** Options for a headless refresh run. */
export interface RefreshOptions {
  /** Restrict regeneration to a single repo (by directory name). */
  onlyRepo?: string;
  /** Only refresh base-layer maps and codebase knowledge. */
  baseOnly?: boolean;
  /** Ignore the analysis cache and re-analyze every repo. */
  force?: boolean;
}

/** Outcome of a headless refresh run. */
export interface RefreshReport {
  /** Absolute path to the workspace. */
  workspacePath: string;
  /** Names of repos that were re-analyzed because their content changed. */
  analyzedRepos: string[];
  /** Names of repos whose cached analysis was reused. */
  reusedRepos: string[];
  /** Whether the handoff bundle was refreshed too. */
  refreshedHandoff: boolean;
}

/**
 * Refreshes a workspace's context files, maps, and plans. Throws if the
 * workspace configuration cannot be loaded.
 *
 * Token-saving behavior: repos with an unchanged git fingerprint reuse their
 * cached analysis and keep their existing map files byte-identical, so AI
 * assistants' prompt caches stay valid across refreshes.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @param options       - Refresh options.
 * @returns A report of what was analyzed vs reused.
 */
export async function refreshWorkspace(
  workspacePath: string,
  options: RefreshOptions = {},
): Promise<RefreshReport> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(
      `Failed to load workspace configuration. Ensure nexusflow.json exists at ${workspacePath}.`,
    );
  }

  const allRepos = feature.repos.map((r) => ({
    name: path.basename(r),
    path: r,
    defaultBranch: 'main',
  }));

  const { analysis, analyzed, reused } = await analyzeAllReposCached(
    allRepos,
    workspacePath,
    { force: options.force },
  );

  const ctx: WorkspaceContext = { feature, repos: allRepos, analysis };

  await generateContextFiles(
    ctx,
    feature.assistants,
    workspacePath,
    options.onlyRepo,
    options.baseOnly,
    options.force ? undefined : analyzed,
  );

  // If a handoff bundle exists, refresh it too — it reuses the cached
  // analysis, so this no longer triggers a second full analysis pass.
  let refreshedHandoff = false;
  const handoffPath = path.join(workspacePath, 'nexusflow-handoff.md');
  if (!options.baseOnly) {
    try {
      await fs.access(handoffPath);
      const { handoffCommand } = await import('../commands/handoff.js');
      await handoffCommand(workspacePath);
      refreshedHandoff = true;
    } catch {
      // No handoff file, or refresh failed — non-fatal either way.
    }
  }

  return {
    workspacePath,
    analyzedRepos: analyzed,
    reusedRepos: reused,
    refreshedHandoff,
  };
}
