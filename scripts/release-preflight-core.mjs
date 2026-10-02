// Pure go/no-go decision for dispatching a release. The CLI wrapper
// (release-preflight.mjs) reads git and GitHub; this module only decides, so
// every rule is unit-testable.

import { evaluateVersionOrder, parseVersion } from './release-guard-core.mjs';

/** Workflow-run statuses that mean a release still holds the release lane. */
const IN_FLIGHT = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

/**
 * Decide whether it is safe to dispatch `version` from `tipSha`.
 *
 * - mainVersion: package.json version at the tip of the default branch
 * - tags: existing release tags, as parsed by parseRemoteTags
 * - runs: recent release.yml runs ({ databaseId, status, headSha, createdAt })
 * - releaseExists: whether a GitHub Release already exists for the tag
 * - checks: { ok, problems } from the release guard's required-check evaluation
 * - rerun: the caller deliberately wants to finish a partial release
 *
 * Reports every problem, not only the first, so one run tells the whole story.
 */
export function evaluatePreflight({ version, mainVersion, tipSha, tags, runs, releaseExists, checks, rerun = false }) {
  const problems = [];
  const notes = [];

  if (!parseVersion(version)) {
    problems.push(`"${version ?? ''}" is not a release version (expected X.Y.Z or X.Y.Z-prerelease).`);
  } else {
    if (mainVersion !== version) {
      problems.push(
        `package.json on the default branch is ${mainVersion ?? '(unreadable)'}, not ${version}. Merge a synchronized version bump first.`,
      );
    }
    problems.push(...evaluateVersionOrder({ version, tags }).problems);

    const tagged = tags.find((tag) => tag.version === version);
    if (tagged && tagged.sha !== tipSha) {
      problems.push(`v${version} is already tagged at ${tagged.sha}, not at ${tipSha}; a release tag is never moved. Bump the version to release newer commits.`);
    } else if (tagged && releaseExists && !rerun) {
      problems.push(
        `v${version} is already released from this commit. Use --rerun only to finish a partial release, such as a Marketplace retry.`,
      );
    } else if (tagged && releaseExists) {
      notes.push(`v${version} is already released; --rerun was given, so this only completes a partial release.`);
    } else if (tagged) {
      notes.push(`v${version} is tagged but has no GitHub Release, so an earlier run did not finish and a re-run is appropriate.`);
    }
  }

  for (const run of runs.filter((r) => IN_FLIGHT.has(r.status))) {
    problems.push(
      `Release run ${run.databaseId} is ${run.status} (commit ${String(run.headSha).slice(0, 7)}, started ${run.createdAt}). `
        + 'Only one release runs at a time and a newer pending dispatch replaces an older pending one; '
        + 'wait for it, or ask the owner to approve or cancel it.',
    );
  }

  if (!checks.ok) {
    problems.push(...checks.problems.map((problem) => `Required checks on ${tipSha}: ${problem}`));
  }

  return { ok: problems.length === 0, problems, notes };
}

/** The exact dispatch to run once the preflight passes, pinned to the verified commit. */
export function dispatchCommand({ version, tipSha }) {
  return `gh workflow run release.yml -f version=${version} -f expected_sha=${tipSha}`;
}
