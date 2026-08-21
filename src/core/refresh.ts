/**
 * @module core/refresh
 * Headless workspace refresh — regenerates the workspace context files using the
 * analysis cache, so only repos whose content changed are re-analyzed. Backs the
 * CLI command, the HTTP API, and the scheduler alike.
 *
 * Every generated file describes the whole workspace, so a refresh is all or
 * nothing; there is no per-repo or base-only subset to ask for.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { loadFeatureConfig, resolveRepoInfos } from './workspace.js';
import { analyzeAllReposCached } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import type { WorkspaceContext } from '../types.js';

/** Options for a headless refresh run. */
export interface RefreshOptions {
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
 * Refreshes a workspace's context files and plan. Throws if the workspace
 * configuration cannot be loaded.
 *
 * Token-saving behavior: a repo whose git fingerprint is unchanged reuses its
 * cached analysis instead of being re-scanned. The fingerprint also carries this
 * package's version, so an upgrade re-analyzes everything once rather than
 * regenerating from stale data.
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

  const allRepos = await resolveRepoInfos(feature.repos);

  const { analysis, analyzed, reused } = await analyzeAllReposCached(
    allRepos,
    workspacePath,
    { force: options.force },
  );

  const ctx: WorkspaceContext = { feature, repos: allRepos, analysis };

  await generateContextFiles(ctx, feature.assistants, workspacePath);

  // Ensure .code-workspace and .vscode/settings.json exist
  try {
    const workspaceName = path.basename(workspacePath);
    const codeWorkspacePath = path.join(workspacePath, `${workspaceName}.code-workspace`);
    try {
      await fs.access(codeWorkspacePath);
    } catch {
      const inPlace = feature.mode === 'in-place';
      const codeWorkspace = {
        folders: [
          { path: '.', name: `${workspaceName} (workspace)` },
          ...allRepos.map((repo) => ({ path: inPlace ? repo.path : repo.name, name: repo.name })),
        ],
        settings: { 'search.useIgnoreFiles': false },
      };
      await fs.writeFile(codeWorkspacePath, JSON.stringify(codeWorkspace, null, 2) + '\n', 'utf-8');
    }

    const vscodeDir = path.join(workspacePath, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');
    try {
      await fs.access(settingsPath);
    } catch {
      await fs.mkdir(vscodeDir, { recursive: true });
      await fs.writeFile(settingsPath, JSON.stringify({ 'search.useIgnoreFiles': false }, null, 2) + '\n', 'utf-8');
    }
  } catch (err) {
    console.warn('Warning: Failed to ensure .code-workspace or .vscode/settings.json during refresh:', err);
  }

  // If a handoff bundle exists, refresh it too — it reuses the cached
  // analysis, so this no longer triggers a second full analysis pass.
  let refreshedHandoff = false;
  const handoffPath = path.join(workspacePath, 'nexusflow-handoff.md');
  {
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
