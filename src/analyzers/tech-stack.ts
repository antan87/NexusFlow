/**
 * @module analyzers/tech-stack
 * Detects the language, framework, build tools, and project type
 * of a repository by inspecting manifest files.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { TechStack, Language, Framework, ProjectType } from '../types.js';

/** Check if a file exists in a directory. */
async function fileExists(dir: string, filename: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, filename));
    return true;
  } catch {
    return false;
  }
}

/** Safely read and parse a JSON file. Returns null on failure. */
async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Check if any file matching a glob-like pattern exists. */
async function hasFileWithExtension(dir: string, ext: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.some((e) => e.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Detects the tech stack of a repository by inspecting its root directory
 * for manifest files, config files, and project structures.
 *
 * @param repoPath - Absolute path to the repository root.
 * @returns A {@link TechStack} object describing the detected stack.
 */
export async function detectTechStack(repoPath: string): Promise<TechStack> {
  const languages: Language[] = [];
  const frameworks: Framework[] = [];
  const buildTools: string[] = [];
  let projectType: ProjectType = 'other';

  // ── Node.js / JavaScript / TypeScript ──────────────────────────────
  const hasPackageJson = await fileExists(repoPath, 'package.json');
  if (hasPackageJson) {
    const pkg = await readJson(path.join(repoPath, 'package.json'));

    // Detect TypeScript vs JavaScript
    const hasTsConfig = await fileExists(repoPath, 'tsconfig.json');
    if (hasTsConfig) {
      languages.push('typescript');
    } else {
      languages.push('javascript');
    }

    if (pkg) {
      const allDeps = {
        ...(pkg.dependencies as Record<string, string> | undefined),
        ...(pkg.devDependencies as Record<string, string> | undefined),
      };

      // Frameworks
      if (allDeps['next']) { frameworks.push('nextjs'); projectType = 'fullstack'; }
      if (allDeps['react'] && !allDeps['next']) { frameworks.push('react'); projectType = 'frontend'; }
      if (allDeps['@angular/core']) { frameworks.push('angular'); projectType = 'frontend'; }
      if (allDeps['vue']) { frameworks.push('vue'); projectType = 'frontend'; }
      if (allDeps['svelte']) { frameworks.push('svelte'); projectType = 'frontend'; }
      if (allDeps['express']) { frameworks.push('express'); projectType = 'backend'; }
      if (allDeps['@nestjs/core']) { frameworks.push('nestjs'); projectType = 'backend'; }
      if (allDeps['fastify']) { frameworks.push('fastify'); projectType = 'backend'; }
      if (allDeps['hono']) { frameworks.push('hono'); projectType = 'backend'; }

      // Build tools
      if (allDeps['vite'] || allDeps['@vitejs/plugin-react']) buildTools.push('vite');
      if (allDeps['webpack']) buildTools.push('webpack');
      if (allDeps['esbuild']) buildTools.push('esbuild');
      if (allDeps['rollup']) buildTools.push('rollup');
      if (allDeps['turbo']) buildTools.push('turborepo');
      if (allDeps['nx']) buildTools.push('nx');

      // Project type heuristics
      if (pkg.bin) projectType = 'cli';
      if (pkg.main && !pkg.bin && frameworks.length === 0) projectType = 'library';
    }
  }

  // ── .NET / C# ─────────────────────────────────────────────────────
  const hasCsproj = await hasFileWithExtension(repoPath, '.csproj');
  const hasSln = await hasFileWithExtension(repoPath, '.sln');
  if (hasCsproj || hasSln) {
    languages.push('csharp');

    // Try to detect ASP.NET or Blazor from csproj content
    try {
      const entries = await fs.readdir(repoPath);
      const csprojFile = entries.find((e) => e.endsWith('.csproj'));
      if (csprojFile) {
        const content = await fs.readFile(path.join(repoPath, csprojFile), 'utf-8');
        if (content.includes('Microsoft.NET.Sdk.Web')) {
          frameworks.push('aspnet');
          projectType = 'backend';
        }
        if (content.includes('Microsoft.NET.Sdk.BlazorWebAssembly') || content.includes('Blazor')) {
          frameworks.push('blazor');
          projectType = 'frontend';
        }
      }
    } catch {
      // Ignore read errors
    }

    buildTools.push('dotnet');
  }

  // ── Python ────────────────────────────────────────────────────────
  const hasPyproject = await fileExists(repoPath, 'pyproject.toml');
  const hasRequirements = await fileExists(repoPath, 'requirements.txt');
  const hasSetupPy = await fileExists(repoPath, 'setup.py');
  if (hasPyproject || hasRequirements || hasSetupPy) {
    languages.push('python');

    // Try to detect frameworks from requirements
    try {
      let content = '';
      if (hasRequirements) {
        content = await fs.readFile(path.join(repoPath, 'requirements.txt'), 'utf-8');
      } else if (hasPyproject) {
        content = await fs.readFile(path.join(repoPath, 'pyproject.toml'), 'utf-8');
      }
      const lower = content.toLowerCase();
      if (lower.includes('django')) { frameworks.push('django'); projectType = 'backend'; }
      if (lower.includes('flask')) { frameworks.push('flask'); projectType = 'backend'; }
      if (lower.includes('fastapi')) { frameworks.push('fastapi'); projectType = 'backend'; }
    } catch {
      // Ignore
    }

    if (hasPyproject) buildTools.push('pyproject');
    if (hasSetupPy) buildTools.push('setuptools');
  }

  // ── Go ────────────────────────────────────────────────────────────
  const hasGoMod = await fileExists(repoPath, 'go.mod');
  if (hasGoMod) {
    languages.push('go');
    buildTools.push('go');

    try {
      const content = await fs.readFile(path.join(repoPath, 'go.mod'), 'utf-8');
      if (content.includes('github.com/gin-gonic/gin')) {
        frameworks.push('gin');
        projectType = 'backend';
      }
    } catch {
      // Ignore
    }
  }

  // ── Java ──────────────────────────────────────────────────────────
  const hasPom = await fileExists(repoPath, 'pom.xml');
  const hasGradle = await fileExists(repoPath, 'build.gradle');
  const hasGradleKts = await fileExists(repoPath, 'build.gradle.kts');
  if (hasPom || hasGradle || hasGradleKts) {
    languages.push('java');
    if (hasPom) buildTools.push('maven');
    if (hasGradle || hasGradleKts) buildTools.push('gradle');

    try {
      let content = '';
      if (hasPom) {
        content = await fs.readFile(path.join(repoPath, 'pom.xml'), 'utf-8');
      } else if (hasGradle) {
        content = await fs.readFile(path.join(repoPath, 'build.gradle'), 'utf-8');
      }
      if (content.includes('spring')) {
        frameworks.push('spring');
        projectType = 'backend';
      }
    } catch {
      // Ignore
    }
  }

  // ── Rust ──────────────────────────────────────────────────────────
  const hasCargo = await fileExists(repoPath, 'Cargo.toml');
  if (hasCargo) {
    languages.push('rust');
    buildTools.push('cargo');
  }

  // ── Ruby ──────────────────────────────────────────────────────────
  const hasGemfile = await fileExists(repoPath, 'Gemfile');
  if (hasGemfile) {
    languages.push('ruby');
    buildTools.push('bundler');

    try {
      const content = await fs.readFile(path.join(repoPath, 'Gemfile'), 'utf-8');
      if (content.includes('rails')) {
        frameworks.push('rails');
        projectType = 'backend';
      }
    } catch {
      // Ignore
    }
  }

  // ── PHP ───────────────────────────────────────────────────────────
  const hasComposer = await fileExists(repoPath, 'composer.json');
  if (hasComposer) {
    languages.push('php');
    buildTools.push('composer');

    const composer = await readJson(path.join(repoPath, 'composer.json'));
    if (composer) {
      const req = composer.require as Record<string, string> | undefined;
      if (req?.['laravel/framework']) {
        frameworks.push('laravel');
        projectType = 'backend';
      }
    }
  }

  // ── Docker ────────────────────────────────────────────────────────
  if (await fileExists(repoPath, 'Dockerfile')) {
    buildTools.push('docker');
  }
  if (await fileExists(repoPath, 'docker-compose.yml') || await fileExists(repoPath, 'compose.yaml')) {
    buildTools.push('docker-compose');
  }

  // Fallback
  if (languages.length === 0) {
    languages.push('other');
  }

  return {
    languages,
    frameworks,
    buildTools,
    projectType,
  };
}
