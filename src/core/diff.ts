/**
 * @module core/diff
 * Headless cross-repo diff report shared by the CLI `diff` command, the
 * dashboard server, and the MCP `get_workspace_diff` tool. Returns structured
 * data; rendering is the caller's concern.
 */

import {
  getWorkspaceRepos,
  getRepoStatus,
  getDiffSummary,
  getUnpushedCount,
} from '../utils/multi-git.js';

/** Diff summary for a single repo that has changes or unpushed commits. */
export interface RepoDiffReport {
  name: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  /** Commits ahead of origin, or `null` when the branch was never pushed. */
  unpushed: number | null;
  summary: string;
}

/**
 * Builds a diff report for every repo in the workspace that has working-tree
 * changes or local commits that have not been pushed.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param repos         - Optional repo-name filter.
 * @returns One entry per repo with changes; clean+pushed repos are omitted.
 * @throws If `repos` names a repo not in the workspace.
 */
export async function getWorkspaceDiffReport(
  workspacePath: string,
  repos?: string[],
): Promise<RepoDiffReport[]> {
  let workspaceRepos = await getWorkspaceRepos(workspacePath);

  if (repos && repos.length > 0) {
    const unknown = repos.filter((name) => !workspaceRepos.some((r) => r.name === name));
    if (unknown.length > 0) {
      throw new Error(
        `Repositor${unknown.length === 1 ? 'y' : 'ies'} not in this workspace: ${unknown.join(', ')}. ` +
          `Available: ${workspaceRepos.map((r) => r.name).join(', ')}`,
      );
    }
    workspaceRepos = workspaceRepos.filter((r) => repos.includes(r.name));
  }

  const results: RepoDiffReport[] = [];

  for (const repo of workspaceRepos) {
    const status = await getRepoStatus(repo.path);
    const unpushed = await getUnpushedCount(repo.path, repo.branchName);

    // A repo with no working-tree changes still matters when it has local
    // commits that were never pushed — otherwise "all clean" hides them.
    if (!status.hasChanges && !(unpushed && unpushed > 0)) {
      continue;
    }

    const diff = status.hasChanges
      ? await getDiffSummary(repo.path)
      : { summary: 'No working-tree changes', additions: 0, deletions: 0 };

    results.push({
      name: repo.name,
      filesChanged: status.changedFiles.length,
      additions: diff.additions,
      deletions: diff.deletions,
      unpushed,
      summary: diff.summary,
    });
  }

  return results;
}
