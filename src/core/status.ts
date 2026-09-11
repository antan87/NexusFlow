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
      const trackedDirtyFiles = status.files.filter((f) => f.code !== '??');

      if (trackedDirtyFiles.length > 0) {
        // 1. Identify merge/rebase conflict files immediately
        const conflictFiles = trackedDirtyFiles.filter((f) => f.code.includes('U') || f.code === 'AA');
        for (const cf of conflictFiles) {
          collisions.push({
            filePath: cf.path,
            code: cf.code,
            collisionHint: `File "${cf.path}" is in unresolved merge conflict state (${cf.code}). Coordinate with post_workroom_handoff or resolve conflict before continuing.`,
          });
        }

        // 2. Identify collaborator commits landing on modified files
        try {
          const [userName, userEmail, recentCommitsOut] = await Promise.all([
            execa('git', ['config', 'user.name'], { cwd: repo.path }).then((r) => r.stdout.trim()).catch(() => ''),
            execa('git', ['config', 'user.email'], { cwd: repo.path }).then((r) => r.stdout.trim()).catch(() => ''),
            execa('git', ['log', '-n', '10', '--format=%H|%an|%ae|%s|%cI'], { cwd: repo.path })
              .then((r) => r.stdout.trim())
              .catch(() => ''),
          ]);

          if (recentCommitsOut) {
            const commits = recentCommitsOut.split('\n').filter(Boolean).map((line) => {
              const [sha, authorName, authorEmail, subject, date] = line.split('|');
              return {
                sha: sha || '',
                authorName: authorName || '',
                authorEmail: authorEmail || '',
                author: `${authorName || ''} <${authorEmail || ''}>`.trim(),
                subject: subject || '',
                date: date || '',
              };
            });

            // Find commits authored by other collaborators
            const collaboratorCommits = commits.filter((c) => {
              if (userName && c.authorName && c.authorName !== userName) return true;
              if (userEmail && c.authorEmail && c.authorEmail !== userEmail) return true;
              return false;
            });

            if (collaboratorCommits.length > 0) {
              const shas = collaboratorCommits.map((c) => c.sha);
              const { stdout: touchedFilesOut } = await execa(
                'git',
                ['diff-tree', '--no-commit-id', '--name-only', '-r', ...shas],
                { cwd: repo.path },
              ).catch(() => ({ stdout: '' }));

              const touchedSet = new Set(touchedFilesOut.split('\n').map((f) => f.trim()).filter(Boolean));

              for (const file of trackedDirtyFiles) {
                if (collisions.some((c) => c.filePath === file.path)) continue;

                if (touchedSet.has(file.path)) {
                  const commit = collaboratorCommits.find((c) => c.sha);
                  collisions.push({
                    filePath: file.path,
                    code: file.code,
                    lastCommittedBy: commit?.author,
                    lastCommitSha: commit?.sha?.slice(0, 7),
                    lastCommitMessage: commit?.subject,
                    lastCommitDate: commit?.date,
                    collisionHint: `File "${file.path}" modified on disk was recently committed by collaborator ${commit?.author} ("${commit?.subject}"). Coordinate with post_workroom_handoff before editing.`,
                  });
                }
              }
            }
          }
        } catch {
          // Graceful fallback if git queries fail
        }
      }

      const authors = [...new Set(collisions.map((c) => c.lastCommittedBy).filter(Boolean))];
      const collisionWarning =
        collisions.length > 0
          ? `${collisions.length} modified file(s) collide with recent collaborator commits${authors.length > 0 ? ` (${authors.join(', ')})` : ''}. Use 'post_workroom_handoff' to coordinate before editing.`
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
