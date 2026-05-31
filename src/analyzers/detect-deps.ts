/**
 * @module analyzers/detect-deps
 * Detects dependencies declared in a repository by reading manifest files.
 * This is used to find potential inter-repo connections (e.g., one repo
 * consumes an npm package published by another).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { RepoDependency } from '../types.js';

/**
 * Extracts declared dependencies from a repository's manifest files.
 *
 * Supports:
 * - npm (package.json)
 * - NuGet (*.csproj)
 * - pip (requirements.txt)
 * - Go (go.mod)
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of detected {@link RepoDependency} objects.
 */
export async function detectDependencies(repoPath: string): Promise<RepoDependency[]> {
  const deps: RepoDependency[] = [];

  // ── npm ───────────────────────────────────────────────────────────
  try {
    const raw = await fs.readFile(path.join(repoPath, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
    };

    for (const [name, version] of Object.entries(allDeps)) {
      deps.push({ name, type: 'npm', version });
    }
  } catch {
    // No package.json or parse error
  }

  // ── NuGet (.csproj) ───────────────────────────────────────────────
  try {
    const entries = await fs.readdir(repoPath);
    const csprojFiles = entries.filter((e) => e.endsWith('.csproj'));

    for (const csproj of csprojFiles) {
      const content = await fs.readFile(path.join(repoPath, csproj), 'utf-8');
      const packageRefRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]*)"/gi;
      let match: RegExpExecArray | null;
      while ((match = packageRefRegex.exec(content)) !== null) {
        deps.push({ name: match[1]!, type: 'nuget', version: match[2] });
      }
    }
  } catch {
    // No .csproj files
  }

  // ── pip (requirements.txt) ────────────────────────────────────────
  try {
    const content = await fs.readFile(path.join(repoPath, 'requirements.txt'), 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim() && !l.startsWith('#'));

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*([>=<~!]*\s*[\d.*]+)?/);
      if (match) {
        deps.push({
          name: match[1]!,
          type: 'pip',
          version: match[2]?.trim() || undefined,
        });
      }
    }
  } catch {
    // No requirements.txt
  }

  // ── Go (go.mod) ──────────────────────────────────────────────────
  try {
    const content = await fs.readFile(path.join(repoPath, 'go.mod'), 'utf-8');
    const requireRegex = /require\s*\(([\s\S]*?)\)/g;
    const modRegex = /^\s*([\S]+)\s+(v[\S]+)/gm;

    let match: RegExpExecArray | null;
    // Parse require blocks
    while ((match = requireRegex.exec(content)) !== null) {
      const block = match[1]!;
      let modMatch: RegExpExecArray | null;
      modRegex.lastIndex = 0;
      while ((modMatch = modRegex.exec(block)) !== null) {
        deps.push({ name: modMatch[1]!, type: 'go', version: modMatch[2] });
      }
    }
  } catch {
    // No go.mod
  }

  return deps;
}

/**
 * Given analysis of multiple repos, find which repos depend on each other.
 * Returns a map of repo name → list of repo names it depends on.
 *
 * @param repoAnalyses - Map of repo path to its detected dependencies.
 * @param repoNames    - Map of repo path to its name.
 * @returns Map of repo name → list of repo names it depends on.
 */
export function findInterRepoDependencies(
  repoAnalyses: Map<string, RepoDependency[]>,
  repoNames: Map<string, string>,
): Map<string, string[]> {
  const nameSet = new Set(repoNames.values());
  const connections = new Map<string, string[]>();

  for (const [repoPath, deps] of repoAnalyses) {
    const thisName = repoNames.get(repoPath) ?? repoPath;
    const dependsOn: string[] = [];

    for (const dep of deps) {
      // Check if the dependency name matches another repo name
      // (e.g., an npm package name matching a repo folder name)
      const depBaseName = dep.name.split('/').pop() ?? dep.name;
      if (nameSet.has(depBaseName) && depBaseName !== thisName) {
        dependsOn.push(depBaseName);
      }
    }

    if (dependsOn.length > 0) {
      connections.set(thisName, dependsOn);
    }
  }

  return connections;
}
