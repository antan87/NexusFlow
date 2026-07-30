/**
 * @module generators/base
 * Builds the small markdown context every AI assistant generator starts from:
 * the task, the repos and how they relate, how to verify each one, and pointers
 * to everything else.
 */

import type { WorkspaceContext } from '../types.js';
import { findInterRepoDependencies } from '../analyzers/detect-deps.js';
import { isInPlace } from '../utils/feature.js';
import { getConventionalTestCommand } from '../utils/test-command.js';

/** How a repo relates to its siblings in this workspace. */
export interface RepoRelations {
  /** Workspace repos this one depends on. */
  dependsOn: string[];
  /** Workspace repos that depend on this one. */
  consumedBy: string[];
  /** The branch this repo is on. */
  branch?: string;
}

/**
 * Works out how each repo relates to its siblings.
 *
 * The data was already being computed — `findInterRepoDependencies` has existed
 * and been exported all along — it simply never reached the assistant-facing
 * context, which is the one place it matters most.
 */
function computeRepoRelations(ctx: WorkspaceContext): Map<string, RepoRelations> {
  const relations = new Map<string, RepoRelations>();
  const { repos, analysis, feature } = ctx;
  if (!analysis) return relations;

  const repoNames = new Map<string, string>();
  for (const repo of repos) repoNames.set(repo.path, repo.name);

  const dependsOn = findInterRepoDependencies(analysis, repoNames);

  // Invert it, so each repo can also state who would break if it changed.
  const consumedBy = new Map<string, string[]>();
  for (const [consumer, providers] of dependsOn) {
    for (const provider of providers) {
      consumedBy.set(provider, [...(consumedBy.get(provider) ?? []), consumer]);
    }
  }

  for (const repo of repos) {
    relations.set(repo.name, {
      dependsOn: dependsOn.get(repo.name) ?? [],
      consumedBy: consumedBy.get(repo.name) ?? [],
      branch: feature.repoBranches?.[repo.name] ?? repo.defaultBranch,
    });
  }

  return relations;
}

/**
 * Orders repos so anything depended upon comes before its consumers. Falls back
 * to the given order for anything a cycle makes unorderable, rather than
 * dropping it.
 *
 * Keyed on the repo objects, not their names. Two repos can share a basename —
 * `/org1/api` and `/org2/api` in an in-place workspace — and keying the visited
 * set by name collapsed them, so one was silently missing from the caller's
 * output. Dependencies are still resolved by name, which is all a manifest
 * gives, so an ambiguous name visits every repo bearing it.
 */
function orderReposByDependency<T extends { name: string }>(
  repos: T[],
  relations: Map<string, RepoRelations>,
): T[] {
  const placed = new Set<T>();
  const ordered: T[] = [];

  const byName = new Map<string, T[]>();
  for (const repo of repos) {
    const sameName = byName.get(repo.name);
    if (sameName) sameName.push(repo);
    else byName.set(repo.name, [repo]);
  }

  const visit = (repo: T, seen: Set<T>): void => {
    if (placed.has(repo) || seen.has(repo)) return;
    seen.add(repo);
    for (const dependency of relations.get(repo.name)?.dependsOn ?? []) {
      for (const target of byName.get(dependency) ?? []) visit(target, seen);
    }
    if (!placed.has(repo)) {
      placed.add(repo);
      ordered.push(repo);
    }
  };

  for (const repo of repos) visit(repo, new Set());
  // Every repo is placed by the loop above; this only guarantees the caller
  // never receives fewer rows than it passed in.
  for (const repo of repos) if (!placed.has(repo)) ordered.push(repo);

  return ordered;
}

/**
 * Builds the workspace context an assistant loads at session start.
 *
 * Kept deliberately small. It carries only what an assistant cannot cheaply
 * work out for itself, and links to the rest:
 *
 *  - what to build
 *  - where each repo is, and how the repos relate to each other
 *  - how to verify each repo
 *  - the one structural rule that is not inferable (worktree isolation)
 *
 * Everything else is a pointer. Per-repo language, framework, build tool, port
 * and purpose used to be listed here; two independent agents evaluating a
 * generated workspace used none of it — they needed code-level facts instead,
 * like a module's exports — while that same block is where a wrong claim
 * appeared ("Build tools: none detected" for a repo whose package.json has
 * "build": "tsc"). Anything derivable from a manifest is better read from the
 * manifest, where it cannot go stale.
 */
export async function buildContextContent(ctx: WorkspaceContext): Promise<string> {
  const { feature, repos, analysis } = ctx;
  const inPlace = isInPlace(feature);

  const relations = analysis && analysis.size > 0
    ? computeRepoRelations(ctx)
    : new Map<string, RepoRelations>();
  const ordered = orderReposByDependency(repos, relations);
  const hasRelations = [...relations.values()].some((r) => r.dependsOn.length > 0);

  // One row per repo: where it is, how to check it, and who it is tied to.
  const rows = ordered.map((repo) => {
    const a = analysis?.get(repo.path);
    const rel = relations.get(repo.name);
    const verify = a ? getConventionalTestCommand(a) : '';

    // In-place repos can each sit on a different branch, which is worth stating.
    // In worktree mode they are all on the feature branch named just below, so
    // repeating it per row would be noise.
    const branch = rel?.branch;
    const location = inPlace
      ? `${repo.path}${branch ? ` (on ${branch})` : ''}`
      : repo.name;

    const ties: string[] = [];
    if (rel?.dependsOn.length) ties.push(`needs ${rel.dependsOn.map((n) => '`' + n + '`').join(', ')}`);
    if (rel?.consumedBy.length) ties.push(`used by ${rel.consumedBy.map((n) => '`' + n + '`').join(', ')}`);

    return `| \`${repo.name}\` | \`${location}\` | ${verify ? '`' + verify + '`' : '—'} | ${ties.join('; ') || '—'} |`;
  });

  const startHint = hasRelations && ordered.length > 1 && ordered[0]
    ? `\n\nStart with \`${ordered[0].name}\` — the others build on it.`
    : '';

  // Only the rule an assistant cannot infer. Which directory to run a command
  // in, and how git works, are not worth the tokens.
  const structureRule = inPlace
    ? 'These are the original repositories, on whatever branch each has checked out — NexusFlow does not manage branches here, so check before you commit.'
    : `Each repo above is a separate git worktree on \`${feature.branchName}\`. **Do not edit the original repositories elsewhere on disk** — that is a different checkout and changes there are not part of this feature.`;

  // Repos that already ship their own assistant instructions; those override
  // anything here for that repo, so it is worth naming them.
  const existing = analysis
    ? [...analysis.values()]
      .filter((a) => a.existingAIConfigs.length > 0)
      .map((a) => `\`${a.name}\` (${a.existingAIConfigs.map((c) => c.relativePath).join(', ')})`)
    : [];

  const teamwork = feature.teamworkInstructions
    ? `\n## How to work together\n\n${feature.teamworkInstructions}\n`
    : '';

  const ownInstructions = existing.length > 0
    ? `- These repos carry their own assistant instructions, which take precedence inside them: ${existing.join(', ')}\n`
    : '';

  return `# ${feature.id}

${feature.description}

## Repos

| Repo | ${inPlace ? 'Path' : 'Directory'} | Verify | Cross-repo |
|---|---|---|---|
${rows.join('\n')}

${structureRule}${startHint}

## Where to look

- \`nexusflow-knowledge.md\` — decisions and gotchas from earlier sessions, one per \`###\` heading. It grows every session and is often long, so search the headings for your topic and read only those entries, not the whole file. Add with \`nexusflow knowledge add -t decision|gotcha -m "..."\`, keeping each entry to a rule and its reason
- \`nexusflow-plan.md\` — phase order when a change spans repos
${ownInstructions}${teamwork}`;
}
