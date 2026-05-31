/**
 * @module plan-generator
 * Analyzes inter-repo dependencies within a workspace and generates a
 * `nexusflow-plan.md` implementation plan with build-order phases.
 */

import path from 'node:path';
import fse from 'fs-extra';
import chalk from 'chalk';
import type {
  WorkspaceContext,
  ProjectAnalysis,
  RepoInfo,
  DependencyNode,
  DependencyGraph,
} from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────

/** Repo-name substrings that signal a shared/foundation package. */
const SHARED_PACKAGE_KEYWORDS = ['shared', 'common', 'contracts', 'types'];

/** Project types that act as backend producers. */
const BACKEND_TYPES = ['api', 'backend', 'service'];

/** Project types that act as frontend consumers. */
const FRONTEND_TYPES = ['frontend', 'webapp', 'app'];

// ─── Dependency Graph Builder ─────────────────────────────────────────────

/**
 * Build a dependency graph by analysing package dependencies, API
 * relationships and shared-package conventions across the workspace repos.
 *
 * @param analysis  Per-repo analysis results, keyed by repo path.
 * @param repos     Metadata for every repo in the workspace.
 * @returns A map of repo name → {@link DependencyNode}.
 */
export function buildDependencyGraph(
  analysis: Map<string, ProjectAnalysis>,
  repos: RepoInfo[],
): DependencyGraph {
  const graph: DependencyGraph = new Map();

  // ── Initialise a node for each repo ──────────────────────────────────
  for (const repo of repos) {
    graph.set(repo.name, {
      repoName: repo.name,
      repoPath: repo.path,
      dependsOn: [],
      dependedOnBy: [],
    });
  }

  // Build a quick lookup: repo name → ProjectAnalysis
  const analysisByName = new Map<string, ProjectAnalysis>();
  for (const repo of repos) {
    const a = analysis.get(repo.path);
    if (a) analysisByName.set(repo.name, a);
  }

  const repoNames = new Set(repos.map((r) => r.name));

  // ── 1. Shared-package dependencies ───────────────────────────────────
  for (const repo of repos) {
    const a = analysisByName.get(repo.name);
    if (!a) continue;

    for (const dep of a.dependencies) {
      // Direct name match — e.g. "@acme/shared-contracts" contains "shared-contracts"
      for (const otherName of repoNames) {
        if (otherName === repo.name) continue;
        if (dep.name === otherName || dep.name.includes(otherName)) {
          addEdge(graph, repo.name, otherName);
        }
      }
    }
  }

  // ── 2. API relationships (frontend → backend heuristic) ─────────────
  for (const repoA of repos) {
    const analysisA = analysisByName.get(repoA.name);
    if (!analysisA) continue;

    const typeA = analysisA.techStack.projectType;

    if (!BACKEND_TYPES.includes(typeA)) continue;

    for (const repoB of repos) {
      if (repoB.name === repoA.name) continue;

      const analysisB = analysisByName.get(repoB.name);
      if (!analysisB) continue;

      const typeB = analysisB.techStack.projectType;
      if (FRONTEND_TYPES.includes(typeB)) {
        // B (frontend) depends on A (backend)
        addEdge(graph, repoB.name, repoA.name);
      }
    }
  }

  // ── 3. Shared-type packages are always foundation ───────────────────
  for (const repo of repos) {
    const isShared = SHARED_PACKAGE_KEYWORDS.some((kw) =>
      repo.name.toLowerCase().includes(kw),
    );
    if (!isShared) continue;

    const node = graph.get(repo.name);
    if (!node) continue;

    // Ensure no outgoing deps (it's a leaf producer)
    node.dependsOn = [];

    // Every other repo that doesn't already depend on it — add edge
    for (const other of repos) {
      if (other.name === repo.name) continue;
      addEdge(graph, other.name, repo.name);
    }
  }

  return graph;
}

// ─── Topological Sort ─────────────────────────────────────────────────────

/**
 * Topologically sort the dependency graph into build phases.
 * Each phase is a group of repos that can be built in parallel
 * because all of their dependencies appear in earlier phases.
 *
 * If a cycle is detected, the remaining nodes are placed in a final phase
 * with a warning logged to the console.
 *
 * @param graph  The workspace dependency graph.
 * @returns An array of phases, where each phase is an array of repo names.
 */
export function topologicalSort(graph: DependencyGraph): string[][] {
  // Calculate in-degrees
  const inDegree = new Map<string, number>();
  for (const [name, node] of graph) {
    inDegree.set(name, node.dependsOn.length);
  }

  const phases: string[][] = [];
  const placed = new Set<string>();

  while (placed.size < graph.size) {
    // Collect nodes whose in-degree is 0 and haven't been placed yet
    const phase: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0 && !placed.has(name)) {
        phase.push(name);
      }
    }

    // Cycle detection — no zero-in-degree nodes remain
    if (phase.length === 0) {
      const remaining = [...graph.keys()].filter((n) => !placed.has(n));
      console.log(
        chalk.yellow('  ⚠'),
        `Dependency cycle detected among: ${remaining.join(', ')}`,
      );
      phases.push(remaining);
      break;
    }

    phase.sort(); // Deterministic ordering within a phase
    phases.push(phase);

    // "Remove" placed nodes and decrement dependents' in-degrees
    for (const name of phase) {
      placed.add(name);
      const node = graph.get(name)!;
      for (const dependent of node.dependedOnBy) {
        inDegree.set(dependent, (inDegree.get(dependent) ?? 1) - 1);
      }
    }
  }

  return phases;
}

// ─── Plan Generator ───────────────────────────────────────────────────────

/**
 * Generate a `nexusflow-plan.md` implementation plan for the workspace.
 *
 * The plan includes:
 * - A Mermaid dependency diagram
 * - Phased implementation order derived from topological sort
 * - A dependency cross-reference table
 *
 * @param ctx            The current workspace context (feature + repos + analysis).
 * @param workspacePath  Absolute path to the workspace root directory.
 */
export async function generateImplementationPlan(
  ctx: WorkspaceContext,
  workspacePath: string,
): Promise<void> {
  try {
    const { feature, repos, analysis } = ctx;

    // ── Fallback: no analysis available ─────────────────────────────────
    if (!analysis || analysis.size === 0) {
      const lines = [
        `# Implementation Plan — ${feature.id}`,
        '',
        '> Auto-generated by NexusFlow.',
        '> No project analysis data was available, so repos are listed alphabetically.',
        '',
        '## Repos',
        '',
        ...repos
          .map((r) => r.name)
          .sort()
          .map((n) => `- ${n}`),
        '',
      ];
      await fse.outputFile(
        path.join(workspacePath, 'nexusflow-plan.md'),
        lines.join('\n'),
      );
      console.log(chalk.green('  ✔'), 'Generated nexusflow-plan.md');
      return;
    }

    // ── Build graph & sort ──────────────────────────────────────────────
    const graph = buildDependencyGraph(analysis, repos);
    const phases = topologicalSort(graph);

    // ── Render markdown ─────────────────────────────────────────────────
    const md: string[] = [];

    md.push(`# Implementation Plan — ${feature.id}`);
    md.push('');
    md.push(
      '> Auto-generated by NexusFlow based on dependency analysis between repos.',
    );
    md.push(
      '> Follow the phase order to avoid blocking yourself on cross-repo dependencies.',
    );
    md.push('');

    // ── Mermaid diagram ─────────────────────────────────────────────────
    md.push('## Dependency Diagram');
    md.push('');
    md.push('```mermaid');
    md.push('graph TD');

    const alias = buildAliasMap(graph);

    for (const [name, node] of graph) {
      if (node.dependsOn.length === 0 && node.dependedOnBy.length === 0) {
        // Isolated node — still show it
        md.push(`    ${alias.get(name)}["${name}"]`);
      }
      for (const dep of node.dependsOn) {
        // Arrow: dependency → dependent (dep is built first)
        md.push(
          `    ${alias.get(dep)}["${dep}"] --> ${alias.get(name)}["${name}"]`,
        );
      }
    }

    md.push('```');
    md.push('');

    // ── Phase descriptions ──────────────────────────────────────────────
    md.push('## Suggested Implementation Order');
    md.push('');

    const phaseLabels = [
      'Foundation',
      'Core Services',
      'Integration Layer',
      'Consumers',
      'Final',
    ];

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const label = phaseLabels[Math.min(i, phaseLabels.length - 1)];
      const ordinal = ordinalWord(i + 1);

      md.push(`### Phase ${i + 1}: ${label}`);
      md.push('');
      md.push(`**Repos:** ${phase.join(', ')}`);
      md.push('');

      if (i === 0) {
        md.push(
          `**Why first:** These repos have no dependencies on other workspace repos. Other repos depend on them.`,
        );
      } else if (i === phases.length - 1) {
        md.push(
          `**Why ${ordinal}:** Depends on APIs and types from earlier phases.`,
        );
      } else {
        const prevPhases = phases
          .slice(0, i)
          .flat()
          .join(', ');
        md.push(
          `**Why ${ordinal}:** Depends on Phase ${i === 1 ? '1' : `1–${i}`} repos (${prevPhases}). Build these before the consumers.`,
        );
      }

      md.push('');
    }

    // ── Dependency table ────────────────────────────────────────────────
    md.push('## Dependency Table');
    md.push('');
    md.push('| Repo | Depends On | Depended On By |');
    md.push('|:---|:---|:---|');

    // Sort repos by phase order for a natural reading experience
    const orderedNames = phases.flat();
    for (const name of orderedNames) {
      const node = graph.get(name)!;
      const deps = node.dependsOn.length > 0 ? node.dependsOn.join(', ') : '—';
      const rdeps =
        node.dependedOnBy.length > 0 ? node.dependedOnBy.join(', ') : '—';
      md.push(`| ${name} | ${deps} | ${rdeps} |`);
    }

    md.push('');

    // ── Write file ──────────────────────────────────────────────────────
    const outPath = path.join(workspacePath, 'nexusflow-plan.md');
    await fse.outputFile(outPath, md.join('\n'));
    console.log(chalk.green('  ✔'), 'Generated nexusflow-plan.md');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      chalk.red('  ✖'),
      `Failed to generate implementation plan: ${message}`,
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Add a directed edge: `from` depends on `to`.
 * Idempotent — duplicate edges are ignored.
 */
function addEdge(graph: DependencyGraph, from: string, to: string): void {
  const fromNode = graph.get(from);
  const toNode = graph.get(to);
  if (!fromNode || !toNode) return;

  if (!fromNode.dependsOn.includes(to)) {
    fromNode.dependsOn.push(to);
  }
  if (!toNode.dependedOnBy.includes(from)) {
    toNode.dependedOnBy.push(from);
  }
}

/**
 * Build a short single-letter alias map for Mermaid node IDs.
 * Falls back to sanitised names when there are more than 26 repos.
 */
function buildAliasMap(graph: DependencyGraph): Map<string, string> {
  const map = new Map<string, string>();
  const names = [...graph.keys()].sort();

  if (names.length <= 26) {
    let code = 65; // 'A'
    for (const name of names) {
      map.set(name, String.fromCharCode(code++));
    }
  } else {
    for (const name of names) {
      map.set(name, name.replace(/[^a-zA-Z0-9]/g, '_'));
    }
  }

  return map;
}

/** Return an ordinal word for small numbers, or "nth" for larger ones. */
function ordinalWord(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth'];
  if (n >= 1 && n <= words.length) return words[n - 1];
  return `${n}th`;
}
