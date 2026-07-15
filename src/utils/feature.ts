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
