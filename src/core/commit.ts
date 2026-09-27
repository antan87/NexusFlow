/**
 * @module core/commit
 * Headless cross-repo commit engine shared by the CLI, the dashboard server,
 * the MCP server, and the finish flow. The CLI adds its own interactive
 * rendering and dry-run handling around/instead of this; consumers that just
 * need to commit changed repos call this directly.
 */

import {
  getWorkspaceRepos,
  getRemoteUrl,
  getRepoBranch,
  getRepoStatus,
  commitAndPush,
  pushRepo,
} from '../utils/multi-git.js';
import { loadFeatureConfig } from './workspace.js';
import { getOrganization } from './domain-packs.js';
import { ReferenceRepoError, referenceRepoMessage, referenceRepoNames } from './edit-policy.js';

/** Options for {@link commitWorkspace}. */
export interface WorkspaceCommitOptions {
  /** Skip the `git push` step. */
  noPush?: boolean;
  /** Restrict the commit to these repos (by directory name). */
  repos?: string[];
  /**
   * Reviewed file selection per repo (by directory name). When present, only
   * these repos and files are committed; every other change is left as it is.
   * Each file must be a current change in its repo.
   */
  files?: Record<string, string[]>;
}

/** Per-repo commit outcome. */
export interface RepoCommitReport {
  name: string;
  /** Every requested step (commit, and push unless skipped) succeeded. */
  success: boolean;
  /** A commit was created, even if the push afterwards failed. */
  committed: boolean;
  pushed: boolean;
  pushError?: string;
  commitHash: string;
  filesChanged: number;
  message: string;
  /** Branch the commit landed on. */
  branch: string;
}

/** A repo with changes that was deliberately not committed. */
export interface SkippedRepoReport {
  name: string;
  reason: string;
}

/** Aggregate result of committing across a workspace. */
export interface WorkspaceCommitReport {
  /** Only repos that had changes and were committed (or attempted). */
  repos: RepoCommitReport[];
  /** Repos with changes that were not committed, and why. */
  skipped: SkippedRepoReport[];
  committedCount: number;
  failedCount: number;
  /** Warning message if the commit message violated active organization conventions. */
  conventionWarning?: string;
}

/**
 * Commits (and optionally pushes) every editable repo in the workspace that
 * has working-tree changes. Read-only reference repos are never committed:
 * naming one explicitly throws {@link ReferenceRepoError}; otherwise it is
 * reported in `skipped`.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param message       - Commit message applied to each repo.
 * @param options       - Push/repo/file selection options.
 * @returns Per-repo reports plus committed/failed counts.
 * @throws If a selection names an unknown repo or file, or a reference repo.
 */
export async function commitWorkspace(
  workspacePath: string,
  message: string,
  options?: WorkspaceCommitOptions,
): Promise<WorkspaceCommitReport> {
  let repos = await getWorkspaceRepos(workspacePath);
  const feature = await loadFeatureConfig(workspacePath).catch(() => null);
  const references = new Set(feature ? referenceRepoNames(feature, workspacePath) : []);

  const fileSelection = options?.files;
  const requested = fileSelection ? Object.keys(fileSelection) : options?.repos;
  if (requested && requested.length > 0) {
    const unknown = requested.filter((name) => !repos.some((r) => r.name === name));
    if (unknown.length > 0) {
      throw new Error(
        `Repositor${unknown.length === 1 ? 'y' : 'ies'} not in this workspace: ${unknown.join(', ')}. ` +
          `Available: ${repos.map((r) => r.name).join(', ')}`,
      );
    }
    const blocked = requested.filter((name) => references.has(name));
    if (blocked.length > 0) throw new ReferenceRepoError(blocked);
    repos = repos.filter((r) => requested.includes(r.name));
  }

  let conventionWarning: string | undefined;
  if (feature?.organizationId) {
    const org = getOrganization(feature.organizationId);
    if (org?.commitMessagePattern) {
      const regex = new RegExp(org.commitMessagePattern);
      if (!regex.test(message)) {
        conventionWarning = `Commit message "${message}" violates ${org.name} convention pattern (${org.commitMessagePattern}).` +
          (org.commitExample ? ` Example: "${org.commitExample}"` : '');
      }
    }
  }

  // Resolve every repo's status before committing any, so a stale selection
  // fails the whole request instead of committing some repos first.
  const plans: Array<{ repo: (typeof repos)[number]; files?: string[] }> = [];
  const skipped: SkippedRepoReport[] = [];
  for (const repo of repos) {
    const status = await getRepoStatus(repo.path);
    if (!status.hasChanges) continue;
    if (references.has(repo.name)) {
      skipped.push({ name: repo.name, reason: referenceRepoMessage(repo.name) });
      continue;
    }
    // Never commit onto, or push, a branch other than the one this repo is
    // prepared on: a stray checkout would publish the wrong history.
    const current = await getRepoBranch(repo.path);
    if (repo.branchName !== 'HEAD' && current !== repo.branchName) {
      skipped.push({
        name: repo.name,
        reason: current
          ? `on branch "${current}", not "${repo.branchName}". Switch back before committing.`
          : `detached HEAD, not "${repo.branchName}". Switch back before committing.`,
      });
      continue;
    }
    const files = fileSelection?.[repo.name];
    if (files) {
      const changed = new Set(status.files.map((f) => f.path));
      const missing = files.filter((file) => !changed.has(file));
      if (missing.length > 0) {
        throw new Error(`No current change in ${repo.name} for: ${missing.join(', ')}. Review the changes again.`);
      }
      if (files.length === 0) continue;
    }
    plans.push({ repo, files });
  }

  const reports: RepoCommitReport[] = [];
  for (const { repo, files } of plans) {
    const result = await commitAndPush(repo.path, message, repo.branchName, {
      noPush: options?.noPush,
      files,
    });
    reports.push({
      name: repo.name,
      success: result.success,
      committed: result.committed ?? result.success,
      pushed: result.pushed ?? false,
      pushError: result.pushError,
      commitHash: result.commitHash,
      filesChanged: result.filesChanged,
      message: result.message,
      branch: repo.branchName,
    });
  }

  return {
    repos: reports,
    skipped,
    committedCount: reports.filter((r) => r.committed).length,
    failedCount: reports.filter((r) => !r.success).length,
    conventionWarning,
  };
}

/** Outcome of pushing one repo. */
export interface RepoPushReport {
  name: string;
  pushed: boolean;
  branch: string;
  error?: string;
}

/**
 * Pushes already-committed work for the named editable repos — the retry for
 * a commit whose push failed, so nothing is committed twice.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param repoNames     - Repos to push (by directory name).
 * @throws {ReferenceRepoError} When a named repo is a read-only reference.
 */
export async function pushWorkspace(workspacePath: string, repoNames: string[]): Promise<RepoPushReport[]> {
  const repos = await getWorkspaceRepos(workspacePath);
  const unknown = repoNames.filter((name) => !repos.some((r) => r.name === name));
  if (unknown.length > 0) throw new Error(`Not in this workspace: ${unknown.join(', ')}`);
  const feature = await loadFeatureConfig(workspacePath).catch(() => null);
  const references = new Set(feature ? referenceRepoNames(feature, workspacePath) : []);
  const blocked = repoNames.filter((name) => references.has(name));
  if (blocked.length > 0) throw new ReferenceRepoError(blocked);

  const reports: RepoPushReport[] = [];
  for (const repo of repos.filter((r) => repoNames.includes(r.name))) {
    const current = await getRepoBranch(repo.path);
    if (current !== repo.branchName) {
      reports.push({ name: repo.name, pushed: false, branch: repo.branchName, error: `on ${current ? `branch "${current}"` : 'a detached HEAD'}, not "${repo.branchName}"` });
      continue;
    }
    if (!(await getRemoteUrl(repo.path))) {
      reports.push({ name: repo.name, pushed: false, branch: repo.branchName, error: 'no remote configured' });
      continue;
    }
    const result = await pushRepo(repo.path, repo.branchName);
    reports.push({ name: repo.name, pushed: result.success, branch: repo.branchName, error: result.success ? undefined : result.message });
  }
  return reports;
}
