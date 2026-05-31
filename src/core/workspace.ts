/**
 * @module core/workspace
 * Creates and manages NexusFlow workspaces — directories that group
 * worktrees for a multi-repo feature together with a `nexusflow.json`
 * manifest.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { Feature, RepoInfo } from '../types.js';
import { createWorktree } from './worktree.js';

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
  const manifestPath = path.join(workspacePath, MANIFEST_FILE);
  const data = JSON.stringify(feature, null, 2) + '\n';
  await fs.writeFile(manifestPath, data, 'utf-8');
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
  const manifestPath = path.join(workspacePath, MANIFEST_FILE);

  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(raw) as Feature;
  } catch {
    return null;
  }
}
