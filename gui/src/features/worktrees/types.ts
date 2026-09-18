/**
 * ContextSpace Worktree & Bifocal Metadata Domain Contracts
 * File: gui/src/features/worktrees/types.ts
 */

export type WorktreeStatusType =
  | 'active_review'
  | 'agent_running'
  | 'clean'
  | 'dirty'
  | 'host_readonly'
  | 'provisioning'
  | 'stale';

export interface WorktreeCommitInfo {
  headSha: string;
  shortSha: string;
  commitMessage?: string;
  author?: string;
  timestamp?: string;
}

/**
 * Branch-keyed Worktree Descriptor with Bifocal Metadata:
 * Tier 1: Prominent Human Title & Intent
 * Tier 2: Monospace Git Branch, Commit SHA, Dirty Telemetry, and Pin Lock
 */
export interface WorktreeDescriptor {
  id: string;
  repoName: string;
  repoPath: string;
  branchName: string;
  title: string;
  intent?: string;
  commitSha: string;
  dirtyFilesCount: number;
  status: WorktreeStatusType;
  isPinned: boolean;
  isHostReadOnly: boolean;
  worktreePath: string;
  sourcePath?: string;
  commitInfo?: WorktreeCommitInfo;
  workspaceId?: string;
  baseBranch?: string;
  isolatedAt?: string;
  lastActiveAt?: string;
}

export interface RepoWorktreeGroup {
  repoName: string;
  repoPath: string;
  isHostRepo: boolean;
  sourcePath?: string;
  defaultBranch?: string;
  worktrees: WorktreeDescriptor[];
}
