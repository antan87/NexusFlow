/**
 * @module utils/feature
 * Helpers for working with {@link Feature} manifests.
 */

import type { Feature, WorkspaceMode } from '../types.js';

/** The mode assumed for manifests written before {@link WorkspaceMode} existed. */
export const DEFAULT_WORKSPACE_MODE: WorkspaceMode = 'worktree';

/**
 * Normalizes a freshly-parsed `nexusflow.json` manifest so downstream code can
 * rely on `mode` being concrete. Manifests created before modes existed lack
 * the field and are always worktree-based.
 *
 * @param feature - The parsed manifest.
 * @returns The same feature with `mode` guaranteed to be set.
 */
export function normalizeFeature(feature: Feature): Feature {
  return { ...feature, mode: feature.mode ?? DEFAULT_WORKSPACE_MODE };
}

/**
 * Whether a feature works directly in the source repositories (no worktrees).
 */
export function isInPlace(feature: Feature): boolean {
  return feature.mode === 'in-place';
}

/**
 * The directory an agent session should run in for a feature.
 *
 * Worktree features use the workspace dir (all repos live inside it). An
 * in-place feature with a single repo runs in that repo's root so the agent
 * sees the code directly; with multiple repos it falls back to the workspace
 * dir, which holds WORKSPACE.md and the cross-repo context files.
 * Session discovery ({@link import('./session-finder.js')}) matches recorded
 * cwds against both the workspace path and every repo path, so either choice
 * stays resumable.
 */
export function getSessionCwd(feature: Feature): string {
  if (isInPlace(feature) && feature.repos.length === 1) {
    return feature.repos[0]!;
  }
  return feature.workspacePath;
}
