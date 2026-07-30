/**
 * @module plan-generator
 * Analyzes inter-repo dependencies within a workspace and generates a
 * `nexusflow-plan.md` implementation plan with build-order phases.
 */

import path from 'node:path';
import fse from 'fs-extra';
import chalk from 'chalk';
import { writeWorkspaceFile } from '../core/storage.js';
import type {
  WorkspaceContext,
  ProjectAnalysis,
  RepoInfo,
  DependencyNode,
  DependencyGraph,
} from '../types.js';

// ─── Dependency Graph Builder ─────────────────────────────────────────────

/**
 * Build a dependency graph by analysing package dependencies
 * across the workspace repos.
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

  // ── 1. Produced/consumed package dependencies ──────────────────────────
  // Map each produced package name to the repo name that produces it
  const packageToRepo = new Map<string, string>();
  for (const repo of repos) {
    const a = analysisByName.get(repo.name);
    if (!a) continue;

    // Map the repo name itself as a produced product (for direct matching)
    packageToRepo.set(repo.name.toLowerCase(), repo.name);

    if (a.produces) {
      for (const product of a.produces) {
        packageToRepo.set(product.name.toLowerCase(), repo.name);
        // Map basename (e.g. Hogia.EmploymentService.Client -> Client)
        const base = product.name.split('.').pop() ?? product.name;
        if (base && base.length > 3) {
          packageToRepo.set(base.toLowerCase(), repo.name);
        }
      }
    }
  }

  for (const repo of repos) {
    const a = analysisByName.get(repo.name);
    if (!a) continue;

    // Guarded: an analysis without a dependency list threw here, and the
    // caller's catch swallowed it, so the plan file was never written at all.
    for (const dep of a.dependencies ?? []) {
      const depNameLower = dep.name.toLowerCase();

      // Direct match with a produced package
      if (packageToRepo.has(depNameLower)) {
        const targetRepo = packageToRepo.get(depNameLower)!;
        if (targetRepo !== repo.name) {
          addEdge(graph, repo.name, targetRepo);
        }
      }
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
 * - A package relations table
 * - Actionable local dev tips
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
      await writeWorkspaceFile(
        workspacePath,
        feature.id,
        'nexusflow-plan.md',
        lines.join('\n'),
      );
      console.log(chalk.green('  ✔'), 'Generated nexusflow-plan.md');
      return;
    }

    // ── Build graph & sort ──────────────────────────────────────────────
    const graph = buildDependencyGraph(analysis, repos);
    const phases = topologicalSort(graph);

    // ── What this plan can actually say ─────────────────────────────────
    // Everything below describes cross-repo structure. With no dependency edges
    // and no shared packages there is nothing to order, and this file used to
    // say so five separate ways: a single-node diagram, a phase whose rationale
    // claimed "other repos depend on them" when none did, an all-dashes table,
    // a contracts table of packages nobody consumed, and a local-package loop
    // for packages with no consumers. One honest sentence replaces all of it.
    const hasEdges = [...graph.values()].some((n) => n.dependsOn.length > 0);
    // Restricted to the repos the graph was built from. Derived from the whole
    // analysis map, a stray entry could produce contracts with no matching edge,
    // so the file promised a phase order it then never printed.
    const contracts = findPackageRelations(analysis, repos).filter((rel) => rel.consumers.length > 0);

    /** Repos in this phase that depend on another repo in the same phase. */
    const cycleMembers = (phase: string[]): string[] => {
      const inPhase = new Set(phase);
      return phase.filter((name) =>
        (graph.get(name)?.dependsOn ?? []).some((dep) => inPhase.has(dep)),
      );
    };

    const md: string[] = [];

    md.push(`# Implementation Plan — ${feature.id}`);
    md.push('');
    md.push(`> **Generated At**: ${new Date().toISOString()} (UTC)`);
    md.push(`> **Regeneration Command**: Run \`nexusflow refresh\` to update this plan.`);
    md.push('');

    if (!hasEdges && contracts.length === 0) {
      const subject = repos.length === 1 ? 'the single repo' : `the ${repos.length} repos`;
      md.push(
        `No package dependencies were detected between ${subject} in this workspace, so no build order is forced — work in whichever order suits the task.`,
      );
      md.push('');
      md.push(
        'If you add a dependency from one of these repos to another, run `nexusflow refresh` and this plan will describe the resulting order.',
      );
      md.push('');
      await writeWorkspaceFile(workspacePath, feature.id, 'nexusflow-plan.md', md.join('\n'));
      console.log(chalk.green('  ✔'), 'Generated nexusflow-plan.md');
      return;
    }

    md.push(
      '> Auto-generated by NexusFlow based on dependency analysis between repos.',
    );
    md.push(
      '> Follow the phase order to avoid blocking yourself on cross-repo dependencies.',
    );
    md.push('');

    if (hasEdges) {
      // ── Mermaid diagram ───────────────────────────────────────────────
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
      md.push('> ⚠️ This diagram is derived from detected package dependencies (`package.json`, `.csproj`, etc.) only.');
      md.push('> If you changed a package, the producing repo must release/build before consumer repos can merge.');
      md.push('');

      // ── Phase descriptions ────────────────────────────────────────────
      md.push('## Suggested Implementation Order');
      md.push('');

      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;
        const ordinal = ordinalWord(i + 1);

        md.push(`### Phase ${i + 1}`);
        md.push('');
        md.push(`**Repos:** ${phase.join(', ')}`);
        md.push('');

        // A phase containing repos that depend on each other came from the cycle
        // fallback in topologicalSort, not from a resolved ordering. Saying so
        // beats the positional rationale, which asserted "no dependencies on
        // other workspace repos" about repos that plainly had them.
        const cyclic = cycleMembers(phase);
        if (cyclic.length > 0) {
          md.push(
            `**Cycle:** ${cyclic.join(', ')} depend on each other, so no build order resolves this phase — break the cycle before relying on this plan.`,
          );
        } else if (i === 0) {
          // Only claim downstream consumers for the repos that actually have
          // them. The old wording asserted it for every phase-1 repo.
          const consumed = phase.filter((name) => (graph.get(name)?.dependedOnBy.length ?? 0) > 0);
          md.push(
            consumed.length > 0
              ? `**Why first:** No dependencies on other workspace repos, and ${consumed.join(', ')} ${consumed.length === 1 ? 'is' : 'are'} depended on by a later phase.`
              : '**Why first:** No dependencies on other workspace repos.',
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

      // ── Dependency table ──────────────────────────────────────────────
      md.push('## Dependency Table');
      md.push('');
      md.push('| Repo | Depends On | Depended On By |');
      md.push('|:---|:---|:---|');

      // Sort repos by phase order for a natural reading experience
      for (const name of phases.flat()) {
        const node = graph.get(name)!;
        const deps = node.dependsOn.length > 0 ? node.dependsOn.join(', ') : '—';
        const rdeps =
          node.dependedOnBy.length > 0 ? node.dependedOnBy.join(', ') : '—';
        md.push(`| ${name} | ${deps} | ${rdeps} |`);
      }

      md.push('');
    }

    // ── Contracts & Clients ─────────────────────────────────────────────
    // Only packages a sibling repo actually consumes. A published package with
    // no workspace consumer is not a cross-repo contract, and rendering it with
    // "_None_" in the consumers column was the largest block of the old file.
    if (contracts.length > 0) {
      const anyContributing = contracts.some((c) => (c.contributing?.length ?? 0) > 0);

      md.push('## 📦 Contracts & Clients');
      md.push('');
      md.push(
        anyContributing
          ? '| Package | Contributing Projects | Producing Repo | Consuming Repos (Version) | Feed Source | Type |'
          : '| Package | Producing Repo | Consuming Repos (Version) | Feed Source | Type |',
      );
      md.push(anyContributing ? '|:---|:---|:---|:---|:---|:---|' : '|:---|:---|:---|:---|:---|');

      for (const rel of contracts) {
        const cells = [`\`${rel.pkgName}\``];
        if (anyContributing) {
          cells.push(
            rel.contributing && rel.contributing.length > 0
              ? rel.contributing.map((c) => `\`${c}\``).join(', ')
              : '—',
          );
        }
        cells.push(`\`${rel.producer}\``);
        cells.push(rel.consumers.map((c) => `\`${c.repoName}\` (${c.version || 'pinned'})`).join(', '));
        cells.push(
          rel.feeds && rel.feeds.length > 0
            ? rel.feeds.map((f) => `\`${f.name}\` (${f.url})`).join('<br>')
            : '—',
        );
        cells.push(`\`${rel.type}\``);
        md.push(`| ${cells.join(' | ')} |`);
      }
      md.push('');

      // ── Local Package Development Loop ────────────────────────────────
      // Gated on a shared package existing at all, and on the ecosystems those
      // packages actually use. It used to emit both branches whenever the
      // workspace merely contained the language, so a TypeScript-only workspace
      // carried four .NET/NuGet steps — 47% of the plan, none of it applicable.
      const types = new Set(contracts.map((c) => c.type));

      md.push('## 💡 Local Package Development Loop');
      md.push('');
      md.push('When changing a shared package, verify its consumers against a local build before pushing:');
      md.push('');

      if (types.has('nuget')) {
        md.push('### .NET / NuGet');
        md.push('1. `dotnet pack -c Release -o ./local-packages` in the producing project.');
        md.push('2. Point a local feed in the consumer\'s `NuGet.config` at `./local-packages`.');
        md.push('3. Reference a local version (e.g. `3.41.0-local`) in the consuming `.csproj`.');
        md.push('4. **Revert the version reference to the official release before merging.**');
        md.push('');
      }

      if (types.has('npm')) {
        md.push('### Node.js / npm');
        md.push('1. `npm link` in the producing package, then `npm link <package-name>` in the consumer.');
        md.push('2. **Unlink and reinstall the published version before committing.**');
        md.push('');
      }
    }

    // ── Write file ──────────────────────────────────────────────────────
    await writeWorkspaceFile(workspacePath, feature.id, 'nexusflow-plan.md', md.join('\n'));
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

/** A package one repo publishes, with whichever sibling repos consume it. */
interface PackageRelation {
  pkgName: string;
  contributing?: string[];
  producer: string;
  consumers: { repoName: string; version?: string }[];
  type: 'npm' | 'nuget' | 'other';
  feeds?: { name: string; url: string }[];
}

/**
 * Pairs every produced package with the workspace repos that depend on it.
 *
 * Restricted to `repos` so this agrees with {@link buildDependencyGraph}, which
 * also walks only those: derived from the whole analysis map, the two could
 * disagree and the plan would claim a phase order it never printed.
 *
 * Consumers may be empty — the caller decides whether a package with no
 * workspace consumer is worth reporting.
 */
function findPackageRelations(
  analysis: Map<string, ProjectAnalysis>,
  repos: RepoInfo[],
): PackageRelation[] {
  const inScope: [string, ProjectAnalysis][] = [];
  for (const repo of repos) {
    const a = analysis.get(repo.path);
    if (a) inScope.push([repo.path, a]);
  }

  const relations: PackageRelation[] = [];

  for (const [repoPath, a] of inScope) {
    for (const product of a.produces ?? []) {
      const consumers: { repoName: string; version?: string }[] = [];
      for (const [otherPath, otherA] of inScope) {
        if (otherPath === repoPath) continue;
        for (const dep of otherA.dependencies ?? []) {
          if (dep.name.toLowerCase() === product.name.toLowerCase()) {
            consumers.push({ repoName: otherA.name, version: dep.version });
          }
        }
      }
      relations.push({
        pkgName: product.name,
        contributing: product.contributing,
        producer: a.name,
        consumers,
        type: product.type,
        feeds: a.nugetFeeds,
      });
    }
  }

  return relations;
}

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
