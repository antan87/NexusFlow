/**
 * @module analyzers/tech-stack
 * Detects the language, framework, build tools, and project type
 * of a repository by inspecting manifest files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { globby } from 'globby';

import type { TechStack, Language, Framework, ProjectType } from '../types.js';

/** Safely read and parse a JSON file. Returns null on failure. */
async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Detects the tech stack of a repository by recursively inspecting its
 * contents for manifest files, config files, and project structures.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns A {@link TechStack} object describing the detected stack.
 */
export async function detectTechStack(repoPath: string): Promise<TechStack> {
  const languages = new Set<Language>();
  const frameworks = new Set<Framework>();
  const buildTools = new Set<string>();
  const projectTypes = new Set<ProjectType>();

  try {
    const files = await globby([
      '**/package.json',
      '**/tsconfig.json',
      '**/*.csproj',
      '**/*.sln',
      '**/requirements.txt',
      '**/pyproject.toml',
      '**/setup.py',
      '**/go.mod',
      '**/pom.xml',
      '**/build.gradle',
      '**/build.gradle.kts',
      '**/Cargo.toml',
      '**/Gemfile',
      '**/composer.json',
      '**/Dockerfile',
      '**/docker-compose.yml',
      '**/docker-compose.yaml',
      '**/compose.yaml',
      '**/compose.yml',
    ], {
      cwd: repoPath,
      absolute: true,
      ignore: ['**/node_modules/**', '**/bin/**', '**/obj/**', '**/dist/**', '**/out/**', '**/.git/**'],
    });

    const fileMap = new Map<string, string[]>();
    for (const file of files) {
      const name = path.basename(file);
      let list = fileMap.get(name);
      if (!list) {
        list = [];
        fileMap.set(name, list);
      }
      list.push(file);
    }

    // ── Node.js / JavaScript / TypeScript ──────────────────────────────
    const packageJsons = fileMap.get('package.json') || [];
    if (packageJsons.length > 0) {
      const tsconfigs = fileMap.get('tsconfig.json') || [];
      if (tsconfigs.length > 0) {
        languages.add('typescript');
      } else {
        languages.add('javascript');
      }

      for (const pj of packageJsons) {
        const pkg = await readJson(pj);
        if (pkg) {
          const allDeps = {
            ...(pkg.dependencies as Record<string, string> | undefined),
            ...(pkg.devDependencies as Record<string, string> | undefined),
          };

          // Frameworks
          if (allDeps['next']) { frameworks.add('nextjs'); projectTypes.add('fullstack'); }
          if (allDeps['react'] && !allDeps['next']) { frameworks.add('react'); projectTypes.add('frontend'); }
          if (allDeps['@angular/core']) { frameworks.add('angular'); projectTypes.add('frontend'); }
          if (allDeps['vue']) { frameworks.add('vue'); projectTypes.add('frontend'); }
          if (allDeps['svelte']) { frameworks.add('svelte'); projectTypes.add('frontend'); }
          if (allDeps['express']) { frameworks.add('express'); projectTypes.add('backend'); }
          if (allDeps['@nestjs/core']) { frameworks.add('nestjs'); projectTypes.add('backend'); }
          if (allDeps['fastify']) { frameworks.add('fastify'); projectTypes.add('backend'); }
          if (allDeps['hono']) { frameworks.add('hono'); projectTypes.add('backend'); }

          // Build tools
          if (allDeps['vite'] || allDeps['@vitejs/plugin-react']) buildTools.add('vite');
          if (allDeps['webpack']) buildTools.add('webpack');
          if (allDeps['esbuild']) buildTools.add('esbuild');
          if (allDeps['rollup']) buildTools.add('rollup');
          if (allDeps['turbo']) buildTools.add('turborepo');
          if (allDeps['nx']) buildTools.add('nx');

          // Project type heuristics
          if (pkg.bin) projectTypes.add('cli');
          if (pkg.main && !pkg.bin && frameworks.size === 0) projectTypes.add('library');
        }
      }
    }

    // ── .NET / C# ─────────────────────────────────────────────────────
    const csprojFiles = files.filter((f) => f.endsWith('.csproj'));
    const slnFiles = files.filter((f) => f.endsWith('.sln'));
    if (csprojFiles.length > 0 || slnFiles.length > 0) {
      languages.add('csharp');
      buildTools.add('dotnet');

      for (const csproj of csprojFiles) {
        try {
          const content = await fs.readFile(csproj, 'utf-8');
          if (content.includes('Microsoft.NET.Sdk.Web')) {
            frameworks.add('aspnet');
            projectTypes.add('backend');
          }
          if (content.includes('Microsoft.NET.Sdk.BlazorWebAssembly') || content.includes('Blazor')) {
            frameworks.add('blazor');
            projectTypes.add('frontend');
          }
        } catch {}
      }
    }

    // ── Python ────────────────────────────────────────────────────────
    const pyprojectTomls = fileMap.get('pyproject.toml') || [];
    const requirementsTxts = fileMap.get('requirements.txt') || [];
    const setupPys = fileMap.get('setup.py') || [];

    if (pyprojectTomls.length > 0 || requirementsTxts.length > 0 || setupPys.length > 0) {
      languages.add('python');

      for (const reqFile of [...requirementsTxts, ...pyprojectTomls]) {
        try {
          const content = await fs.readFile(reqFile, 'utf-8');
          const lower = content.toLowerCase();
          if (lower.includes('django')) { frameworks.add('django'); projectTypes.add('backend'); }
          if (lower.includes('flask')) { frameworks.add('flask'); projectTypes.add('backend'); }
          if (lower.includes('fastapi')) { frameworks.add('fastapi'); projectTypes.add('backend'); }
        } catch {}
      }

      if (pyprojectTomls.length > 0) buildTools.add('pyproject');
      if (setupPys.length > 0) buildTools.add('setuptools');
    }

    // ── Go ────────────────────────────────────────────────────────────
    const goMods = fileMap.get('go.mod') || [];
    if (goMods.length > 0) {
      languages.add('go');
      buildTools.add('go');

      for (const goMod of goMods) {
        try {
          const content = await fs.readFile(goMod, 'utf-8');
          if (content.includes('github.com/gin-gonic/gin')) {
            frameworks.add('gin');
            projectTypes.add('backend');
          }
        } catch {}
      }
    }

    // ── Java ──────────────────────────────────────────────────────────
    const poms = fileMap.get('pom.xml') || [];
    const gradles = fileMap.get('build.gradle') || [];
    const gradleKts = fileMap.get('build.gradle.kts') || [];

    if (poms.length > 0 || gradles.length > 0 || gradleKts.length > 0) {
      languages.add('java');
      if (poms.length > 0) buildTools.add('maven');
      if (gradles.length > 0 || gradleKts.length > 0) buildTools.add('gradle');

      for (const f of [...poms, ...gradles, ...gradleKts]) {
        try {
          const content = await fs.readFile(f, 'utf-8');
          if (content.includes('spring')) {
            frameworks.add('spring');
            projectTypes.add('backend');
          }
        } catch {}
      }
    }

    // ── Rust ──────────────────────────────────────────────────────────
    const cargoTomls = fileMap.get('Cargo.toml') || [];
    if (cargoTomls.length > 0) {
      languages.add('rust');
      buildTools.add('cargo');
    }

    // ── Ruby ──────────────────────────────────────────────────────────
    const gemfiles = fileMap.get('Gemfile') || [];
    if (gemfiles.length > 0) {
      languages.add('ruby');
      buildTools.add('bundler');

      for (const gemfile of gemfiles) {
        try {
          const content = await fs.readFile(gemfile, 'utf-8');
          if (content.includes('rails')) {
            frameworks.add('rails');
            projectTypes.add('backend');
          }
        } catch {}
      }
    }

    // ── PHP ───────────────────────────────────────────────────────────
    const composerJsons = fileMap.get('composer.json') || [];
    if (composerJsons.length > 0) {
      languages.add('php');
      buildTools.add('composer');

      for (const comp of composerJsons) {
        const composer = await readJson(comp);
        if (composer) {
          const req = composer.require as Record<string, string> | undefined;
          if (req?.['laravel/framework']) {
            frameworks.add('laravel');
            projectTypes.add('backend');
          }
        }
      }
    }

    // ── Docker ────────────────────────────────────────────────────────
    const dockerfiles = fileMap.get('Dockerfile') || [];
    if (dockerfiles.length > 0) {
      buildTools.add('docker');
    }
    const hasCompose = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml'].some(
      (name) => (fileMap.get(name) || []).length > 0
    );
    if (hasCompose) {
      buildTools.add('docker-compose');
    }

  } catch {
    // Ignore errors during glob/analysis
  }

  // Fallback language
  if (languages.size === 0) {
    languages.add('other');
  }

  // Heuristic for overall projectType
  let finalProjectType: ProjectType = 'other';
  if (projectTypes.has('fullstack') || (projectTypes.has('frontend') && projectTypes.has('backend'))) {
    finalProjectType = 'fullstack';
  } else if (projectTypes.has('frontend')) {
    finalProjectType = 'frontend';
  } else if (projectTypes.has('backend')) {
    finalProjectType = 'backend';
  } else if (projectTypes.has('library')) {
    finalProjectType = 'library';
  } else if (projectTypes.has('cli')) {
    finalProjectType = 'cli';
  }

  return {
    languages: Array.from(languages),
    frameworks: Array.from(frameworks),
    buildTools: Array.from(buildTools),
    projectType: finalProjectType,
  };
}
