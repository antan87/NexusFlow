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

import type { Feature, RepoInfo, WorkspaceContext } from '../types.js';
import { createWorktree, removeWorktree } from './worktree.js';
import { detectDefaultBranch } from '../utils/git.js';
import { analyzeAllRepos } from '../analyzers/index.js';
import { generateContextFiles } from '../generators/index.js';
import { loadConfig } from './config.js';
import { getActiveStorageProvider } from './adapters/registry.js';
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

/**
 * Creates a full workspace for a feature:
 * 1. Creates the workspace directory.
 * 2. Creates a git worktree for every repo in the feature.
 * 3. Saves the feature manifest (`nexusflow.json`).
 *
 * @param feature - The feature definition.
 * @param repos   - Resolved repo metadata for every repo in the feature.
 * @returns The absolute path to the newly created workspace.
 */
export async function createWorkspace(
  feature: Feature,
  repos: RepoInfo[],
): Promise<string> {
  const workspacePath = feature.workspacePath;

  // Ensure the workspace directory exists.
  await fs.mkdir(workspacePath, { recursive: true });

  // Initialize git repository at workspace root to prevent AI assistants (like Claude)
  // from climbing up to parent git repositories (main/master).
  try {
    await execa('git', ['init'], { cwd: workspacePath });

    // Write a .gitignore to ignore the sub-repositories
    const gitignoreContent = repos.map((repo) => `/${repo.name}/`).join('\n') + '\n';
    await fs.writeFile(path.join(workspacePath, '.gitignore'), gitignoreContent, 'utf-8');
  } catch (error) {
    // Silently ignore or log warning if git init fails
    console.warn('Warning: Failed to initialize git repository at workspace root:', error);
  }

  // Create .vscode/settings.json to allow VS Code search to query inside ignored sub-repos
  try {
    const vscodeDir = path.join(workspacePath, '.vscode');
    await fs.mkdir(vscodeDir, { recursive: true });
    const settings = {
      "search.useIgnoreFiles": false
    };
    await fs.writeFile(
      path.join(vscodeDir, 'settings.json'),
      JSON.stringify(settings, null, 2) + '\n',
      'utf-8'
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
          "args": ["-y", "@mrpatronz/nexusflow", "mcp", "start"]
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

  // Create a worktree for each repo inside the workspace.
  for (const repo of repos) {
    const worktreeTarget = path.join(workspacePath, repo.name);
    await createWorktree(
      repo.path,
      worktreeTarget,
      feature.branchName,
      repo.defaultBranch,
    );
  }

  // Persist the feature manifest.
  await saveFeatureConfig(workspacePath, feature);

  // Exclude NexusFlow files from git
  await excludeNexusFlowFiles(workspacePath, feature);

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
  const adapter = getActiveStorageProvider();
  await adapter.writeWorkspaceFile(workspacePath, feature.id, MANIFEST_FILE, data);
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
  const adapter = getActiveStorageProvider();

  // 1. Try reading via the storage adapter first
  try {
    const raw = await adapter.readWorkspaceFile(workspacePath, featureId, MANIFEST_FILE);
    return JSON.parse(raw) as Feature;
  } catch {}

  // 2. Try direct local check
  const manifestPath = path.join(workspacePath, MANIFEST_FILE);
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as Feature;
  } catch {}

  // 3. Try direct vault check
  const vaultManifest = path.join(os.homedir(), '.nexusflow', 'vault', featureId, MANIFEST_FILE);
  try {
    const raw = await fs.readFile(vaultManifest, 'utf-8');
    return JSON.parse(raw) as Feature;
  } catch {}

  // 4. Traverse parent directories
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
 * Deletes a workspace cleanly, removing all associated git worktrees first,
 * then deleting the directory from disk.
 *
 * @param workspacePath - Absolute path to the workspace directory.
 */
export async function deleteWorkspace(
  workspacePath: string,
): Promise<void> {
  const feature = await loadFeatureConfig(workspacePath);
  if (feature) {
    try {
      await deleteWorkspaceFiles(workspacePath, feature.id);
    } catch (error) {
      console.warn(`Warning: failed to delete workspace context files from storage:`, error);
    }

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
  } else {
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

  // Delete the directory itself
  try {
    await fs.rm(workspacePath, { recursive: true, force: true });
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
  const worktreeTarget = path.join(workspacePath, newRepoInfo.name);

  if (feature.repos.includes(worktreeTarget)) {
    throw new Error(`Repository ${repoPath} is already in the workspace`);
  }

  // 1. Create the worktree
  await createWorktree(
    newRepoInfo.path,
    worktreeTarget,
    feature.branchName,
    newRepoInfo.defaultBranch,
  );

  // 2. Update manifest
  feature.repos.push(worktreeTarget);
  if (!feature.originalRepos) {
    feature.originalRepos = [];
  }
  feature.originalRepos.push(repoPath);
  await saveFeatureConfig(workspacePath, feature);

  // 3. Update .gitignore at workspace root
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

  // 4. Re-run analysis, update configs, and repack workspace
  const allRepos = await Promise.all(feature.repos.map(resolveRepoInfo));
  const workspaceRepos = allRepos.map((repo) => ({
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
  await excludeNexusFlowFiles(workspacePath, feature);
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
      
      const excludeFilePath = path.join(worktreeGitDir, 'info', 'exclude');
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
