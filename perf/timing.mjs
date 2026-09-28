#!/usr/bin/env node
/**
 * Desktop timing harness (design review v2 §6B) — `npm run perf`.
 *
 * Launches the packaged desktop app on a seeded fixture once per run and times
 * what the user waits for, using the GUI's `cs:` marks:
 *   S1 cold start      launch → backend ready → shell → cards usable → git status done
 *   S2 first open      workspace not yet visited in this process → header and data shown
 *   S3 cached switch   between two visited workspaces (5 per run)
 *   S4 diff open       click a changed file → diff loaded
 *   S5 sessions        open CLI chat → first source / all sources of saved sessions
 *   S6 idle            separate launch left open: requests, git runs, CPU, memory drift
 * (S7, rapid switching, is covered by rules R3a/R3b in perf/rules.mjs.)
 *
 * "Cold" means a new app process with a warm OS file cache; dropping the cache
 * needs root. Every run starts from the same app state: Electron's profile is
 * deleted before each launch.
 *
 *   node perf/timing.mjs --tier M [--runs 20] [--warmup 2] [--idle-minutes 5]
 *                        [--unpacked] [--budgets perf/budgets.json --check]
 */
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from './lib/backend.mjs';
import { launchDesktop } from './lib/desktop.mjs';
import { ensureFixture, fixtureDir } from './lib/fixtures.mjs';
import { pageNow, readMarks, waitForMark } from './lib/marks.mjs';
import { compareBudgets, summarize } from './lib/stats.mjs';
import { describeMachine, sampleProcess } from './lib/system.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ws = (n) => `perf-ws-${String(n).padStart(3, '0')}`;
// S2 opens `a` first in each fresh app process; S3 then switches between a and b.
const TARGETS = { dirty: ws(0), a: ws(1), b: ws(2), sessions: ws(0) };
const DATA_KINDS = ['changes', 'sessions', 'plan'];

/** Milliseconds from app launch to a page mark. */
const sinceLaunch = (d, origin, mark) => Math.round(origin + mark.at - d.launchedAt);

async function resetAppProfile(home) {
  // Electron keeps localStorage (open chat tabs, layout) in its profile; start each run clean.
  for (const name of ['ContextSpace', 'contextspace-desktop']) {
    await fs.rm(path.join(home, '.config', name), { recursive: true, force: true });
  }
}

/** Navigates to a workspace and resolves when its header and every data kind are shown. */
async function openWorkspaceTimed(page, id, tab = '') {
  const since = await pageNow(page);
  await page.evaluate((h) => { location.hash = h; }, `#/workspaces/${id}${tab ? `/${tab}` : ''}`);
  const header = await waitForMark(page, 'cs:ws-header', { match: { id }, since });
  const kinds = tab ? [] : DATA_KINDS;
  const data = [];
  for (const kind of kinds) data.push(await waitForMark(page, 'cs:ws-data', { match: { id, kind, applied: true }, since }));
  const readyAt = Math.max(header.at, ...data.map((m) => m.at));
  return { headerMs: Math.round(header.at - since), readyMs: Math.round(readyAt - since) };
}

async function measureRun(d, fixture) {
  const page = d.window;
  const sample = {};
  const errors = {};
  const attempt = async (name, fn) => { try { await fn(); } catch (e) { errors[name] = String(e?.message ?? e).split('\n')[0]; } };

  await attempt('S1', async () => {
    const complete = await waitForMark(page, 'cs:overview-status-complete', { timeout: 180_000 });
    const origin = await page.evaluate(() => performance.timeOrigin);
    const marks = await readMarks(page);
    const at = (name) => { const m = marks.find((x) => x.name === name); return m ? sinceLaunch(d, origin, m) : null; };
    const ready = d.log().find((l) => l.message.startsWith('backend ready on port'));
    const longTasks = (await page.evaluate(() => window.__csLongTasks ?? null)) ?? null;
    const untilComplete = longTasks?.filter((t) => t.at <= complete.at) ?? null;
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    Object.assign(sample, {
      'S1.backendReady': ready ? ready.at - d.launchedAt : null,
      'S1.shell': at('cs:shell'),
      'S1.usable': at('cs:overview-usable'),
      'S1.statusFirst': at('cs:overview-status-first'),
      'S1.statusComplete': at('cs:overview-status-complete'),
      'S1.longTaskCount': untilComplete ? untilComplete.length : null,
      'S1.longTaskMs': untilComplete ? Math.round(untilComplete.reduce((n, t) => n + t.duration, 0)) : null,
      'S1.backendRssMiB': d.backendPid ? sampleProcess(d.backendPid)?.rssMiB ?? null : null,
      'S1.rendererHeapMiB': heap ? Math.round((heap / 2 ** 20) * 10) / 10 : null,
    });
  });

  await attempt('S2', async () => {
    const r = await openWorkspaceTimed(page, TARGETS.a);
    sample['S2.header'] = r.headerMs;
    sample['S2.ready'] = r.readyMs;
  });

  await attempt('S3', async () => {
    await openWorkspaceTimed(page, TARGETS.b);
    const switches = [];
    for (let i = 0; i < 5; i += 1) switches.push(await openWorkspaceTimed(page, i % 2 === 0 ? TARGETS.a : TARGETS.b));
    sample['S3.header'] = switches.map((s) => s.headerMs);
    sample['S3.ready'] = switches.map((s) => s.readyMs);
  });

  await attempt('S4', async () => {
    const { changes } = await d.json(`/api/workspace/${TARGETS.dirty}/changes`);
    const file = changes.flatMap((r) => r.files.filter((f) => f.type === 'modified').map((f) => ({ repo: r.repoName, file: f.file })))[0];
    if (!file) throw new Error('fixture workspace has no modified file');
    await openWorkspaceTimed(page, TARGETS.dirty, 'changes');
    await waitForMark(page, 'cs:ws-data', { match: { id: TARGETS.dirty, kind: 'changes', applied: true } });
    // Repositories start collapsed; expanding is not part of the timed click.
    await page.getByRole('button', { name: 'Expand Files' }).first().click({ timeout: 15_000 });
    const row = page.getByRole('button', { name: new RegExp(path.basename(file.file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
    const since = await pageNow(page);
    await row.click({ timeout: 15_000 });
    const ready = await waitForMark(page, 'cs:diff-ready', { match: { panel: 'changes', file: file.file }, since });
    sample['S4.diff'] = Math.round(ready.at - since);
  });

  await attempt('S5', async () => {
    await openWorkspaceTimed(page, TARGETS.sessions, 'sessions');
    const since = await pageNow(page);
    await page.getByRole('button', { name: 'Open CLI Chat', exact: true }).click({ timeout: 15_000 });
    const first = await waitForMark(page, 'cs:sessions-first', { match: { workspace: TARGETS.sessions }, since });
    const settled = await waitForMark(page, 'cs:sessions-settled', { match: { workspace: TARGETS.sessions }, since, timeout: 120_000 });
    sample['S5.first'] = Math.round(first.at - since);
    sample['S5.settled'] = Math.round(settled.at - since);
  });

  return { sample, errors };
}

async function measureIdle(d, minutes) {
  const page = d.window;
  await waitForMark(page, 'cs:overview-status-complete', { timeout: 180_000 });
  const phases = {};
  for (const [label, open] of [
    ['overview', async () => {}],
    ['workspace', async () => { await openWorkspaceTimed(page, TARGETS.dirty); }],
  ]) {
    await open();
    await sleep(3_000);
    await d.counters(true);
    const cpu0 = d.backendPid ? sampleProcess(d.backendPid) : null;
    const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    await sleep(minutes * 60_000);
    const c = await d.counters();
    const cpu1 = d.backendPid ? sampleProcess(d.backendPid) : null;
    const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const requests = Object.values(c.requests).reduce((n, r) => n + r.count, 0);
    phases[label] = {
      minutes,
      requestsPerMin: Math.round((requests / minutes) * 10) / 10,
      gitPerMin: Math.round(((c.spawns.git ?? 0) / minutes) * 10) / 10,
      backendCpuPct: cpu0 && cpu1 ? Math.round(((cpu1.cpuSeconds - cpu0.cpuSeconds) / ((cpu1.at - cpu0.at) / 1000)) * 1000) / 10 : null,
      backendRssDriftMiB: cpu0 && cpu1 ? Math.round((cpu1.rssMiB - cpu0.rssMiB) * 10) / 10 : null,
      heapDriftMiB: heap0 && heap1 ? Math.round(((heap1 - heap0) / 2 ** 20) * 10) / 10 : null,
      requestsByRoute: Object.fromEntries(Object.entries(c.requests).map(([k, v]) => [k, v.count])),
    };
  }
  return phases;
}

function parseArgs(argv) {
  const args = { tier: 'M', seed: 1, runs: 20, warmup: 2, idleMinutes: 5, packaged: true, headless: false, budgets: null, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--tier') args.tier = argv[++i];
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--runs') args.runs = Number(argv[++i]);
    else if (a === '--warmup') args.warmup = Number(argv[++i]);
    else if (a === '--idle-minutes') args.idleMinutes = Number(argv[++i]);
    else if (a === '--unpacked') args.packaged = false;
    else if (a === '--budgets') args.budgets = argv[++i];
    else if (a === '--check') args.check = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function flatten(samples) {
  const byMetric = {};
  for (const s of samples) {
    for (const [metric, value] of Object.entries(s)) (byMetric[metric] ??= []).push(...(Array.isArray(value) ? value : [value]));
  }
  return byMetric;
}

function markdown(report) {
  const lines = [
    `# ${report.tier} timing — ${report.finishedAt}`, '',
    `Commit \`${report.machine.commit?.slice(0, 7)}\`${report.machine.uncommittedChanges ? ` (+${report.machine.uncommittedChanges} uncommitted)` : ''} · ${report.machine.cpu} · ${report.machine.logicalCpus} CPUs · ${report.machine.memoryGiB} GiB · ${report.machine.os} · governor ${report.machine.governor ?? 'n/a'} · AC ${report.machine.onAcPower ?? 'n/a'} · fixture on ${report.machine.fixtureFilesystem ?? 'n/a'}`,
    `App: ${report.options.packaged ? 'packaged' : 'unpacked'} Electron ${report.versions?.electron ?? '?'} · ${report.options.runs} runs, ${report.options.warmup} warm-up discarded · cold = new app process, warm OS cache`, '',
    '| Metric | n | p50 | p95 | max |', '|---|---|---|---|---|',
    ...Object.entries(report.summaries).map(([m, s]) => `| ${m} | ${s.n} | ${s.p50 ?? '—'} | ${s.p95 ?? '—'} | ${s.max ?? '—'} |`),
  ];
  if (report.idle) {
    lines.push('', '| Idle phase | min | requests/min | git/min | backend CPU % | RSS drift MiB | heap drift MiB |', '|---|---|---|---|---|---|---|');
    for (const [phase, p] of Object.entries(report.idle)) lines.push(`| ${phase} | ${p.minutes} | ${p.requestsPerMin} | ${p.gitPerMin} | ${p.backendCpuPct ?? '—'} | ${p.backendRssDriftMiB ?? '—'} | ${p.heapDriftMiB ?? '—'} |`);
  }
  if (report.budgets) {
    lines.push('', '| Budget | stat | budget | limit (+10%) | observed | verdict |', '|---|---|---|---|---|---|');
    for (const r of report.budgets) lines.push(`| ${r.metric} | ${r.stat} | ${r.budget} | ${r.limit} | ${r.observed ?? '—'} | ${r.verdict} |`);
  }
  const errorRuns = report.runs.filter((r) => Object.keys(r.errors).length);
  if (errorRuns.length) lines.push('', `Errors in ${errorRuns.length} run(s): ${[...new Set(errorRuns.flatMap((r) => Object.entries(r.errors).map(([k, v]) => `${k}: ${v}`)))].slice(0, 5).join('; ')}`);
  return lines.join('\n') + '\n';
}

export async function runTiming(options) {
  const args = { ...parseArgs([]), ...options };
  const fixture = await ensureFixture({ tier: args.tier, seed: args.seed, log: console.error });
  const logDir = path.join(REPO_ROOT, 'perf', 'results', 'logs');
  const machine = describeMachine(fixtureDir(args.tier, args.seed));
  const runs = [];
  let versions = null;
  for (let r = 0; r < args.warmup + args.runs; r += 1) {
    await resetAppProfile(fixture.home);
    const d = await launchDesktop({ home: fixture.home, packaged: args.packaged, headless: args.headless, logDir });
    try {
      versions ??= await d.versions();
      const { sample, errors } = await measureRun(d, fixture);
      runs.push({ run: r, warmup: r < args.warmup, sample, errors });
      console.error(`run ${r + 1}/${args.warmup + args.runs}${r < args.warmup ? ' (warm-up)' : ''}: usable ${sample['S1.usable']} ms, status ${sample['S1.statusComplete']} ms${Object.keys(errors).length ? `, errors ${Object.keys(errors).join(',')}` : ''}`);
    } finally {
      await d.close();
    }
  }
  let idle = null;
  if (args.idleMinutes > 0) {
    await resetAppProfile(fixture.home);
    const d = await launchDesktop({ home: fixture.home, packaged: args.packaged, headless: args.headless, logDir });
    try { idle = await measureIdle(d, args.idleMinutes); } finally { await d.close(); }
  }

  const measured = runs.filter((r) => !r.warmup).map((r) => r.sample);
  const summaries = Object.fromEntries(Object.entries(flatten(measured)).map(([m, v]) => [m, summarize(v)]));
  let budgets = null;
  if (args.budgets) {
    const file = JSON.parse(await fs.readFile(path.resolve(REPO_ROOT, args.budgets), 'utf8'));
    budgets = compareBudgets(summaries, file.tiers?.[args.tier] ?? {}, file.tolerance ?? 0.1);
  }
  return {
    tier: args.tier, seed: args.seed, finishedAt: new Date().toISOString(),
    options: { runs: args.runs, warmup: args.warmup, idleMinutes: args.idleMinutes, packaged: args.packaged, display: args.headless ? 'headless' : 'real display' },
    machine, versions,
    fixture: { treeDigest: fixture.treeDigest, workspaces: fixture.workspaces, repos: fixture.repos, codex: fixture.codex, claude: fixture.claude, faults: fixture.faults },
    targets: TARGETS, summaries, idle, budgets, runs,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const report = await runTiming(args);
  const outDir = path.join(REPO_ROOT, 'perf', 'results');
  await fs.mkdir(outDir, { recursive: true });
  const stem = path.join(outDir, `timing-${report.tier}-${report.finishedAt.replace(/[:.]/g, '-')}`);
  await fs.writeFile(`${stem}.json`, JSON.stringify(report, null, 2));
  const md = markdown(report);
  await fs.writeFile(`${stem}.md`, md);
  process.stdout.write(md);
  console.error(`Report: ${path.relative(REPO_ROOT, stem)}.{json,md}`);
  if (args.check && report.budgets?.some((b) => b.verdict !== 'pass')) process.exit(1);
}
