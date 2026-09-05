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
import { renderFreshnessBanner } from '../core/generation-lock.js';

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

  // One row per repo: where it is, how to check it, and who it is tied to.
  const rows = ordered.map((repo) => {
    const a = analysis?.get(repo.path);
    const rel = relations.get(repo.name);
    const verify = a ? getConventionalTestCommand(a) : '';

    // In-place repos can each sit on a different branch, which is worth stating.
    // Repos dynamically isolated into dedicated worktrees show their worktree path.
    // In worktree mode they are all on the feature branch named just below, so
    // repeating it per row would be noise.
    const isIsolated = inPlace && Boolean(feature.isolatedRepos?.[repo.name] ?? feature.isolatedRepos?.[repo.path]);
    const isolated = feature.isolatedRepos?.[repo.name] ?? feature.isolatedRepos?.[repo.path];
    const branch = rel?.branch ?? (isolated ? isolated.branchName : undefined);
    const location = inPlace
      ? (isIsolated
          ? `\`${isolated!.worktreePath}\` *(on ${branch ?? 'feature branch'} [isolated worktree])*`
          : `\`${repo.path}\`${branch ? ` (on ${branch})` : ''}`)
      : `\`${repo.name}\``;

    const ties: string[] = [];
    if (rel?.dependsOn.length) ties.push(`needs ${rel.dependsOn.map((n) => '`' + n + '`').join(', ')}`);
    if (rel?.consumedBy.length) ties.push(`used by ${rel.consumedBy.map((n) => '`' + n + '`').join(', ')}`);

    return `| \`${repo.name}\` | ${location} | ${verify ? '`' + verify + '`' : '—'} | ${ties.join('; ') || '—'} |`;
  });

  // The earliest repo something actually builds on — and it names what. The
  // previous test was "does any repo anywhere have a dependency", which pointed
  // at `ordered[0]` regardless: a workspace of [alpha (independent), lib, web]
  // where only web needs lib produced "Start with `alpha` — the others build on
  // it" directly above alpha's own row showing no ties at all. Since `ordered` is
  // already dependency-ordered, the first entry with consumers is the real
  // starting point, and if nothing has consumers there is no order to give.
  const startsWith = ordered.find((repo) => (relations.get(repo.name)?.consumedBy.length ?? 0) > 0);
  const consumers = startsWith ? relations.get(startsWith.name)!.consumedBy : [];
  const startHint = startsWith
    ? `\n\nStart with \`${startsWith.name}\` — ${consumers.map((n) => '`' + n + '`').join(', ')} ${consumers.length === 1 ? 'builds' : 'build'} on it.`
    : '';

  // Only the rule an assistant cannot infer. Which directory to run a command
  // in, and how git works, are not worth the tokens.
  const hasIsolated = inPlace && Boolean(feature.isolatedRepos && Object.keys(feature.isolatedRepos).length > 0);
  const structureRule = inPlace
    ? (hasIsolated
        ? '**RULE**: Repos marked `[isolated worktree]` MUST be edited inside their dedicated worktree path. Unisolated repos are in READ-ONLY reference mode: before modifying files in any unisolated repository, you MUST invoke the `isolate_repo` MCP tool (or run `nexusflow isolate <repo>`).'
        : '**RULE**: These repositories are in READ-ONLY reference mode on host branches. Before making ANY file modifications, you MUST invoke the `isolate_repo` MCP tool (or run `nexusflow isolate <repo>`) to create a dedicated feature worktree.')
    : `Each repo above is a separate git worktree on \`${feature.branchName}\`. **Do not edit the original repositories elsewhere on disk** — that is a different checkout and changes there are not part of this feature.`;

  // Repos that already ship their own assistant instructions; those override
  // anything here for that repo, so it is worth naming them. Walked via `repos`
  // rather than the analysis map, so an analysis entry for a repo that is not in
  // this workspace cannot put a name in the list — the same scoping the plan's
  // contract table needed.
  const existing = ordered
    .map((repo) => analysis?.get(repo.path))
    .filter((a): a is NonNullable<typeof a> => !!a && a.existingAIConfigs.length > 0)
    .map((a) => `\`${a.name}\` (${a.existingAIConfigs.map((c) => c.relativePath).join(', ')})`);

  const teamwork = feature.teamworkInstructions
    ? `\n## How to work together\n\n${feature.teamworkInstructions}\n`
    : '';

  const ownInstructions = existing.length > 0
    ? `- These repos carry their own assistant instructions, which take precedence inside them: ${existing.join(', ')}\n`
    : '';

  // Commands the person who created this workspace typed in by hand. Exactly the
  // kind of thing an assistant cannot derive: a mock/seed step, a non-standard
  // start command, a test command that differs from the convention. The API still
  // accepts and persists these, and for a while nothing read them — deleting the
  // only reader as "dead code" silently dropped them from every generated file.
  const custom: string[] = [];
  if (feature.resumption?.testCommand) custom.push(`- Verify with \`${feature.resumption.testCommand}\` — this overrides the per-repo commands above.`);
  if (feature.resumption?.mockCommand) custom.push(`- Set up dependencies first with \`${feature.resumption.mockCommand}\`.`);
  if (feature.resumption?.startCommand) custom.push(`- Start the services with \`${feature.resumption.startCommand}\`.`);
  const customCommands = custom.length > 0
    ? `\n## Commands recorded for this workspace\n\nThese were entered by hand and are not derivable from any manifest.\n\n${custom.join('\n')}\n`
    : '';

  // A table header over no rows, followed by "Each repo above is a separate git
  // worktree", describes nothing. `create` should never produce this, but the
  // writer had no guard, so say the true thing instead.
  const reposSection = rows.length > 0
    ? `## Repos

| Repo | ${inPlace ? 'Path' : 'Directory'} | Verify | Cross-repo |
|---|---|---|---|
${rows.join('\n')}

${structureRule}${startHint}`
    : `This workspace has no repositories yet — add one with \`nexusflow add-repo\`.`;

  const freshness = ctx.generation ? `${renderFreshnessBanner(ctx.generation)}\n\n` : '';

  return `${freshness}# ${feature.id}

${feature.description}

${reposSection}

## Where to look

- \`nexusflow-knowledge.md\` — decisions and gotchas from earlier sessions, one per \`###\` heading. Use MCP \`search_knowledge\` for fast lookup or search headings for your topic and read only those entries, not the whole file. Add with \`nexusflow knowledge add -t decision|gotcha --title "..." -m "..."\`, keeping each entry to a rule and its reason
- \`nexusflow-plan.md\` — cross-repo package merge order only; runtime and intra-repo contracts are represented by scoped knowledge entries
- \`.agents/skills/\` — procedural playbooks and specialized skills for this workspace (also mirrored to \`.codex/skills/\`, \`.claude/skills/\`, \`.github/skills/\`, \`.cursor/skills/\` where supported)
- Cross-harness collaboration — Use MCP \`read_workroom_stream\` and \`post_workroom_handoff\` to coordinate plans and handoffs across AI agents
${ownInstructions}${customCommands}${teamwork}`;
}
