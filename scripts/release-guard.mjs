#!/usr/bin/env node
// Release gate used by .github/workflows/release.yml. Runs before `npm ci`, so it
// must only use Node built-ins.
//
//   node scripts/release-guard.mjs ref --ref <ref> --default-branch <branch>
//   node scripts/release-guard.mjs checks --sha <sha> --repo <owner/name> [--config <path>]
//
// `checks` reads GH_TOKEN (or GITHUB_TOKEN) and fails closed when the check-run
// evidence cannot be fetched completely.

import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { evaluateDispatchRef, evaluateRequiredChecks } from './release-guard-core.mjs';

const DEFAULT_CONFIG = '.github/release-required-checks.json';
const MAX_PAGES = 20;

const [command, ...rest] = process.argv.slice(2);
const { values: args } = parseArgs({
  args: rest,
  options: {
    ref: { type: 'string' },
    'default-branch': { type: 'string' },
    sha: { type: 'string' },
    repo: { type: 'string' },
    config: { type: 'string', default: DEFAULT_CONFIG },
  },
});

try {
  if (command === 'ref') {
    report(evaluateDispatchRef({ ref: args.ref, defaultBranch: args['default-branch'] }), 'Release ref');
  } else if (command === 'checks') {
    await checks();
  } else {
    fail([`Unknown command "${command ?? ''}". Use "ref" or "checks".`]);
  }
} catch (error) {
  fail([`Release guard could not complete: ${error.message}`]);
}

async function checks() {
  const config = JSON.parse(readFileSync(args.config, 'utf8'));
  const checkRuns = await fetchCheckRuns(args.repo, args.sha);
  const result = evaluateRequiredChecks({
    sha: args.sha,
    required: config.checks,
    app: config.app,
    checkRuns,
  });
  writeSummary(args.sha, result);
  report(result, `Required checks for ${args.sha}`);
}

async function fetchCheckRuns(repo, sha) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo || !sha) throw new Error('--repo and --sha are required.');
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required to read check runs.');

  const api = process.env.GITHUB_API_URL || 'https://api.github.com';
  const runs = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${api}/repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${url}`);
    const body = await response.json();
    if (!Array.isArray(body.check_runs) || typeof body.total_count !== 'number') {
      throw new Error('GitHub API returned an unexpected check-runs payload.');
    }
    runs.push(...body.check_runs);
    if (runs.length >= body.total_count || body.check_runs.length === 0) {
      if (runs.length < body.total_count) throw new Error('Check-run pagination ended early.');
      return runs;
    }
  }
  throw new Error(`More than ${MAX_PAGES * 100} check runs; refusing to decide on partial evidence.`);
}

function writeSummary(sha, result) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const rows = result.results.map((r) => `| ${r.ok ? 'pass' : 'FAIL'} | ${r.name} | ${r.reason} |`);
  appendFileSync(file, [
    `### Required checks for \`${sha}\``,
    '',
    '| Result | Check | Detail |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n'));
}

function report(result, label) {
  if (!result.ok) fail(result.problems);
  console.log(`${label}: verified.`);
}

function fail(problems) {
  for (const problem of problems) console.log(`::error::${problem}`);
  process.exit(1);
}
