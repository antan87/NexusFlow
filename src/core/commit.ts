/**
 * @module core/commit
 * Headless cross-repo commit engine shared by the CLI, the dashboard server,
 * the MCP server, and the finish flow. The CLI adds its own interactive
 * rendering and dry-run handling around/instead of this; consumers that just
 * need to commit changed repos call this directly.
 */

import {
  getWorkspaceRepos,
  getRepoStatus,
  commitAndPush,
} from '../utils/multi-git.js';

/** Options for {@link commitWorkspace}. */
export interface WorkspaceCommitOptions {
  /** Skip the `git push` step. */
  noPush?: boolean;
  /** Restrict the commit to these repos (by directory name). */
  repos?: string[];
}

/** Per-repo commit outcome. */
export interface RepoCommitReport {
  name: string;
  success: boolean;
  commitHash: string;
  filesChanged: number;
  message: string;
}

/** Aggregate result of committing across a workspace. */
export interface WorkspaceCommitReport {
  /** Only repos that had changes and were committed (or attempted). */
  repos: RepoCommitReport[];
  committedCount: number;
  failedCount: number;
}

/**
 * Commits (and optionally pushes) every repo in the workspace that has
 * working-tree changes.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param message       - Commit message applied to each repo.
 * @param options       - Push/repo-filter options.
 * @returns Per-repo reports plus committed/failed counts.
 * @throws If `options.repos` names a repo not in the workspace.
 */
export async function commitWorkspace(
  workspacePath: string,
  message: string,
  options?: WorkspaceCommitOptions,
): Promise<WorkspaceCommitReport> {
  let repos = await getWorkspaceRepos(workspacePath);

  if (options?.repos && options.repos.length > 0) {
    const filter = options.repos;
    const unknown = filter.filter((name) => !repos.some((r) => r.name === name));
    if (unknown.length > 0) {
      throw new Error(
        `Repositor${unknown.length === 1 ? 'y' : 'ies'} not in this workspace: ${unknown.join(', ')}. ` +
          `Available: ${repos.map((r) => r.name).join(', ')}`,
      );
    }
    repos = repos.filter((r) => filter.includes(r.name));
  }

  const reports: RepoCommitReport[] = [];
  for (const repo of repos) {
    const status = await getRepoStatus(repo.path);
    if (!status.hasChanges) {
      continue;
    }
    const result = await commitAndPush(repo.path, message, repo.branchName, {
      noPush: options?.noPush,
    });
    reports.push({
      name: repo.name,
      success: result.success,
      commitHash: result.commitHash,
      filesChanged: result.filesChanged,
      message: result.message,
    });
  }

  return {
    repos: reports,
    committedCount: reports.filter((r) => r.success).length,
    failedCount: reports.filter((r) => !r.success).length,
  };
}
