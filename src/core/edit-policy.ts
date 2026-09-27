/**
 * @module core/edit-policy
 * The single rule for where a workspace may change files.
 *
 * In an in-place workspace the attached checkouts are read-only references:
 * nothing ContextSpace does may commit, push, revert or fast-forward them.
 * "Prepare for editing" isolates a repository into a worktree inside the
 * workspace, and only that worktree is editable. Worktree-mode repositories
 * are editable from creation. Every mutation surface (CLI, GUI server, MCP)
 * asks this module instead of re-deriving the rule.
 */

import * as path from 'node:path';

import type { Feature } from '../types.js';
import { isInPlace, isRepoIsolated, resolveFeatureRepoPath } from '../utils/feature.js';

/** How a repository is attached to a workspace. */
export type RepoAccess =
  /** An attached checkout the workspace may read but never change. */
  | 'reference'
  /** A reference repository prepared for editing in its own worktree. */
  | 'isolated'
  /** A worktree created with the workspace (worktree mode). */
  | 'worktree';

/** Where one repository may be edited. */
export interface RepoEditBoundary {
  name: string;
  access: RepoAccess;
  editable: boolean;
  /** The path the workspace reads and, when editable, edits. */
  path: string;
  /** The user's own checkout the repository came from. */
  sourcePath: string;
  /** The branch edits land on; absent for references (they follow the host). */
  branch?: string;
  baseBranch?: string;
}

/** User-facing sentence explaining why a reference repo was not changed. */
export function referenceRepoMessage(repoName: string): string {
  return `"${repoName}" is a read-only reference. Prepare it for editing (ctxspace isolate ${repoName}) to give it its own branch in this workspace.`;
}

/**
 * Raised when a mutation explicitly targets a read-only reference repository.
 * Surfaces map it to a conflict response instead of a generic failure.
 */
export class ReferenceRepoError extends Error {
  readonly code = 'REFERENCE_REPO';
  constructor(readonly repos: string[]) {
    super(repos.length === 1
      ? referenceRepoMessage(repos[0]!)
      : `${repos.map((r) => `"${r}"`).join(', ')} are read-only references. Prepare them for editing (ctxspace isolate <repo>) first.`);
    this.name = 'ReferenceRepoError';
  }
}

/**
 * Describes the edit boundary of every repository in a workspace.
 *
 * @param feature       - The workspace manifest.
 * @param workspacePath - The workspace directory's current location.
 */
export function describeEditBoundaries(feature: Feature, workspacePath: string): RepoEditBoundary[] {
  return feature.repos.map((repoEntry, index) => {
    const name = path.basename(repoEntry);
    const sourcePath = feature.originalRepos?.[index] ?? repoEntry;
    const repoPath = resolveFeatureRepoPath(feature, workspacePath, repoEntry);
    if (!isInPlace(feature)) {
      return {
        name,
        access: 'worktree',
        editable: true,
        path: repoPath,
        sourcePath,
        branch: feature.repoBranches?.[name] ?? feature.branchName,
      };
    }
    if (isRepoIsolated(feature, repoEntry)) {
      const isolated = Object.entries(feature.isolatedRepos ?? {})
        .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
      return {
        name,
        access: 'isolated',
        editable: true,
        path: repoPath,
        sourcePath,
        branch: isolated?.branchName,
        baseBranch: isolated?.baseBranch,
      };
    }
    return { name, access: 'reference', editable: false, path: repoPath, sourcePath };
  });
}

/** Names of the repositories a workspace must not change. */
export function referenceRepoNames(feature: Feature, workspacePath: string): string[] {
  return describeEditBoundaries(feature, workspacePath)
    .filter((boundary) => !boundary.editable)
    .map((boundary) => boundary.name);
}

/**
 * Throws {@link ReferenceRepoError} when any named repository is a reference.
 *
 * @param feature       - The workspace manifest.
 * @param workspacePath - The workspace directory.
 * @param repoNames     - Repositories an operation is about to change.
 */
export function assertReposEditable(feature: Feature, workspacePath: string, repoNames: string[]): void {
  const references = new Set(referenceRepoNames(feature, workspacePath));
  const blocked = repoNames.filter((name) => references.has(name));
  if (blocked.length > 0) throw new ReferenceRepoError(blocked);
}
