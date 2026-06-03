/**
 * @module analyzers/index
 * Orchestrates all project analyzers and produces a full ProjectAnalysis
 * for each repository.
 */

import chalk from 'chalk';
import ora from 'ora';

import type { ProjectAnalysis, RepoInfo } from '../types.js';
import { detectTechStack } from './tech-stack.js';
import { detectApis } from './detect-apis.js';
import { detectDependencies, detectProducedPackages, detectNuGetFeeds } from './detect-deps.js';
import { detectPorts } from './detect-ports.js';
import { detectExistingAIConfigs } from './detect-existing.js';
import { extractReadmeSummary } from './readme-summarizer.js';

/**
 * Runs all analyzers against a single repository and returns
 * a complete {@link ProjectAnalysis}.
 *
 * @param repo - The repo metadata.
 * @returns Full analysis result.
 */
export async function analyzeRepo(repo: RepoInfo): Promise<ProjectAnalysis> {
  const [techStack, endpoints, dependencies, produces, nugetFeeds, ports, existingAIConfigs, readmeSummary] =
    await Promise.all([
      detectTechStack(repo.path),
      detectApis(repo.path),
      detectDependencies(repo.path),
      detectProducedPackages(repo.path),
      detectNuGetFeeds(repo.path),
      detectPorts(repo.path),
      detectExistingAIConfigs(repo.path),
      extractReadmeSummary(repo.path),
    ]);

  return {
    name: repo.name,
    path: repo.path,
    techStack,
    endpoints,
    dependencies,
    produces,
    nugetFeeds,
    ports,
    existingAIConfigs,
    readmeSummary,
  };
}

/**
 * Analyzes all repos in a list and returns a Map of path → analysis.
 * Shows a progress spinner while running.
 *
 * @param repos - Array of repos to analyze.
 * @returns Map of repo path to {@link ProjectAnalysis}.
 */
export async function analyzeAllRepos(
  repos: RepoInfo[],
): Promise<Map<string, ProjectAnalysis>> {
  const spinner = ora('Analyzing projects...').start();
  const results = new Map<string, ProjectAnalysis>();

  for (let i = 0; i < repos.length; i++) {
    const repo = repos[i]!;
    spinner.text = `Analyzing ${chalk.bold(repo.name)} (${i + 1}/${repos.length})...`;

    try {
      const analysis = await analyzeRepo(repo);
      results.set(repo.path, analysis);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      spinner.warn(`Failed to analyze ${repo.name}: ${msg}`);
      spinner.start();
    }
  }

  spinner.succeed(`Analyzed ${chalk.bold(results.size)} projects`);
  return results;
}

// Re-export individual analyzers
export { detectTechStack } from './tech-stack.js';
export { detectApis } from './detect-apis.js';
export { detectDependencies, findInterRepoDependencies, detectNuGetFeeds } from './detect-deps.js';
export { detectPorts } from './detect-ports.js';
export { detectExistingAIConfigs } from './detect-existing.js';
export { extractReadmeSummary } from './readme-summarizer.js';
