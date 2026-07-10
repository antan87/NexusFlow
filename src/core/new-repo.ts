/**
 * @module core/new-repo
 * Scaffolds a brand-new local git repository inside the dev directory so it
 * can be included in a workspace like any pre-existing repo. Local-only by
 * design — adding a remote stays a manual step.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import type { RepoInfo } from '../types.js';

/** Default branch for newly scaffolded repositories. */
const DEFAULT_BRANCH = 'main';

/**
 * Validates a new project name as a safe directory name (cross-platform):
 * no path separators, no Windows-reserved characters, no leading/trailing
 * dots or spaces, and a sane length.
 */
export function isValidProjectName(name: string): boolean {
  if (!name || name.length > 100) return false;
  if (name === '.' || name === '..') return false;
  if (/[<>:"/\\|?*\x00-\x1F]/.test(name)) return false;
  if (name.startsWith(' ') || name.endsWith(' ')) return false;
  if (name.startsWith('.') || name.endsWith('.')) return false;
  return true;
}

/**
 * Creates a brand-new git repository at `<devDir>/<name>`:
 * `git init` on {@link DEFAULT_BRANCH}, a starter README, and an initial
 * commit (a worktree cannot be added to a repo with an unborn HEAD).
 *
 * Fails if the target directory already exists — this scaffolds new projects
 * only and never adopts existing directories.
 *
 * @param devDir - The configured development root directory.
 * @param name   - Project (directory) name, validated by {@link isValidProjectName}.
 * @returns Repo metadata ready to pass to workspace creation.
 */
export async function createNewRepo(devDir: string, name: string): Promise<RepoInfo> {
  const trimmed = name.trim();
  if (!isValidProjectName(trimmed)) {
    throw new Error(`Invalid project name: "${name}"`);
  }

  const repoPath = path.join(devDir, trimmed);
  let exists = true;
  try {
    await fs.access(repoPath);
  } catch {
    exists = false;
  }
  if (exists) {
    throw new Error(`A directory named "${trimmed}" already exists in ${devDir}.`);
  }

  await fs.mkdir(repoPath, { recursive: true });
  try {
    try {
      await execa('git', ['init', '-b', DEFAULT_BRANCH], { cwd: repoPath });
    } catch {
      // Older git without `init -b`: init, then point the unborn HEAD at main.
      await execa('git', ['init'], { cwd: repoPath });
      await execa('git', ['symbolic-ref', 'HEAD', `refs/heads/${DEFAULT_BRANCH}`], { cwd: repoPath });
    }

    await fs.writeFile(path.join(repoPath, 'README.md'), `# ${trimmed}\n`, 'utf8');
    await execa('git', ['add', '.'], { cwd: repoPath });
    try {
      await execa('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath });
    } catch {
      // No git identity configured (fresh machine or CI) — fall back to a
      // one-off identity so scaffolding still succeeds.
      await execa(
        'git',
        ['-c', 'user.name=NexusFlow', '-c', 'user.email=nexusflow@localhost', 'commit', '-m', 'Initial commit'],
        { cwd: repoPath },
      );
    }
  } catch (error) {
    // Don't leave a half-initialized directory behind.
    try {
      await fs.rm(repoPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {}
    throw error;
  }

  return { name: trimmed, path: repoPath, defaultBranch: DEFAULT_BRANCH };
}
