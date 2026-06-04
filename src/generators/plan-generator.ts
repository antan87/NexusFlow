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

    for (const dep of a.dependencies) {
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
    md.push('> ⚠️ This diagram is derived from detected package dependencies (`package.json`, `.csproj`, etc.) only.');
    md.push('> If you changed a package, the producing repo must release/build before consumer repos can merge.');
    md.push('');

    // ── Phase descriptions ──────────────────────────────────────────────
    md.push('## Suggested Implementation Order');
    md.push('');

    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const ordinal = ordinalWord(i + 1);

      md.push(`### Phase ${i + 1}`);
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

    // ── Contracts & Clients Table ───────────────────────────────────────
    md.push('## 📦 Contracts & Clients');
    md.push('');
    md.push('| Package | Contributing Projects | Producing Repo | Consuming Repos (Version) | Feed Source | Type |');
    md.push('|:---|:---|:---|:---|:---|:---|');

    // Build package relations
    interface PackageRelation {
      pkgName: string;
      contributing?: string[];
      producer: string;
      consumers: { repoName: string; version?: string }[];
      type: 'npm' | 'nuget' | 'other';
      feeds?: { name: string; url: string }[];
    }

    const packageRelations: PackageRelation[] = [];

    // Find all produced packages
    for (const [repoPath, a] of analysis) {
      if (a.produces) {
        for (const product of a.produces) {
          // Find consumers
          const consumers: { repoName: string; version?: string }[] = [];
          for (const [otherPath, otherA] of analysis) {
            if (otherPath === repoPath) continue;
            for (const dep of otherA.dependencies) {
              if (dep.name.toLowerCase() === product.name.toLowerCase()) {
                consumers.push({ repoName: otherA.name, version: dep.version });
              }
            }
          }
          packageRelations.push({
            pkgName: product.name,
            contributing: (product as any).contributing,
            producer: a.name,
            consumers,
            type: product.type,
            feeds: a.nugetFeeds,
          });
        }
      }
    }

    if (packageRelations.length > 0) {
      for (const rel of packageRelations) {
        const contribStr = rel.contributing && rel.contributing.length > 0
          ? rel.contributing.map(c => `\`${c}\``).join(', ')
          : '—';
        const consumerStr = rel.consumers.length > 0
          ? rel.consumers.map(c => `\`${c.repoName}\` (${c.version || 'pinned'})`).join(', ')
          : '_None_';
        const feedStr = rel.feeds && rel.feeds.length > 0
          ? rel.feeds.map(f => `\`${f.name}\` (${f.url})`).join('<br>')
          : '—';
        md.push(`| \`${rel.pkgName}\` | ${contribStr} | \`${rel.producer}\` | ${consumerStr} | ${feedStr} | \`${rel.type}\` |`);
      }
    } else {
      md.push('| _No package relations detected_ | | | | | |');
    }
    md.push('');

    // ── Cross-Repo Messaging Roll-up ────────────────────────────────────
    md.push('## 📨 Cross-Repo Messaging');
    md.push('');
    md.push('| Publisher Repo | Message | → Subscriber Repo | Handler |');
    md.push('|---|---|---|---|');

    interface CrossRepoMessage {
      pubRepo: string;
      message: string;
      subRepo: string;
      handler: string;
    }
    const crossRepoMessages: CrossRepoMessage[] = [];

    for (const [pubPath, pubA] of analysis) {
      if (!pubA.messaging || !pubA.messaging.publishers) continue;
      for (const pub of pubA.messaging.publishers) {
        // Find subscribers in other repos matching this contract type
        for (const [subPath, subA] of analysis) {
          if (subPath === pubPath) continue;
          if (!subA.messaging || !subA.messaging.subscribers) continue;
          for (const sub of subA.messaging.subscribers) {
            const pubContract = pub.contractType.toLowerCase().trim();
            const subContract = sub.contractType.toLowerCase().trim();
            if (pubContract === subContract && pubContract !== 'goservicebusmessage' && pubContract !== 'servicebusmessage') {
              crossRepoMessages.push({
                pubRepo: pubA.name,
                message: pub.contractType,
                subRepo: subA.name,
                handler: sub.handlerFile,
              });
            }
          }
        }
      }
    }

    if (crossRepoMessages.length > 0) {
      for (const m of crossRepoMessages) {
        md.push(`| \`${m.pubRepo}\` | \`${m.message}\` | \`${m.subRepo}\` | \`${m.handler}\` |`);
      }
    } else {
      md.push('| _No cross-repo messaging detected_ | | | |');
    }
    md.push('');

    // ── Local Package Development Loop Tip ──────────────────────────────
    md.push('## 💡 Local Package Development Loop');
    md.push('');
    md.push('When making changes to a shared contract or client library package, follow this standard local feed loop to test and verify consumers before pushing:');
    md.push('');
    md.push('### For .NET / NuGet packages:');
    md.push('1. **Pack locally**: Run `dotnet pack -c Release -o ./local-packages` inside the producing project folder.');
    md.push('2. **Add local feed**: Configure a local feed in your consumer project\'s `NuGet.config` pointing to the `./local-packages` directory.');
    md.push('3. **Reference local version**: Reference the package with a local development version (e.g. `3.41.0-local`) in the consuming `.csproj`.');
    md.push('4. **Revert before merging**: Verify changes compile and tests pass, then **revert** the consuming project\'s package version reference to the official release before merging to master.');
    md.push('');
    md.push('### For Node.js / npm packages:');
    md.push('1. **Link locally**: Run `npm link` inside the producing package folder.');
    md.push('2. **Use link**: Run `npm link <package-name>` inside the consuming folder to link it.');
    md.push('3. **Revert before merging**: Uninstall the linked package and install the official package version before committing.');
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
