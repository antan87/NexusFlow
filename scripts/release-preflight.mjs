#!/usr/bin/env node
// Read-only go/no-go before dispatching a release. It never dispatches, tags or
// approves anything; it prints the exact command to run when everything agrees.
//
//   npm run release:preflight [-- --version X.Y.Z] [--rerun] [--repo owner/name]
//
// Needs git, an authenticated `gh`, and a clone whose `origin` is the repository.

import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { parseRemoteTags } from './release-guard-core.mjs';
import { dispatchCommand, evaluatePreflight } from './release-preflight-core.mjs';

const { values: args } = parseArgs({
  options: {
    version: { type: 'string' },
    repo: { type: 'string' },
    rerun: { type: 'boolean', default: false },
  },
});

function run(file, fileArgs, options = {}) {
  return execFileSync(file, fileArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function stop(problems) {
  console.log('NO-GO');
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}

let facts;
try {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const repo = args.repo ?? run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const tipSha = run('git', ['rev-parse', 'origin/main']);
  const mainVersion = JSON.parse(run('git', ['show', 'origin/main:package.json'])).version;
  const version = args.version ?? mainVersion;
  const tags = parseRemoteTags(run('git', ['ls-remote', '--tags', '--refs', 'origin']));
  const runs = JSON.parse(
    run('gh', ['run', 'list', '--repo', repo, '--workflow', 'release.yml', '--limit', '20',
      '--json', 'databaseId,status,headSha,createdAt']),
  );
  const releaseView = spawnSync('gh', ['release', 'view', `v${version}`, '--repo', repo], { encoding: 'utf8' });
  const releaseExists = releaseView.status === 0;
  if (!releaseExists && !/release not found/i.test(String(releaseView.stderr))) {
    throw new Error(`gh release view failed: ${String(releaseView.stderr || releaseView.error?.message).trim()}`);
  }

  // Reuse the publish gate's own decision, so this cannot disagree with the guard.
  const guard = spawnSync(process.execPath, ['scripts/release-guard.mjs', 'checks', '--sha', tipSha, '--repo', repo], {
    encoding: 'utf8',
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || run('gh', ['auth', 'token']) },
  });
  const checks = {
    ok: guard.status === 0,
    problems: String(guard.stdout).split('\n').filter((line) => line.startsWith('::error::')).map((line) => line.slice(9)),
  };
  if (!checks.ok && checks.problems.length === 0) checks.problems.push('The required-check guard failed without a reason.');

  facts = { version, mainVersion, tipSha, tags, runs, releaseExists, checks, rerun: args.rerun };
} catch (error) {
  // Unreadable evidence is a no-go, never a guess.
  stop([`Could not read the release state: ${String(error.stderr || error.message).trim()}`]);
}

const result = evaluatePreflight(facts);
if (!result.ok) stop(result.problems);

console.log(`GO: v${facts.version} from ${facts.tipSha}`);
for (const note of result.notes) console.log(`  note: ${note}`);
console.log('');
console.log('Dispatch (needs the owner\'s approval of the `release` environment afterwards):');
console.log(`  ${dispatchCommand(facts)}`);
