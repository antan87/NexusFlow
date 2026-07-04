/**
 * @module core/status
 * Headless cross-repo status report for a workspace. Backs the MCP
 * `workspace_status` tool and the `finish` preflight, and can back a GUI
 * status route. Throws only if the workspace manifest cannot be read.
 */

import {
  getWorkspaceRepos,
  getRepoBranch,
  getRepoStatus,
  getAheadBehind,
  getRemoteUrl,
  type RepoStatusFile,
} from '../utils/multi-git.js';

/** Full status for a single repo in a workspace. */
export interface RepoStatusReport {
  name: string;
  path: string;
  /** Current branch, or `null` when the repo is in a detached-HEAD state. */
  branch: string | null;
  /** The feature branch the workspace expects every repo to be on. */
  expectedBranch: string;
  onExpectedBranch: boolean;
  dirty: boolean;
  changedFiles: RepoStatusFile[];
  /** Commits ahead of origin, or `null` when the branch was never pushed. */
  ahead: number | null;
  /** Commits behind origin, or `null` when the branch was never pushed. */
  behind: number | null;
  remoteUrl: string | null;
  defaultBranch: string;
}

/** Aggregate workspace status. */
export interface WorkspaceStatusReport {
  workspacePath: string;
  branchName: string;
  repos: RepoStatusReport[];
  /** True when no repo has working-tree changes. */
  allClean: boolean;
  /** True when every repo is pushed (ahead === 0). A never-pushed branch counts as NOT pushed. */
  allPushed: boolean;
}

/**
 * Gathers branch, dirtiness, ahead/behind, and remote info for every repo in
 * the workspace.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @returns The aggregate {@link WorkspaceStatusReport}.
 * @throws If `nexusflow.json` cannot be read or parsed.
 */
export async function getWorkspaceStatusReport(
  workspacePath: string,
): Promise<WorkspaceStatusReport> {
  const repos = await getWorkspaceRepos(workspacePath);

  const reports: RepoStatusReport[] = await Promise.all(
    repos.map(async (repo): Promise<RepoStatusReport> => {
      const [branch, status, remoteUrl, aheadBehind] = await Promise.all([
        getRepoBranch(repo.path),
        getRepoStatus(repo.path),
        getRemoteUrl(repo.path),
        getAheadBehind(repo.path, repo.branchName),
      ]);

      return {
        name: repo.name,
        path: repo.path,
        branch,
        expectedBranch: repo.branchName,
        onExpectedBranch: branch === repo.branchName,
        dirty: status.hasChanges,
        changedFiles: status.files,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        remoteUrl,
        defaultBranch: repo.defaultBranch,
      };
    }),
  );

  const branchName = repos[0]?.branchName ?? '';
  const allClean = reports.every((r) => !r.dirty);
  // `ahead === null` means the branch was never pushed, which is not "pushed".
  const allPushed = reports.every((r) => r.ahead === 0);

  return { workspacePath, branchName, repos: reports, allClean, allPushed };
}
