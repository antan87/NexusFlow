/**
 * @module analyzers/detect-deps
 * Detects dependencies declared in a repository by reading manifest files.
 * This is used to find potential inter-repo connections (e.g., one repo
 * consumes an npm package published by another).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

import type { RepoDependency, ProjectAnalysis } from '../types.js';

/**
 * Extracts declared dependencies from a repository's manifest files recursively.
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

  try {
    const files = await globby(
      ['**/package.json', '**/*.csproj', '**/requirements.txt', '**/go.mod'],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      }
    );

    for (const file of files) {
      const filename = path.basename(file);

      // ── npm ───────────────────────────────────────────────────────────
      if (filename === 'package.json') {
        try {
          const raw = await fs.readFile(file, 'utf-8');
          const pkg = JSON.parse(raw) as Record<string, unknown>;

          const allDeps: Record<string, string> = {
            ...(pkg.dependencies as Record<string, string> | undefined),
            ...(pkg.devDependencies as Record<string, string> | undefined),
          };

          for (const [name, version] of Object.entries(allDeps)) {
            deps.push({ name, type: 'npm', version });
          }
        } catch {
          // Parse error or skip
        }
      }

      // ── NuGet (.csproj) ───────────────────────────────────────────────
      else if (filename.endsWith('.csproj')) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const packageRefRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]*)"/gi;
          let match: RegExpExecArray | null;
          while ((match = packageRefRegex.exec(content)) !== null) {
            deps.push({ name: match[1]!, type: 'nuget', version: match[2] });
          }
        } catch {
          // Skip
        }
      }

      // ── pip (requirements.txt) ────────────────────────────────────────
      else if (filename === 'requirements.txt') {
        try {
          const content = await fs.readFile(file, 'utf-8');
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
          // Skip
        }
      }

      // ── Go (go.mod) ──────────────────────────────────────────────────
      else if (filename === 'go.mod') {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const requireRegex = /require\s*\(([\s\S]*?)\)/g;
          const modRegex = /^\s*([\S]+)\s+(v[\S]+)/gm;

          let match: RegExpExecArray | null;
          while ((match = requireRegex.exec(content)) !== null) {
            const block = match[1]!;
            let modMatch: RegExpExecArray | null;
            modRegex.lastIndex = 0;
            while ((modMatch = modRegex.exec(block)) !== null) {
              deps.push({ name: modMatch[1]!, type: 'go', version: modMatch[2] });
            }
          }
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Ignore errors
  }

  // De-duplicate dependencies to keep context clean
  const seen = new Set<string>();
  const uniqueDeps: RepoDependency[] = [];
  for (const dep of deps) {
    const key = `${dep.type}:${dep.name}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDeps.push(dep);
    }
  }

  return uniqueDeps;
}

/**
 * Scans recursively for packages produced or published by the repository.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of produced package metadata.
 */
export async function detectProducedPackages(
  repoPath: string,
): Promise<{ name: string; type: 'npm' | 'nuget' | 'other'; version?: string; contributing?: string[] }[]> {
  const products: { name: string; type: 'npm' | 'nuget' | 'other'; version?: string; contributing?: string[] }[] = [];

  try {
    const files = await globby(
      ['**/package.json', '**/*.csproj'],
      {
        cwd: repoPath,
        absolute: true,
        ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
      }
    );

    for (const file of files) {
      const filename = path.basename(file);

      if (filename === 'package.json') {
        try {
          const raw = await fs.readFile(file, 'utf-8');
          const pkg = JSON.parse(raw) as Record<string, unknown>;
          if (pkg.name && pkg.name !== 'workspace' && !pkg.private) {
            products.push({
              name: pkg.name as string,
              type: 'npm',
              version: (pkg.version as string) || undefined,
            });
          }
        } catch {
          // Skip
        }
      } else if (filename.endsWith('.csproj')) {
        try {
          const content = await fs.readFile(file, 'utf-8');
          const packageIdMatch = /<PackageId>([^<]+)<\/PackageId>/i.exec(content);
          const assemblyNameMatch = /<AssemblyName>([^<]+)<\/AssemblyName>/i.exec(content);
          const versionMatch = /<Version>([^<]+)<\/Version>/i.exec(content);

          const name =
            packageIdMatch?.[1]?.trim() ||
            assemblyNameMatch?.[1]?.trim() ||
            path.basename(file, '.csproj');

          // Extract project references to find contributing sub-projects
          const projRefRegex = /<ProjectReference\s+Include="([^"]+)"/gi;
          const contributing: string[] = [];
          let projMatch: RegExpExecArray | null;
          while ((projMatch = projRefRegex.exec(content)) !== null) {
            const refPath = projMatch[1];
            const refName = path.basename(refPath, '.csproj');
            contributing.push(refName);
          }

          products.push({
            name,
            type: 'nuget',
            version: versionMatch?.[1]?.trim() || undefined,
            contributing: contributing.length > 0 ? contributing : undefined,
          });
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return products;
}

/**
 * Given analysis of multiple repos, find which repos depend on each other.
 * Returns a map of repo name → list of repo names it depends on.
 *
 * @param repoAnalyses - Map of repo path to its full analysis result.
 * @param repoNames    - Map of repo path to its name.
 * @returns Map of repo name → list of repo names it depends on.
 */
export function findInterRepoDependencies(
  repoAnalyses: Map<string, ProjectAnalysis>,
  repoNames: Map<string, string>,
): Map<string, string[]> {
  const connections = new Map<string, string[]>();

  // Map each produced package name to the repo name that produces it
  const packageToRepo = new Map<string, string>();
  for (const [repoPath, a] of repoAnalyses) {
    const thisName = repoNames.get(repoPath) ?? a.name;
    // Map the repo name itself as a produced product (for direct matching)
    packageToRepo.set(thisName.toLowerCase(), thisName);
    
    if (a.produces) {
      for (const product of a.produces) {
        packageToRepo.set(product.name.toLowerCase(), thisName);
        // Also map basename (e.g. Hogia.EmploymentService.Client -> Client)
        const base = product.name.split('.').pop() ?? product.name;
        if (base && base.length > 3) {
          packageToRepo.set(base.toLowerCase(), thisName);
        }
      }
    }
  }

  for (const [repoPath, a] of repoAnalyses) {
    const thisName = repoNames.get(repoPath) ?? a.name;
    const dependsOn: string[] = [];

    // Tolerate an analysis without a dependency list rather than throwing. This
    // now feeds the assistant context file on every build, so an incomplete
    // analysis must degrade to "no relations known" instead of failing context
    // generation outright.
    for (const dep of a.dependencies ?? []) {
      const depNameLower = dep.name.toLowerCase();
      
      // Exact match only. There used to be a substring fallback — `depName`
      // contains a produced package name, or vice versa — and it manufactured
      // dependencies out of coincidental name fragments: a repo called `core`
      // beside one declaring `@babel/core`, or a repo called `commserver`
      // beside one declaring `ms`. That was survivable while the only consumer
      // was a graph nobody read, but this now feeds the auto-loaded context
      // file, where a fabricated `needs`/`used by`/`Start with` is worse than
      // silence: an assistant cannot tell an invented edge from a real one.
      const targetRepo = packageToRepo.get(depNameLower);
      if (targetRepo && targetRepo !== thisName && !dependsOn.includes(targetRepo)) {
        dependsOn.push(targetRepo);
      }
    }

    if (dependsOn.length > 0) {
      connections.set(thisName, dependsOn);
    }
  }

  return connections;
}

/**
 * Scans for NuGet.config files recursively in the repository and extracts configured package source feeds.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns Array of package sources (key, value).
 */
export async function detectNuGetFeeds(repoPath: string): Promise<{ name: string; url: string }[]> {
  const feeds: { name: string; url: string }[] = [];
  try {
    const configFiles = await globby('**/NuGet.config', {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    for (const file of configFiles) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        // Scan for <add key="..." value="..." /> elements under <packageSources>
        const addRegex = /<add\s+key="([^"]+)"\s+value="([^"]+)"/gi;
        let match: RegExpExecArray | null;
        while ((match = addRegex.exec(content)) !== null) {
          const key = match[1];
          const value = match[2];
          // Exclude default public nuget feed to keep output focused on private feeds
          if (!isPublicNuGetFeed(key, value)) {
            feeds.push({ name: key, url: value });
          }
        }
      } catch {}
    }
  } catch {
    // Ignore errors
  }
  return feeds;
}

function isPublicNuGetFeed(key: string, urlStr: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  if (normalizedKey === 'nuget.org' || normalizedKey === 'nuget' || normalizedKey === 'nuget official package source') {
    return true;
  }
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return host === 'nuget.org' || host === 'api.nuget.org' || host.endsWith('.nuget.org');
  } catch {
    const raw = urlStr.trim().toLowerCase();
    return raw === 'nuget.org' || raw === 'api.nuget.org';
  }
}
