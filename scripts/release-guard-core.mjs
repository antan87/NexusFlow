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
