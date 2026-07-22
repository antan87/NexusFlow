import type { VariantProps } from 'class-variance-authority';

import type { statusBadgeVariants } from '../components/ui/status-badge.js';
import type { WorkspaceStatus } from '../types.js';

type Tone = NonNullable<VariantProps<typeof statusBadgeVariants>['tone']>;

/** Maps a workspace sync status to a display label + status-language tone. */
export function syncMeta(status: WorkspaceStatus['syncStatus']): { label: string; tone: Tone } {
  switch (status) {
    case 'up-to-date':
      return { label: 'In sync', tone: 'success' };
    case 'rebased':
      return { label: 'Rebased', tone: 'accent' };
    case 'conflict':
    case 'stash-conflict':
      return { label: 'Sync conflict', tone: 'danger' };
    case 'error':
      return { label: 'Sync error', tone: 'danger' };
    default:
      return { label: 'Not synced', tone: 'idle' };
  }
}

/** Short repo basename from a full path (tolerates trailing separators). */
export function repoName(repoPath: string): string {
  return repoPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || repoPath;
}

/**
 * Finds the workspace a recorded agent session belongs to. Sessions record a
 * cwd (the workspace dir, or a repo dir for in-place features); the workspace
 * folder name equals the feature id/branchName — THE single matching
 * heuristic, shared by every session surface.
 */
export function findWorkspaceForSession<T extends { branchName: string; workspacePath: string; repos: string[] }>(
  workspaces: T[],
  sessionWorkspacePath: string,
): T | undefined {
  const base = repoName(sessionWorkspacePath);
  const byName = workspaces.find((w) => w.branchName === base);
  if (byName) return byName;
  // In-place sessions may record a source-repo cwd instead. Several in-place
  // workspaces can share a repo — an ambiguous match is treated as no match,
  // because resuming against an arbitrary workspace loses the session context.
  const byRepo = workspaces.filter((w) => w.repos.some((r) => repoName(r) === base));
  return byRepo.length === 1 ? byRepo[0] : undefined;
}
