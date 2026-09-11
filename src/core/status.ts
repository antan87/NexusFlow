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
import { execa } from 'execa';

/** A file collision or concurrent modification detected on disk. */
export interface FileCollision {
  filePath: string;
  code: string;
  lastCommittedBy?: string;
  lastCommitSha?: string;
  lastCommitMessage?: string;
  lastCommitDate?: string;
  collisionHint?: string;
}

/** Full status for a single repo in a workspace. */
export interface RepoStatusReport {
  name: string;
  path: string;
  /** Current branch, or `null` when the repo is in a detached-HEAD state. */
  branch: string | null;
  /** Live HEAD commit identity. */
  headSha?: string | null;
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
  /** Concurrent modifications or collisions detected for modified files. */
  collisions?: FileCollision[];
  collisionWarning?: string;
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
  /** True when file collisions or concurrent modifications are detected. */
  hasCollisions?: boolean;
  /** Actionable warning advising coordination when concurrent changes occur. */
  collisionWarning?: string;
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
      const [branch, status, remoteUrl, aheadBehind, headSha] = await Promise.all([
        getRepoBranch(repo.path),
        getRepoStatus(repo.path),
        getRemoteUrl(repo.path),
        getAheadBehind(repo.path, repo.branchName),
        execa('git', ['rev-parse', 'HEAD'], { cwd: repo.path })
          .then((result) => result.stdout.trim())
          .catch(() => null),
      ]);

      const collisions: FileCollision[] = [];
      if (status.hasChanges && status.files.length > 0) {
        await Promise.all(
          status.files.slice(0, 15).map(async (file) => {
            try {
              const { stdout } = await execa(
                'git',
                ['log', '-n', '1', '--format=%an <%ae>|%h|%s|%cI', '--', file.path],
                { cwd: repo.path },
              );
              if (stdout.trim()) {
                const [author, sha, subject, date] = stdout.trim().split('|');
                collisions.push({
                  filePath: file.path,
                  code: file.code,
                  lastCommittedBy: author,
                  lastCommitSha: sha,
                  lastCommitMessage: subject,
                  lastCommitDate: date,
                  collisionHint: `File "${file.path}" modified on disk; last commit was by ${author} ("${subject}"). Coordinate with post_workroom_handoff before editing.`,
                });
              } else {
                collisions.push({
                  filePath: file.path,
                  code: file.code,
                  collisionHint: `File "${file.path}" modified on disk. Coordinate with post_workroom_handoff before editing.`,
                });
              }
            } catch {
              collisions.push({
                filePath: file.path,
                code: file.code,
              });
            }
          }),
        );
      }

      const authors = [...new Set(collisions.map((c) => c.lastCommittedBy).filter(Boolean))];
      const collisionWarning =
        collisions.length > 0
          ? `${collisions.length} modified file(s) detected on disk${authors.length > 0 ? ` (last touched by ${authors.join(', ')})` : ''}. Use 'post_workroom_handoff' to coordinate before editing.`
          : undefined;

      return {
        name: repo.name,
        path: repo.path,
        branch,
        headSha,
        expectedBranch: repo.branchName,
        onExpectedBranch: branch === repo.branchName,
        dirty: status.hasChanges,
        changedFiles: status.files,
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        remoteUrl,
        defaultBranch: repo.defaultBranch,
        collisions: collisions.length > 0 ? collisions : undefined,
        collisionWarning,
      };
    }),
  );

  const branchName = repos[0]?.branchName ?? '';
  const allClean = reports.every((r) => !r.dirty);
  // `ahead === null` means the branch was never pushed, which is not "pushed".
  const allPushed = reports.every((r) => r.ahead === 0);
  const allCollisions = reports.flatMap((r) => r.collisions ?? []);
  const hasCollisions = allCollisions.length > 0;
  const collisionWarning = hasCollisions
    ? `Concurrent file modifications detected on disk across ${reports.filter((r) => (r.collisions?.length ?? 0) > 0).length} repo(s). Use 'post_workroom_handoff' to coordinate before editing.`
    : undefined;

  return { workspacePath, branchName, repos: reports, allClean, allPushed, hasCollisions, collisionWarning };
}
