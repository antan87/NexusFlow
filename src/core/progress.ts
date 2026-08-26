/** Live implementation progress derived from git and an optional GitHub CLI. */

import { execa } from 'execa';

import { getWorkspaceStatusReport } from './status.js';
import { detectGh, parseRemoteUrl } from '../utils/pr.js';

export type PullRequestState = 'open' | 'merged' | 'closed';

export interface RepoProgress {
  name: string;
  branch: string | null;
  expectedBranch: string;
  branchExists: boolean;
  onExpectedBranch: boolean;
  clean: boolean;
  pushed?: boolean;
  pullRequest?: { state: PullRequestState; url?: string };
}

export interface WorkspaceProgress {
  workspacePath: string;
  repos: RepoProgress[];
}

export async function getWorkspaceProgress(workspacePath: string): Promise<WorkspaceProgress> {
  const status = await getWorkspaceStatusReport(workspacePath);
  const gh = await detectGh();
  const repos = await Promise.all(status.repos.map(async (repo): Promise<RepoProgress> => {
    const branchExists = repo.onExpectedBranch || (
      repo.expectedBranch !== 'HEAD' && await execa(
        'git',
        ['show-ref', '--verify', '--quiet', `refs/heads/${repo.expectedBranch}`],
        { cwd: repo.path, reject: false },
      ).then((result) => result.exitCode === 0).catch(() => false)
    );
    const progress: RepoProgress = {
      name: repo.name,
      branch: repo.branch,
      expectedBranch: repo.expectedBranch,
      branchExists,
      onExpectedBranch: repo.onExpectedBranch,
      clean: !repo.dirty,
    };
    if (repo.onExpectedBranch && repo.remoteUrl && repo.ahead !== null) progress.pushed = repo.ahead === 0;

    const remote = repo.remoteUrl ? parseRemoteUrl(repo.remoteUrl) : null;
    if (repo.onExpectedBranch && gh.authenticated && remote?.kind === 'github' && repo.branch) {
      try {
        const result = await execa(
          'gh',
          ['pr', 'view', repo.branch, '--json', 'state,url'],
          { cwd: repo.path, reject: false },
        );
        if (result.exitCode === 0) {
          const parsed = JSON.parse(result.stdout) as { state?: string; url?: string };
          const state = parsed.state?.toLowerCase();
          if (state === 'open' || state === 'merged' || state === 'closed') {
            progress.pullRequest = { state, url: parsed.url };
          }
        }
      } catch {
        // PR state is optional. Omit it rather than presenting an unchecked lie.
      }
    }
    return progress;
  }));
  return { workspacePath, repos };
}
