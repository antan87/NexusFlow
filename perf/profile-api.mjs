#!/usr/bin/env node
/**
 * Attributes startup and navigation time to backend endpoints.
 *
 * Starts a fresh backend per sample (so process-level caches are cold, as on
 * app start) and times each endpoint the GUI calls, with the work counters of
 * that one request. With --cpu-prof, also writes a V8 CPU profile of one
 * backend doing the whole startup sequence, for flame-graph attribution
 * (open the .cpuprofile in Chrome DevTools → Performance).
 *
 *   node perf/profile-api.mjs --tier L [--samples 5] [--cpu-prof]
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { REPO_ROOT, startBackend } from './lib/backend.mjs';
import { fixtureEnv } from './lib/env.mjs';
import { ensureFixture, stopFixtureDaemons } from './lib/fixtures.mjs';
import { summarize } from './lib/stats.mjs';

const REQUEST_LIMIT_MS = 120_000;
const ws = (n) => `perf-ws-${String(n).padStart(3, '0')}`;

/** Endpoints in the order the GUI requests them on startup and when opening a workspace. */
const ENDPOINTS = [
  ['workspaces', '/api/workspaces'],
  ['status page 1', '/api/workspaces/status?offset=0&limit=24'],
  ['ai-detect', '/api/ai-detect'],
  ['editor-detect', '/api/editor-detect'],
  ['launch-targets', '/api/workspace-launch-targets'],
  ['repos', '/api/repos'],
  [`changes ${ws(0)}`, `/api/workspace/${ws(0)}/changes`],
  [`sessions ${ws(0)}`, `/api/workspace/${ws(0)}/sessions`],
  [`sessions ${ws(0)} (repeat)`, `/api/workspace/${ws(0)}/sessions`],
  [`plan ${ws(0)}`, `/api/workspace/${ws(0)}/plan`],
];

function parseArgs(argv) {
  const args = { tier: 'L', seed: 1, samples: 5, cpuProf: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tier') args.tier = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--samples') args.samples = Number(argv[++i]);
    else if (a === '--cpu-prof') args.cpuProf = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function timeSequence(backend) {
  const rows = {};
  for (const [name, url] of ENDPOINTS) {
    await backend.counters(true);
    const started = performance.now();
    let status;
    try {
      const response = await fetch(backend.base + url, { signal: AbortSignal.timeout(REQUEST_LIMIT_MS) });
      await response.arrayBuffer();
      status = response.status;
    } catch (error) {
      status = error?.name === 'TimeoutError' ? `timed out after ${REQUEST_LIMIT_MS / 1000} s` : String(error?.message ?? error);
    }
    const ms = performance.now() - started;
    const c = await backend.counters();
    console.error(`  ${name}: ${Math.round(ms)} ms (${status})`);
    rows[name] = {
      ms: Math.round(ms),
      status,
      processes: Object.values(c.spawns).reduce((n, v) => n + v, 0),
      git: c.spawns.git ?? 0,
      historyFullReads: (c.reads.claude?.readFiles ?? 0) + (c.reads.codex?.readFiles ?? 0),
      historyMiB: Math.round((((c.reads.claude?.bytes ?? 0) + (c.reads.codex?.bytes ?? 0)) / 2 ** 20) * 10) / 10,
    };
  }
  return rows;
}

const args = parseArgs(process.argv.slice(2));
const fixture = await ensureFixture({ tier: args.tier, seed: args.seed, log: console.error });
const samples = [];
for (let i = 0; i < args.samples; i += 1) {
  const backend = await startBackend({ home: fixture.home });
  try {
    samples.push({ backendReadyMs: Math.round(backend.readyMs), ...(await timeSequence(backend)) });
  } finally {
    await backend.stop();
  }
  console.error(`sample ${i + 1}/${args.samples} done`);
}

// `npx pm2 jlist` is spawned by the status endpoint; time it alone for attribution.
const pm2 = [];
for (let i = 0; i < 3; i += 1) {
  const started = performance.now();
  try { execFileSync('npx', ['pm2', 'jlist'], { env: fixtureEnv(fixture.home), stdio: 'ignore', timeout: 60_000 }); } catch { /* timing only */ }
  pm2.push(Math.round(performance.now() - started));
}

let cpuProfile = null;
if (args.cpuProf) {
  const dir = path.join(REPO_ROOT, 'perf', 'results', `cpuprof-${args.tier}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  const backend = await startBackend({ home: fixture.home, nodeArgs: ['--cpu-prof', `--cpu-prof-dir=${dir}`] });
  try { await timeSequence(backend); } finally { await backend.stop(); }
  cpuProfile = path.relative(REPO_ROOT, dir);
}

await stopFixtureDaemons(fixture.home);

const names = ['backendReadyMs', ...ENDPOINTS.map(([n]) => n)];
const lines = [
  `# Endpoint profile — tier ${args.tier}, ${args.samples} fresh backends`, '',
  '| Step | p50 ms | max ms | processes | git | full history reads | history MiB |', '|---|---|---|---|---|---|---|',
];
for (const name of names) {
  const values = samples.map((s) => (name === 'backendReadyMs' ? s[name] : s[name].ms));
  const s = summarize(values);
  const first = samples[0][name];
  lines.push(name === 'backendReadyMs'
    ? `| backend ready | ${s.p50} | ${s.max} | | | | |`
    : `| ${name} | ${s.p50} | ${s.max} | ${first.processes} | ${first.git} | ${first.historyFullReads} | ${first.historyMiB} |`);
}
lines.push('', `\`npx pm2 jlist\` alone: ${pm2.join(' / ')} ms`);
if (cpuProfile) lines.push(`CPU profile of one startup sequence: \`${cpuProfile}\``);
const md = lines.join('\n') + '\n';
const out = path.join(REPO_ROOT, 'perf', 'results', `profile-${args.tier}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.writeFile(`${out}.json`, JSON.stringify({ tier: args.tier, samples, pm2, cpuProfile }, null, 2));
await fs.writeFile(`${out}.md`, md);
process.stdout.write(md);
process.exit(0);
