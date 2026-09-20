/**
 * Normalizes legacy Feature workspaces into RepoWorktreeGroups with Bifocal Metadata.
 * File: gui/src/features/worktrees/normalizeWorktrees.ts
 */
import type { Feature, WorkspaceStatus } from '../../types.js';
import type { RepoWorktreeGroup, WorktreeDescriptor } from './types.js';

export function normalizeWorktreeGroups(
  feature: Feature,
  status?: WorkspaceStatus
): RepoWorktreeGroup[] {
  if (!feature || typeof feature !== 'object') return [];

  const groups: RepoWorktreeGroup[] = [];

  const repos = Array.isArray(feature.repos) ? feature.repos : [];
  for (const repoPath of repos) {
    if (!repoPath || typeof repoPath !== 'string') continue;
    const repoName = repoPath.split(/[/\\]/).filter(Boolean).pop() || repoPath;
    const sanitizedRepoPath = repoPath.replace(/[^a-zA-Z0-9]/g, '_');
    const isolated = feature.isolatedRepos?.[repoName];
    const inPlace = feature.mode === 'in-place';
    const sourcePath = feature.originalRepos?.find((r) => r.split(/[/\\]/).filter(Boolean).pop() === repoName) || repoPath;
    const worktreePath = isolated?.worktreePath || repoPath;
    const branch = isolated?.branchName || (inPlace ? feature.repoBranches?.[repoName] : feature.branchName) || 'unknown';
    // Workspace status is aggregate; it cannot establish a per-repo count in a multi-repo workspace.
    const dirtyFilesCount = status && (repos.length === 1 || status.changedFiles === 0)
      ? Math.max(0, status.changedFiles) : null;
    const worktrees: WorktreeDescriptor[] = [{
      id: `wt-${repoName}-${branch}-${sanitizedRepoPath}`,
      workspaceId: feature.branchName || '',
      repoName,
      repoPath,
      sourcePath,
      worktreePath,
      branchName: branch,
      baseBranch: isolated?.baseBranch,
      title: feature.description && feature.description.length > 3 && feature.description.length < 55
        ? feature.description : formatBranchTitle(branch),
      intent: feature.description || `Working repository on ${branch}`,
      status: dirtyFilesCount === null ? 'unknown' : dirtyFilesCount > 0 ? 'dirty' : 'clean',
      isPinned: false,
      isHostReadOnly: false,
      commitSha: '',
      dirtyFilesCount,
      isolatedAt: isolated?.isolatedAt || feature.createdAt,
    }];

    // A source reference is distinct from the working checkout and has no live telemetry here.
    if (sourcePath !== worktreePath) {
      worktrees.push({
        id: `wt-${repoName}-host-${sanitizedRepoPath}`,
        workspaceId: feature.branchName || '',
        repoName,
        repoPath: sourcePath,
        sourcePath,
        worktreePath: sourcePath,
        branchName: isolated?.baseBranch || 'unknown',
        title: `${repoName} Host Baseline`,
        intent: 'Source repository reference',
        status: 'host_readonly',
        isPinned: false,
        isHostReadOnly: true,
        commitSha: '',
        dirtyFilesCount: null,
      });
    }
    groups.push({ repoName, repoPath, isHostRepo: inPlace && !isolated, sourcePath, worktrees });
  }

  return groups;
}

export function formatBranchTitle(branchName?: string): string {
  if (!branchName || typeof branchName !== 'string') return 'Untitled Worktree';
  const clean = branchName.replace(/^(feat|fix|bug|refactor|epic|chore)\//i, '');
  return clean
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
