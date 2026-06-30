/**
 * @module core/workspace-state
 * Persists per-repo sync/validation state for a workspace in a single
 * `.nexusflow-state.json` file at the workspace root.
 *
 * Mirrors the lightweight state-file pattern used by `orchestration/runner.ts`
 * for running services. Tracks, per repo: when it was last synced, the
 * classified result, whether it is pending re-validation, and the last
 * validation outcome — so agents no longer need to hand-roll their own state.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RepoSyncState, SyncStatus, WorkspaceState } from '../types.js';

/** Name of the per-repo state file, written at the workspace root. */
const STATE_FILE = '.nexusflow-state.json';

/**
 * Returns the path to the workspace state file.
 */
function getStatePath(workspacePath: string): string {
  return path.join(workspacePath, STATE_FILE);
}

/**
 * Loads the workspace state from disk, returning an empty skeleton when the
 * file does not exist or cannot be parsed.
 *
 * @param workspacePath - Absolute path to the workspace root.
 */
export async function loadWorkspaceState(
  workspacePath: string,
): Promise<WorkspaceState> {
  try {
    const raw = await fs.readFile(getStatePath(workspacePath), 'utf-8');
    const state = JSON.parse(raw) as WorkspaceState;
    // Defend against a malformed/legacy file lacking the repos map.
    if (!state.repos || typeof state.repos !== 'object') {
      state.repos = {};
    }
    state.workspacePath = workspacePath;
    return state;
  } catch {
    return {
      workspacePath,
      repos: {},
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Saves the workspace state to disk.
 *
 * @param state - The state to persist. Its `updatedAt` is refreshed on write.
 */
export async function saveWorkspaceState(state: WorkspaceState): Promise<void> {
  const toWrite: WorkspaceState = { ...state, updatedAt: new Date().toISOString() };
  const data = JSON.stringify(toWrite, null, 2) + '\n';
  await fs.writeFile(getStatePath(state.workspacePath), data, 'utf-8');
}

/**
 * Records the outcome of a sync attempt for a single repo and persists it.
 *
 * Sets `pendingValidation` to true when new commits were pulled in
 * (`status === 'rebased'`), signalling that the repo should be re-validated.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @param repoName      - Directory name of the repo.
 * @param result        - The classified sync status and message.
 * @returns The updated per-repo state entry.
 */
export async function recordRepoSync(
  workspacePath: string,
  repoName: string,
  result: { status: SyncStatus; message: string },
): Promise<RepoSyncState> {
  const state = await loadWorkspaceState(workspacePath);
  const existing = state.repos[repoName] ?? { repoName };

  const updated: RepoSyncState = {
    ...existing,
    repoName,
    lastSyncedAt: new Date().toISOString(),
    lastSyncStatus: result.status,
    lastSyncMessage: result.message,
    // New commits landed → the repo needs re-validation. Preserve an existing
    // pending flag otherwise (a no-op sync doesn't clear prior pending work).
    pendingValidation:
      result.status === 'rebased' ? true : existing.pendingValidation ?? false,
  };

  state.repos[repoName] = updated;
  await saveWorkspaceState(state);
  return updated;
}

/**
 * Records the result of a validation run (e.g. tests/e2e) for a repo and clears
 * its pending-validation flag. Provided for the validation flow that consumes
 * `pendingValidation`.
 *
 * @param workspacePath - Absolute path to the workspace root.
 * @param repoName      - Directory name of the repo.
 * @param result        - Whether validation passed or failed.
 * @returns The updated per-repo state entry.
 */
export async function markValidated(
  workspacePath: string,
  repoName: string,
  result: 'pass' | 'fail',
): Promise<RepoSyncState> {
  const state = await loadWorkspaceState(workspacePath);
  const existing = state.repos[repoName] ?? { repoName };

  const updated: RepoSyncState = {
    ...existing,
    repoName,
    lastValidationResult: result,
    lastValidatedAt: new Date().toISOString(),
    pendingValidation: false,
  };

  state.repos[repoName] = updated;
  await saveWorkspaceState(state);
  return updated;
}
