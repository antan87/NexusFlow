/**
 * @module core/projects
 * Manages the persistent project registry stored at ~/.nexusflow/projects.json.
 *
 * A project is a named group of source repositories that features can be
 * started from. The registry is a convenience index — deleting a project never
 * touches anything on disk, and repos may belong to any number of projects.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import chalk from 'chalk';

import type { Project, ProjectRepo } from '../types.js';
import { ensureConfigDir, getConfigDir } from './config.js';
import { detectDefaultBranch, isGitRepo } from '../utils/git.js';
import { slugify } from '../utils/slug.js';
import { debugLog } from '../utils/debug.js';

/** Name of the registry file inside ~/.nexusflow. */
const PROJECTS_FILE_NAME = 'projects.json';

/** On-disk shape of the registry file. */
interface ProjectsFile {
  version: 1;
  projects: Project[];
}

/**
 * Returns the absolute path to the project registry file.
 */
export function getProjectsFilePath(): string {
  return path.join(getConfigDir(), PROJECTS_FILE_NAME);
}

/**
 * Derives a registry id from a project name (the shared slug rule).
 */
export function slugifyProjectName(name: string): string {
  return slugify(name);
}

/**
 * Loads all registered projects. A missing registry file means no projects
 * yet; a corrupted one is surfaced (silently losing the registry would be a
 * nasty failure mode) and treated as empty for this run.
 */
export async function loadProjects(options: { quiet?: boolean } = {}): Promise<Project[]> {
  let raw: string;
  try {
    raw = await fs.readFile(getProjectsFilePath(), 'utf-8');
  } catch {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as ProjectsFile;
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch (error) {
    if (!options.quiet) {
      console.warn(chalk.yellow('⚠ ~/.nexusflow/projects.json is invalid JSON — treating the registry as empty for this run.'));
    }
    debugLog('projects', 'parse projects.json', error);
    return [];
  }
}

/**
 * Persists the registry atomically (temp file + rename) so a crash mid-write
 * can never truncate the only copy of the user's project index.
 */
async function saveProjects(projects: Project[]): Promise<void> {
  await ensureConfigDir();
  const filePath = getProjectsFilePath();
  const tmpPath = `${filePath}.tmp`;
  const data: ProjectsFile = { version: 1, projects };
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  await fs.rename(tmpPath, filePath);
}

/**
 * Returns a single project by id, or `null` if it isn't registered.
 */
export async function getProject(id: string): Promise<Project | null> {
  const projects = await loadProjects({ quiet: true });
  return projects.find((p) => p.id === id) ?? null;
}

/**
 * Validates and resolves repo paths into {@link ProjectRepo} entries.
 * Duplicates are collapsed; a non-git path is a hard error so a typo can't
 * silently register a broken project.
 */
async function resolveProjectRepos(repoPaths: string[]): Promise<ProjectRepo[]> {
  const unique = [...new Set(repoPaths.map((p) => path.resolve(p)))];
  if (unique.length === 0) {
    throw new Error('A project needs at least one repository');
  }
  // Repo directory names must be unique: worktree workspaces check them out
  // as sibling subdirectories, and the changes/diff views address repos by
  // name — two repos named "api" from different parents would collide.
  const seenNames = new Set<string>();
  for (const repoPath of unique) {
    const name = path.basename(repoPath);
    if (seenNames.has(name)) {
      throw new Error(`Two repositories share the directory name "${name}" — repo names must be unique within a project`);
    }
    seenNames.add(name);
  }
  return Promise.all(
    unique.map(async (repoPath) => {
      if (!(await isGitRepo(repoPath))) {
        throw new Error(`Not a git repository: ${repoPath}`);
      }
      return { path: repoPath, defaultBranch: await detectDefaultBranch(repoPath) };
    }),
  );
}

/**
 * Registers a new project.
 *
 * @param name        - Human-readable project name; the id is slugified from it.
 * @param repoPaths   - Absolute paths to the source repositories to include.
 * @param description - Optional short description.
 * @returns The newly created project.
 */
export async function createProject(
  name: string,
  repoPaths: string[],
  description?: string,
): Promise<Project> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Project name cannot be empty');
  }
  const id = slugifyProjectName(trimmed);
  if (!id) {
    throw new Error(`Project name "${name}" contains no usable characters`);
  }

  const projects = await loadProjects({ quiet: true });
  if (projects.some((p) => p.id === id)) {
    throw new Error(`A project with id "${id}" already exists`);
  }

  const now = new Date().toISOString();
  const project: Project = {
    id,
    name: trimmed,
    ...(description?.trim() ? { description: description.trim() } : {}),
    repos: await resolveProjectRepos(repoPaths),
    createdAt: now,
    updatedAt: now,
  };

  await saveProjects([...projects, project]);
  return project;
}

/**
 * Updates an existing project's name, description, and/or repo list.
 * The id is stable — renaming does not re-slug, so features that reference
 * the project keep working.
 *
 * @returns The updated project.
 */
export async function updateProject(
  id: string,
  updates: { name?: string; description?: string; repoPaths?: string[] },
): Promise<Project> {
  const projects = await loadProjects({ quiet: true });
  const index = projects.findIndex((p) => p.id === id);
  if (index === -1) {
    throw new Error(`No project with id "${id}"`);
  }

  const updated: Project = { ...projects[index], updatedAt: new Date().toISOString() };
  if (updates.name !== undefined) {
    const name = updates.name.trim();
    if (!name) {
      throw new Error('Project name cannot be empty');
    }
    updated.name = name;
  }
  if (updates.description !== undefined) {
    const description = updates.description.trim();
    if (description) {
      updated.description = description;
    } else {
      delete updated.description;
    }
  }
  if (updates.repoPaths) {
    updated.repos = await resolveProjectRepos(updates.repoPaths);
  }

  const next = [...projects];
  next[index] = updated;
  await saveProjects(next);
  return updated;
}

/**
 * Removes a project from the registry. Registry-only: never deletes anything
 * on disk.
 *
 * @returns `true` if the project existed and was removed.
 */
export async function removeProject(id: string): Promise<boolean> {
  const projects = await loadProjects({ quiet: true });
  const next = projects.filter((p) => p.id !== id);
  if (next.length === projects.length) {
    return false;
  }
  await saveProjects(next);
  return true;
}
