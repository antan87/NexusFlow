// Pure release-gate decisions. The CLI wrapper (release-guard.mjs) fetches the
// inputs; keeping this module dependency-free lets the release guard run before
// `npm ci` and keeps every decision unit-testable.

/** A release may only run from the repository default branch. */
export function evaluateDispatchRef({ ref, defaultBranch }) {
  if (!defaultBranch) {
    return { ok: false, problems: ['The repository default branch is unknown; refusing to release.'] };
  }
  const expected = `refs/heads/${defaultBranch}`;
  if (ref !== expected) {
    return {
      ok: false,
      problems: [`Release was dispatched from ${ref || '(no ref)'}; only ${expected} may release.`],
    };
  }
  return { ok: true, problems: [] };
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const FULL_SHA = /^[0-9a-f]{40}$/i;

/** Parse `X.Y.Z[-pre]` (no leading `v`); null when it is not a release version. */
export function parseVersion(text) {
  const match = SEMVER.exec(String(text ?? ''));
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Semver precedence: negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1;
  }
  // A version without a prerelease outranks the same core with one.
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let i = 0; i < length; i += 1) {
    const left = a.pre[i];
    const right = b.pre[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1;
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Read the release tags from `git ls-remote --tags --refs` output. Tags that are
 * not `vX.Y.Z[-pre]` are ignored, so a stray tag cannot block or unblock a release.
 */
export function parseRemoteTags(text) {
  const tags = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^([0-9a-f]{40})\s+refs\/tags\/v(\S+)$/i.exec(line.trim());
    if (match && parseVersion(match[2])) tags.push({ sha: match[1], version: match[2] });
  }
  return tags;
}

/**
 * Releases must move forward: refuse a version lower than any existing release
 * tag. Several agents can prepare releases at once, and a stale one publishing
 * after a newer release would move npm's `latest` back. The same version is
 * allowed so a partially published release can be re-run; the tag step refuses
 * to move an existing tag.
 */
export function evaluateVersionOrder({ version, tags }) {
  const requested = parseVersion(version);
  if (!requested) {
    return { ok: false, problems: [`"${version ?? ''}" is not a release version (expected X.Y.Z or X.Y.Z-prerelease).`] };
  }
  const newer = tags
    .filter((tag) => compareVersions(requested, parseVersion(tag.version)) < 0)
    .sort((a, b) => compareVersions(parseVersion(b.version), parseVersion(a.version)));
  if (newer.length === 0) return { ok: true, problems: [] };
  return {
    ok: false,
    problems: [
      `v${newer[0].version} is already tagged and is newer than ${version}; releases must move forward. `
        + 'Bump the version above every existing release tag and dispatch that instead.',
    ],
  };
}

/**
 * The dispatch loads the tip of the default branch. When the dispatcher pinned
 * the commit it verified, refuse to release a different one: another merge may
 * have landed in between.
 */
export function evaluateExpectedSha({ expected, actual }) {
  if (!expected) return { ok: true, problems: [] };
  if (!FULL_SHA.test(expected)) {
    return { ok: false, problems: ['expected_sha must be a full 40-character commit SHA.'] };
  }
  if (String(actual ?? '').toLowerCase() !== expected.toLowerCase()) {
    return {
      ok: false,
      problems: [
        `The release was pinned to ${expected} but the default branch is at ${actual || '(unknown)'}. `
          + 'Verify the new head and dispatch again.',
      ],
    };
  }
  return { ok: true, problems: [] };
}

/**
 * Decide whether every required check succeeded on exactly `sha`.
 *
 * Fails closed: a required check that is missing, still running, produced by a
 * different app, recorded for a different SHA, or concluded with anything other
 * than `success` (including skipped, neutral, cancelled and stale) blocks the
 * release. When a check was re-run, the most recent run decides.
 */
export function evaluateRequiredChecks({ sha, required, app, checkRuns }) {
  const problems = [];
  if (!sha) problems.push('No source SHA was supplied.');
  if (!Array.isArray(required) || required.length === 0) {
    problems.push('The required check list is empty; refusing to release without verification evidence.');
  }
  if (!Array.isArray(checkRuns)) problems.push('Check run evidence could not be read.');
  if (problems.length > 0) return { ok: false, problems, results: [] };

  const results = required.map((name) => {
    const candidates = checkRuns.filter((run) => run?.name === name);
    const trusted = candidates.filter((run) => !app || run.app?.slug === app);
    const forSha = trusted.filter((run) => run.head_sha === sha);

    if (candidates.length === 0) return { name, ok: false, reason: 'missing' };
    if (trusted.length === 0) return { name, ok: false, reason: `not reported by ${app}` };
    if (forSha.length === 0) return { name, ok: false, reason: 'no result for this exact SHA' };

    const latest = forSha.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
    if (latest.status !== 'completed') return { name, ok: false, reason: `still ${latest.status ?? 'unknown'}` };
    if (latest.conclusion !== 'success') return { name, ok: false, reason: latest.conclusion ?? 'no conclusion' };
    return { name, ok: true, reason: 'success', url: latest.html_url };
  });

  for (const result of results) {
    if (!result.ok) problems.push(`${result.name}: ${result.reason}`);
  }
  return { ok: problems.length === 0, problems, results };
}

/**
 * Derive the check-run names GitHub Actions reports for parsed workflow files.
 * Used to keep the required check list in lockstep with the workflows. Throws on
 * shapes whose names cannot be derived statically, and on conditional jobs,
 * because a skipped required check can never let a release pass.
 */
export function expectedCheckNames(workflows) {
  const names = [];
  for (const { path, workflow } of workflows) {
    for (const [jobId, job] of Object.entries(workflow?.jobs ?? {})) {
      const base = job.name ?? jobId;
      if (String(base).includes('${{')) {
        throw new Error(`${path}: job ${jobId} has an expression in its name; required check names must be static.`);
      }
      if (job.if !== undefined) {
        throw new Error(`${path}: job ${jobId} is conditional; a skipped required check would block every release.`);
      }
      const combos = expandMatrix(job.strategy?.matrix, `${path}: job ${jobId}`);
      if (combos === null) {
        names.push(String(base));
      } else {
        for (const values of combos) names.push(`${base} (${values.join(', ')})`);
      }
    }
  }
  return names;
}

function expandMatrix(matrix, label) {
  if (matrix === undefined) return null;
  if (typeof matrix !== 'object' || matrix === null || Array.isArray(matrix)) {
    throw new Error(`${label}: matrix must be a static mapping.`);
  }
  if (matrix.exclude !== undefined) {
    throw new Error(`${label}: matrix exclude is not supported by the required-check derivation.`);
  }
  const axes = Object.entries(matrix).filter(([key]) => key !== 'include');
  const include = matrix.include;

  if (axes.length > 0 && include !== undefined) {
    throw new Error(`${label}: matrix axes combined with include are not supported by the required-check derivation.`);
  }
  if (axes.length === 0) {
    if (!Array.isArray(include) || include.length === 0) {
      throw new Error(`${label}: matrix has no axes or include entries.`);
    }
    return include.map((entry) => Object.values(entry).map((value) => scalar(value, label)));
  }

  let combos = [[]];
  for (const [key, values] of axes) {
    if (!Array.isArray(values)) throw new Error(`${label}: matrix axis ${key} must be a static list.`);
    combos = combos.flatMap((prefix) => values.map((value) => [...prefix, scalar(value, label)]));
  }
  return combos;
}

function scalar(value, label) {
  if (value === null || typeof value === 'object') {
    throw new Error(`${label}: matrix values must be scalars.`);
  }
  const text = String(value);
  if (text.includes('${{')) throw new Error(`${label}: matrix values must be static.`);
  return text;
}
