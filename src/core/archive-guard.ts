/**
 * @module core/archive-guard
 * The archived-workspace rule, kept free of imports so every mutation surface
 * (core, CLI, GUI server, MCP) can ask it without an import cycle.
 */

import type { Feature } from '../types.js';

/** Raised when an operation that changes repositories targets an archived workspace. */
export class ArchivedWorkspaceError extends Error {
  readonly code = 'WORKSPACE_ARCHIVED';
  constructor(readonly workspaceId: string, operation: string) {
    super(`Workspace "${workspaceId}" is archived, so it cannot ${operation}. Its record stays readable; unarchive it (ctxspace unarchive ${workspaceId}) to work in it again.`);
    this.name = 'ArchivedWorkspaceError';
  }
}

/** Whether a manifest describes an archived workspace. */
export function isArchived(feature: Pick<Feature, 'archivedAt'> | null | undefined): boolean {
  return Boolean(feature?.archivedAt);
}

/**
 * Throws {@link ArchivedWorkspaceError} for an archived workspace.
 *
 * @param operation - What the caller was about to do, completing "cannot …".
 */
export function assertWorkspaceActive(feature: Pick<Feature, 'id' | 'archivedAt'> | null | undefined, operation: string): void {
  if (feature && isArchived(feature)) throw new ArchivedWorkspaceError(feature.id, operation);
}
