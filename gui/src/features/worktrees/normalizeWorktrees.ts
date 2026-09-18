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
    const isIsolated = Boolean(isolated);

    const worktrees: WorktreeDescriptor[] = [];

    if (isIsolated && isolated) {
      // Dynamic isolated feature worktree
      const branch = isolated.branchName || 'head';
      worktrees.push({
        id: `wt-${repoName}-${branch}-${sanitizedRepoPath}`,
        workspaceId: feature.branchName || '',
        repoName,
        repoPath,
        sourcePath: feature.originalRepos?.find((r: string) => r.endsWith(repoName)) || repoPath,
        worktreePath: isolated.worktreePath || repoPath,
        branchName: branch,
        baseBranch: isolated.baseBranch || 'main',
        title: feature.description && feature.description.length > 3 && feature.description.length < 55
          ? feature.description
          : formatBranchTitle(branch),
        intent: feature.description || `Isolated feature worktree on ${branch}`,
        status: (status?.changedFiles ?? 0) > 0 ? 'dirty' : 'clean',
        isPinned: true,
        isHostReadOnly: false,
        commitSha: 'latest',
        commitInfo: {
          headSha: 'latest',
          shortSha: 'head',
          commitMessage: feature.description || 'Feature worktree',
        },
        dirtyFilesCount: Math.max(0, status?.changedFiles ?? 0),
        isolatedAt: isolated.isolatedAt,
      });
    }

    // Always include host repo reference for context
    worktrees.push({
      id: `wt-${repoName}-host-${sanitizedRepoPath}`,
      workspaceId: feature.branchName || '',
      repoName,
      repoPath,
      sourcePath: repoPath,
      worktreePath: repoPath,
      branchName: feature.repoBranches?.[repoName] || 'main',
      baseBranch: 'main',
      title: `${repoName} Host Baseline`,
      intent: 'Read-only host reference branch on main',
      status: 'host_readonly',
      isPinned: true,
      isHostReadOnly: true,
      commitSha: 'main',
      commitInfo: {
        headSha: 'main',
        shortSha: 'main',
        commitMessage: 'Host reference commit',
      },
      dirtyFilesCount: 0,
      isolatedAt: feature.createdAt,
    });

    groups.push({
      repoName,
      repoPath,
      isHostRepo: !isIsolated,
      sourcePath: repoPath,
      defaultBranch: 'main',
      worktrees,
    });
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
