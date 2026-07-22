/**
 * @module core/workspace
 * Creates and manages NexusFlow workspaces — directories that group
 * worktrees for a multi-repo feature together with a `nexusflow.json`
 * manifest.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';

import type { Feature, RepoInfo, RepoSelection, WorkspaceContext } from '../types.js';
import { isInPlace, normalizeFeature } from '../utils/feature.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { detectDefaultBranch } from '../utils/git.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import { loadConfig } from './config.js';
import { deleteWorkspaceFiles } from './storage.js';

/** Name of the per-workspace manifest file. */
const MANIFEST_FILE = 'nexusflow.json';

/**
 * Derives the workspace directory path for a given branch name.
 *
 * @param workspacesDir - The root workspaces directory (e.g. ~/dev/workspaces).
 * @param branchName    - The feature branch name used as the workspace folder.
 * @returns Absolute path to the workspace directory.
 */
export function getWorkspacePath(
  workspacesDir: string,
  branchName: string,
): string {
  return path.join(workspacesDir, branchName);
}

/** A worktree created during {@link createWorkspace}, tracked for rollback. */
interface WorktreeRollbackAction {
  repoPath: string;
  worktreePath: string;
  /** The branch materialized in this worktree (feature branch or a per-repo override). */
  branchName: string;
  createdBranch: boolean;
}

/**
 * Best-effort rollback of a partially-created workspace: removes each worktree
 * this run added (pruning on failure), deletes only branches this run created,
 * and removes the workspace directory. Rollback failures are warned, never
 * thrown, so the caller can rethrow the original error.
 */
async function rollbackWorkspace(
  workspacePath: string,
  actions: WorktreeRollbackAction[],
): Promise<void> {
  for (const action of [...actions].reverse()) {
    try {
      await removeWorktree(action.repoPath, action.worktreePath, true);
    } catch (error) {
      console.warn(`Warning: rollback failed to remove worktree ${action.worktreePath}:`, error);
      try {
        await execa('git', ['worktree', 'prune'], { cwd: action.repoPath });
      } catch {
        // Best-effort prune.
      }
    }
    // Only delete a branch this run created — never a pre-existing one.
    if (action.createdBranch) {
      try {
        await execa('git', ['branch', '-D', action.branchName], { cwd: action.repoPath });
      } catch {
        // The branch may already be gone with its worktree; ignore.
      }
    }
  }

  try {
    await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(
      `Warning: rollback could not fully remove ${workspacePath} — remove it manually:`,
      error,
    );
  }
}

/**
 * Prepares the workspace directory itself: guard against clobbering, mkdir,
 * git init at the root (prevents AI assistants climbing to parent repos),
 * `.gitignore` (worktree mode only — it lists the repo subdirs), the
 * `.code-workspace` file, `.vscode/settings.json` and `.cursor/mcp.json`.
 * No git worktrees are touched here.
 */
async function scaffoldWorkspaceDir(
  feature: Feature,
  repos: RepoSelection[],
): Promise<void> {
  const workspacePath = feature.workspacePath;
  const inPlace = isInPlace(feature);

  // Fail fast if the target already exists and is non-empty, rather than
  // silently merging into (and later half-rolling-back) an existing directory.
  try {
    const existing = await fs.readdir(workspacePath);
    if (existing.length > 0) {
      throw new Error(
        `Workspace directory already exists and is not empty: ${workspacePath}. ` +
          `Remove it first (e.g. 'nexusflow remove ${feature.id}') or choose another name.`,
      );
    }
  } catch (error) {
    // A non-existent directory (ENOENT) is the normal, happy path.
    if (error instanceof Error && error.message.includes('already exists and is not empty')) {
      throw error;
    }
  }

  // Ensure the workspace directory exists.
  await fs.mkdir(workspacePath, { recursive: true });

  // Initialize git repository at workspace root to prevent AI assistants (like Claude)
  // from climbing up to parent git repositories (main/master).
  try {
    await execa('git', ['init'], { cwd: workspacePath });

    // Write a .gitignore to ignore the sub-repositories. In-place workspaces
    // have no repo subdirectories, so there is nothing to ignore.
    if (!inPlace) {
      const gitignoreContent = repos.map((repo) => `/${repo.name}/`).join('\n') + '\n';
      await fs.writeFile(path.join(workspacePath, '.gitignore'), gitignoreContent, 'utf-8');
    }
  } catch (error) {
    // Silently ignore or log warning if git init fails
    console.warn('Warning: Failed to initialize git repository at workspace root:', error);
  }

  // Generate a .code-workspace file so VS Code opens each repo as a top-level workspace
  // folder with its own SCM provider. Without this, VS Code's git scanner respects the
  // root .gitignore (which lists every repo dir) and never discovers the worktrees.
  // In-place repos live outside the workspace, so their folders use absolute paths.
  try {
    const workspaceName = path.basename(workspacePath);
    const codeWorkspace = {
      folders: [
        { path: '.', name: `${workspaceName} (workspace)` },
        ...repos.map((repo) => ({ path: inPlace ? repo.path : repo.name, name: repo.name })),
      ],
      settings: {
        'search.useIgnoreFiles': false,
      },
    };
    await fs.writeFile(
      path.join(workspacePath, `${workspaceName}.code-workspace`),
      JSON.stringify(codeWorkspace, null, 2) + '\n',
      'utf-8',
    );
  } catch (error) {
    console.warn('Warning: Failed to create .code-workspace file:', error);
  }

  // Create .vscode/settings.json for editors that don't use the .code-workspace file
  try {
    const vscodeDir = path.join(workspacePath, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });
    const settings = {
      'search.useIgnoreFiles': false,
    };
    await fs.writeFile(
      path.join(vscodeDir, 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
      'utf-8',
    );
  } catch (error) {
    console.warn('Warning: Failed to create .vscode/settings.json:', error);
  }

  // Create .cursor/mcp.json for workspace-local Cursor MCP configuration
  try {
    const cursorDir = path.join(workspacePath, '.cursor');
    await fs.mkdir(cursorDir, { recursive: true });
    const cursorMcp = {
      "mcpServers": {
        "nexusflow": {
          "command": "npx",
          "args": ["-y", "@mrpatronz/nexusflow", "mcp", "run"]
        }
      }
    };
    await fs.writeFile(
      path.join(cursorDir, 'mcp.json'),
      JSON.stringify(cursorMcp, null, 2) + '\n',
      'utf-8'
    );
  } catch (error) {
    console.warn('Warning: Failed to create .cursor/mcp.json:', error);
  }
}

/**
 * Creates a git worktree inside the workspace for every repo, recording a
 * rollback action per worktree into `rollbackActions` as it goes (so the
 * caller can roll back exactly what was created when a later step fails).
 */
async function materializeWorktrees(
  feature: Feature,
  repos: RepoSelection[],
  rollbackActions: WorktreeRollbackAction[],
  onProgress?: (repoName: string, index: number, total: number) => void,
): Promise<void> {
  const workspacePath = feature.workspacePath;
  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    onProgress?.(repo.name, i, repos.length);
    const worktreeTarget = path.join(workspacePath, repo.name);
    const branchName = repo.existingBranch ?? feature.branchName;
    const { createdBranch } = await createWorktree(
      repo.path,
      worktreeTarget,
      branchName,
      repo.defaultBranch,
      // An explicitly chosen branch must exist — silently creating a fresh
      // one would defeat the point of picking it.
      { mustExist: repo.existingBranch !== undefined },
    );
    rollbackActions.push({ repoPath: repo.path, worktreePath: worktreeTarget, branchName, createdBranch });
  }
}

/**
 * Final bookkeeping: persists the feature manifest and, for worktree mode,
 * excludes NexusFlow-generated files from each checkout's git status.
 * In-place features skip the exclusion — the generated files live only in the
 * workspace dir, and mutating the user's source repos' .git/info/exclude
 * would silently hide any CLAUDE.md/.vscode files they later author there.
 */
async function finalizeWorkspace(feature: Feature): Promise<void> {
  await saveFeatureConfig(feature.workspacePath, feature);
  if (!isInPlace(feature)) {
    await excludeNexusFlowFiles(feature.workspacePath, feature);
  }
}

/**
 * Creates a full workspace for a feature:
 * 1. Scaffolds the workspace directory (git init, editor/MCP config files).
 * 2. Worktree mode: creates a git worktree for every repo in the feature.
 *    In-place mode: skips this — the feature points at the source repos.
 * 3. Saves the feature manifest (`nexusflow.json`).
 *
 * If any step fails, the partially-created workspace is rolled back
 * automatically (worktrees removed, run-created branches deleted, directory
 * removed) and the original error is rethrown, so a failed `create` never
 * leaves debris behind.
 *
 * @param feature    - The feature definition.
 * @param repos      - Resolved repo metadata for every repo in the feature. A
 *                     repo with `existingBranch` set checks out that branch
 *                     (which must exist) instead of the feature branch.
 * @param onProgress - Optional per-repo progress callback (repo name, index, total).
 * @returns The absolute path to the newly created workspace.
 */
export async function createWorkspace(
  feature: Feature,
  repos: RepoSelection[],
  onProgress?: (repoName: string, index: number, total: number) => void,
): Promise<string> {
  const workspacePath = feature.workspacePath;

  await scaffoldWorkspaceDir(feature, repos);

  const rollbackActions: WorktreeRollbackAction[] = [];
  try {
    if (!isInPlace(feature)) {
      await materializeWorktrees(feature, repos, rollbackActions, onProgress);
    }
    await finalizeWorkspace(feature);
  } catch (error) {
    // In-place mode has no worktrees to roll back; this just removes the dir.
    await rollbackWorkspace(workspacePath, rollbackActions);
    throw error;
  }

  return workspacePath;
}

/**
 * Lists all existing workspaces by reading `nexusflow.json` manifests from
 * each subdirectory of {@link workspacesDir}.
 *
 * Directories that do not contain a valid manifest are silently skipped.
 *
 * @param workspacesDir - The root workspaces directory.
 * @returns An array of {@link Feature} objects for each discovered workspace.
 */
export async function listWorkspaces(
  workspacesDir: string,
): Promise<Feature[]> {
  const features: Feature[] = [];

  async function scan(dir: string, depth: number) {
    if (depth > 3) return;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    // Check if current directory contains a nexusflow.json manifest
    const hasManifest = entries.some(
      (e) => e.isFile() && e.name === MANIFEST_FILE,
    );
    if (hasManifest) {
      const loaded = await loadFeatureConfig(dir);
      if (loaded) {
        features.push(loaded);
        return; // Workspaces do not nest.
      }
    }

    // Otherwise, recursively scan subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        await scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  await scan(workspacesDir, 1);
  return features;
}

/**
 * Saves a {@link Feature} as `nexusflow.json` inside the given workspace.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param feature       - The feature definition to persist.
 */
export async function saveFeatureConfig(
  workspacePath: string,
  feature: Feature,
): Promise<void> {
  const data = JSON.stringify(feature, null, 2) + '\n';
  // The manifest is workspace-structural: it must live at the workspace root
  // (where listWorkspaces scans and the git-worktree container lives),
  // independent of the storage adapter. Routing it through an adapter would
  // send it to a vault, invisible to the scan.
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.writeFile(path.join(workspacePath, MANIFEST_FILE), data, 'utf-8');
}

/**
 * Loads a {@link Feature} from the `nexusflow.json` manifest inside a
 * workspace directory.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @returns The loaded feature, or `null` if the manifest doesn't exist or is
 *          invalid.
 */
export async function loadFeatureConfig(
  workspacePath: string,
): Promise<Feature | null> {
  const featureId = path.basename(workspacePath);

  // 1. The manifest lives at the workspace root (see saveFeatureConfig).
  const manifestPath = path.join(workspacePath, MANIFEST_FILE);
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return normalizeFeature(JSON.parse(raw) as Feature);
  } catch {}

  // 2. Legacy fallback: manifests written into the central vault before the
  //    manifest was pinned to the workspace root.
  const vaultManifest = path.join(os.homedir(), '.nexusflow', 'vault', featureId, MANIFEST_FILE);
  try {
    const raw = await fs.readFile(vaultManifest, 'utf-8');
    return normalizeFeature(JSON.parse(raw) as Feature);
  } catch {}

  // 3. Traverse parent directories
  const rootDir = await findWorkspaceRoot(workspacePath);
  if (rootDir && rootDir !== workspacePath) {
    return loadFeatureConfig(rootDir);
  }

  return null;
}

/**
 * Traverses up parent directories to find a directory containing `nexusflow.json`.
 *
 * @param startPath - Path to start searching from.
 * @returns Absolute path to the workspace root directory, or null if not found.
 */
export async function findWorkspaceRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  while (true) {
    const manifestPath = path.join(current, MANIFEST_FILE);
    try {
      await fs.access(manifestPath);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        break; // Reached root directory
      }
      current = parent;
    }
  }
  return null;
}

/**
 * Resolves a repo path to a full RepoInfo object.
 *
 * @param repoPath - Absolute path to the original repository.
 */
export async function resolveRepoInfo(repoPath: string): Promise<RepoInfo> {
  const defaultBranch = await detectDefaultBranch(repoPath);
  return {
    name: path.basename(repoPath),
    path: repoPath,
    defaultBranch,
  };
}

/**
 * Resolves a list of repo paths to RepoInfo objects, detecting each repo's
 * real default branch. Prefer this over hardcoding `main`, which breaks diff
 * context generation for `master`-based repos.
 */
export async function resolveRepoInfos(repoPaths: string[]): Promise<RepoInfo[]> {
  return Promise.all(repoPaths.map((r) => resolveRepoInfo(r)));
}

/**
 * Deletes a workspace cleanly, removing all associated git worktrees first,
 * then deleting the directory from disk.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 */
export async function deleteWorkspace(
  workspacePath: string,
): Promise<void> {
  // Refuse to delete the workspace the caller is currently inside — on Windows
  // the directory removal would fail with EBUSY and leave it half-removed.
  const rel = path.relative(workspacePath, process.cwd());
  const cwdInside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  if (cwdInside) {
    throw new Error(
      `Refusing to delete the workspace you are currently inside (${process.cwd()}). ` +
        `cd out of it first, then retry.`,
    );
  }

  const feature = await loadFeatureConfig(workspacePath);
  if (feature) {
    try {
      await deleteWorkspaceFiles(workspacePath, feature.id);
    } catch (error) {
      console.warn(`Warning: failed to delete workspace context files from storage:`, error);
    }
  }

  // In-place: feature.repos are the user's source repositories — they must
  // never be touched. Deleting the workspace only removes the lightweight
  // directory (manifest + context files) at the end of this function.
  if (feature && !isInPlace(feature)) {
    const origRepos = feature.originalRepos || [];
    for (let i = 0; i < feature.repos.length; i++) {
      const worktreePath = feature.repos[i]!;
      const originalPath = origRepos[i] || worktreePath;
      const repoName = path.basename(worktreePath);
      try {
        await removeWorktree(originalPath, worktreePath, true);
      } catch (error) {
        console.warn(`Warning: failed to remove worktree for ${repoName} in ${originalPath}:`, error);
        try {
          await execa('git', ['worktree', 'prune'], { cwd: originalPath });
        } catch (pruneError) {
          console.warn(`Warning: failed to prune worktrees in ${originalPath}:`, pruneError);
        }
      }
    }
  } else if (!feature) {
    // Manifest is missing. Try to detect worktrees by scanning subdirectories
    try {
      const entries = await fs.readdir(workspacePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(workspacePath, entry.name);
          const gitFilePath = path.join(subPath, '.git');
          try {
            const stat = await fs.stat(gitFilePath);
            if (stat.isFile()) {
              const content = await fs.readFile(gitFilePath, 'utf-8');
              const match = content.match(/gitdir:\s*(.+)\.git\/worktrees/);
              if (match && match[1]) {
                const mainRepoPath = path.resolve(match[1].trim());
                await removeWorktree(mainRepoPath, subPath, true);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Delete the directory itself. Retries help on Windows, where a lingering
  // file handle (editor, terminal, just-exited git) yields a transient EBUSY.
  try {
    await fs.rm(workspacePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.error(`Failed to delete workspace directory ${workspacePath}:`, error);
    throw error;
  }
}

/**
 * Adds a repository to an existing workspace.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 * @param repoPath - Absolute path to the repository to add.
 */
export async function addRepoToWorkspace(
  workspacePath: string,
  repoPath: string,
): Promise<void> {
  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    throw new Error(`Workspace manifest not found at ${workspacePath}`);
  }

  const newRepoInfo = await resolveRepoInfo(repoPath);
  const inPlace = isInPlace(feature);
  // In-place workspaces reference the source repo directly; worktree
  // workspaces get a checkout inside the workspace dir.
  const repoEntry = inPlace ? newRepoInfo.path : path.join(workspacePath, newRepoInfo.name);

  // Identity is the directory name in both modes: worktrees are checked out
  // as sibling subdirectories, and the changes/diff views address repos by
  // name — a second "api" from a different parent dir would collide.
  if (feature.repos.some((r) => path.basename(r) === newRepoInfo.name)) {
    throw new Error(`A repository named "${newRepoInfo.name}" is already in the workspace`);
  }

  // 1. Create the worktree (worktree mode only)
  if (!inPlace) {
    await createWorktree(
      newRepoInfo.path,
      repoEntry,
      feature.branchName,
      newRepoInfo.defaultBranch,
    );
  }

  // 2. Update manifest
  feature.repos.push(repoEntry);
  if (!feature.originalRepos) {
    feature.originalRepos = [];
  }
  feature.originalRepos.push(repoPath);
  await saveFeatureConfig(workspacePath, feature);

  // 3. Keep editor config in step: worktree mode ignores the new subdir in the
  // root .gitignore; in-place mode adds the absolute path to the
  // .code-workspace (otherwise the repo is invisible in the editor).
  if (!inPlace) {
    try {
      const gitignorePath = path.join(workspacePath, '.gitignore');
      let gitignoreContent = '';
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf-8');
      } catch {}

      const entry = `/${newRepoInfo.name}/`;
      if (!gitignoreContent.includes(entry)) {
        gitignoreContent = gitignoreContent.trim() + '\n' + entry + '\n';
        await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');
      }
    } catch (error) {
      console.warn('Warning: Failed to update .gitignore:', error);
    }
  } else {
    try {
      const workspaceName = path.basename(workspacePath);
      const codeWorkspacePath = path.join(workspacePath, `${workspaceName}.code-workspace`);
      const codeWorkspace = JSON.parse(await fs.readFile(codeWorkspacePath, 'utf-8'));
      codeWorkspace.folders = [
        ...(codeWorkspace.folders ?? []),
        { path: newRepoInfo.path, name: newRepoInfo.name },
      ];
      await fs.writeFile(codeWorkspacePath, JSON.stringify(codeWorkspace, null, 2) + '\n', 'utf-8');
    } catch (error) {
      console.warn('Warning: Failed to update .code-workspace file:', error);
    }
  }

  // 4. Re-run analysis, update configs, and repack workspace
  const allRepos = await Promise.all(feature.repos.map(resolveRepoInfo));
  const workspaceRepos = inPlace
    ? allRepos
    : allRepos.map((repo) => ({
        ...repo,
        path: path.join(workspacePath, repo.name),
      }));
  const analysis = await analyzeAllRepos(workspaceRepos);
  const ctx: WorkspaceContext = {
    feature,
    repos: workspaceRepos,
    analysis,
  };

  await generateContextFiles(ctx, feature.assistants, workspacePath);
  if (!inPlace) {
    await excludeNexusFlowFiles(workspacePath, feature);
  }
}

/**
 * Automatically adds NexusFlow workspace context and config files to git's local
 * exclude list for each repository so they never show up in `git status` or get committed.
 */
async function excludeNexusFlowFiles(workspacePath: string, feature: Feature): Promise<void> {
  const excludeEntries = [
    'CLAUDE.md',
    'AGENTS.md',
    'WORKSPACE.md',
    'nexusflow-knowledge.md',
    'nexusflow-plan.md',
    'nexusflow-conventions-*.md',
    'nexusflow-map-*.md',
    'nexusflow-diff-context.md',
    '.cursor/rules/',
    '.vscode/settings.json'
  ];

  for (const repoPath of feature.repos) {
    try {
      const gitDir = path.join(repoPath, '.git');
      let worktreeGitDir = gitDir;
      const stat = await fs.stat(gitDir);
      if (stat.isFile()) {
        const fileContent = await fs.readFile(gitDir, 'utf8');
        const match = fileContent.match(/gitdir:\s*(.+)/);
        if (match) {
          worktreeGitDir = match[1].trim();
        }
      }

      // git reads info/exclude from the *common* git dir, not the per-worktree
      // gitdir. For a worktree the per-worktree gitdir has a `commondir` pointer
      // to it; resolve that so the excludes actually take effect.
      let commonGitDir = worktreeGitDir;
      try {
        const commonRel = (await fs.readFile(path.join(worktreeGitDir, 'commondir'), 'utf8')).trim();
        if (commonRel) {
          commonGitDir = path.resolve(worktreeGitDir, commonRel);
        }
      } catch {}

      const excludeFilePath = path.join(commonGitDir, 'info', 'exclude');
      await fs.mkdir(path.dirname(excludeFilePath), { recursive: true });
      
      let excludeContent = '';
      try {
        excludeContent = await fs.readFile(excludeFilePath, 'utf8');
      } catch {}

      let updated = false;
      for (const entry of excludeEntries) {
        if (!excludeContent.includes(entry)) {
          excludeContent = excludeContent.trim() + '\n' + entry + '\n';
          updated = true;
        }
      }
      
      if (updated) {
        await fs.writeFile(excludeFilePath, excludeContent.trim() + '\n', 'utf8');
      }
    } catch {
      // Ignore if not a git repo or directory missing
    }
  }
}
