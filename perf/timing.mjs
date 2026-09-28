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
import { ensureFixture, fixtureDir, stopFixtureDaemons } from './lib/fixtures.mjs';
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

/**
 * Waits until the app has made no API request for `quietMs`, so first loads
 * that trail the visible UI (lazy cards, session sources) are not counted as
 * idle work. Returns how long settling took, or null if it never went quiet.
 */
async function settle(d, quietMs = 10_000, maxMs = 90_000) {
  const started = Date.now();
  await d.counters(true);
  let lastCount = 0;
  let quietSince = Date.now();
  while (Date.now() - started < maxMs) {
    await sleep(1_000);
    const c = await d.counters();
    const count = Object.values(c.requests).reduce((n, r) => n + r.count, 0);
    if (count !== lastCount) { lastCount = count; quietSince = Date.now(); }
    if (Date.now() - quietSince >= quietMs) return Date.now() - started - quietMs;
  }
  return null;
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
    const settledMs = await settle(d);
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
      settledMs,
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
    `# ${report.tier} timing — ${report.finishedAt ?? report.startedAt}${report.complete ? '' : ' (incomplete)'}`, '',
    `Commit \`${report.machine.commit?.slice(0, 7)}\`${report.machine.uncommittedChanges ? ` (+${report.machine.uncommittedChanges} uncommitted)` : ''} · ${report.machine.cpu} · ${report.machine.logicalCpus} CPUs · ${report.machine.memoryGiB} GiB · ${report.machine.os} · governor ${report.machine.governor ?? 'n/a'} · AC ${report.machine.onAcPower ?? 'n/a'} · fixture on ${report.machine.fixtureFilesystem ?? 'n/a'}`,
    `App: ${report.options.packaged ? 'packaged' : 'unpacked'} Electron ${report.versions?.electron ?? '?'} · ${report.options.runs} runs, ${report.options.warmup} warm-up discarded · cold = new app process, warm OS cache`, '',
    '| Metric | n | p50 | p95 | max |', '|---|---|---|---|---|',
    ...Object.entries(report.summaries).map(([m, s]) => `| ${m} | ${s.n} | ${s.p50 ?? '—'} | ${s.p95 ?? '—'} | ${s.max ?? '—'} |`),
  ];
  if (report.idle?.error) lines.push('', `Idle phase failed: ${report.idle.error.message} (app alive: ${report.idle.error.appAlive})`);
  else if (report.idle) {
    lines.push('', '| Idle phase | min | requests/min | git/min | backend CPU % | RSS drift MiB | heap drift MiB |', '|---|---|---|---|---|---|---|');
    for (const [phase, p] of Object.entries(report.idle)) lines.push(`| ${phase} | ${p.minutes} | ${p.requestsPerMin} | ${p.gitPerMin} | ${p.backendCpuPct ?? '—'} | ${p.backendRssDriftMiB ?? '—'} | ${p.heapDriftMiB ?? '—'} |`);
  }
  if (report.budgets) {
    lines.push('', '| Budget | stat | budget | limit (+10%) | observed | verdict |', '|---|---|---|---|---|---|');
    for (const r of report.budgets) lines.push(`| ${r.metric} | ${r.stat} | ${r.budget} | ${r.limit} | ${r.observed ?? '—'} | ${r.verdict} |`);
  }
  const errorRuns = report.runs.filter((r) => Object.keys(r.errors).length);
  if (errorRuns.length) lines.push('', `Errors in ${errorRuns.length} run(s): ${[...new Set(errorRuns.flatMap((r) => Object.entries(r.errors).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : v.message}`)))].slice(0, 5).join('; ')}`);
  return lines.join('\n') + '\n';
}

function buildReport(args, state) {
  const measured = state.runs.filter((r) => !r.warmup).map((r) => r.sample);
  const summaries = Object.fromEntries(Object.entries(flatten(measured)).map(([m, v]) => [m, summarize(v)]));
  let budgets = null;
  if (state.budgetFile) budgets = compareBudgets(summaries, state.budgetFile.tiers?.[args.tier] ?? {}, state.budgetFile.tolerance ?? 0.1);
  const f = state.fixture;
  return {
    tier: args.tier, seed: args.seed, startedAt: state.startedAt, finishedAt: state.finishedAt ?? null, complete: Boolean(state.finishedAt),
    options: { runs: args.runs, warmup: args.warmup, idleMinutes: args.idleMinutes, packaged: args.packaged, display: args.headless ? 'headless' : 'real display' },
    machine: state.machine, versions: state.versions,
    fixture: { treeDigest: f.treeDigest, workspaces: f.workspaces, repos: f.repos, codex: f.codex, claude: f.claude, faults: f.faults },
    targets: TARGETS, summaries, idle: state.idle, budgets, runs: state.runs,
  };
}

/**
 * Runs every launch, calling `save(report)` after each one so a later failure
 * never loses the samples already taken.
 */
export async function runTiming(options, save = async () => {}) {
  const args = { ...parseArgs([]), ...options };
  const fixture = await ensureFixture({ tier: args.tier, seed: args.seed, log: console.error });
  const logDir = path.join(REPO_ROOT, 'perf', 'results', 'logs');
  const state = {
    startedAt: new Date().toISOString(), fixture, runs: [], versions: null, idle: null,
    machine: describeMachine(fixtureDir(args.tier, args.seed)),
    budgetFile: args.budgets ? JSON.parse(await fs.readFile(path.resolve(REPO_ROOT, args.budgets), 'utf8')) : null,
  };
  for (let r = 0; r < args.warmup + args.runs; r += 1) {
    await resetAppProfile(fixture.home);
    let d;
    try {
      d = await launchDesktop({ home: fixture.home, packaged: args.packaged, headless: args.headless, logDir });
      state.versions ??= await d.versions();
      const { sample, errors } = await measureRun(d, fixture);
      state.runs.push({ run: r, warmup: r < args.warmup, sample, errors });
      console.error(`run ${r + 1}/${args.warmup + args.runs}${r < args.warmup ? ' (warm-up)' : ''}: usable ${sample['S1.usable']} ms, status ${sample['S1.statusComplete']} ms${Object.keys(errors).length ? `, errors ${Object.keys(errors).join(',')}` : ''}`);
    } catch (error) {
      state.runs.push({ run: r, warmup: r < args.warmup, sample: {}, errors: { launch: failure(error, d) } });
      console.error(`run ${r + 1}: failed — ${state.runs.at(-1).errors.launch.message}`);
    } finally {
      await d?.close();
    }
    await save(buildReport(args, state));
  }
  if (args.idleMinutes > 0) {
    await resetAppProfile(fixture.home);
    let d;
    try {
      d = await launchDesktop({ home: fixture.home, packaged: args.packaged, headless: args.headless, logDir });
      state.idle = await measureIdle(d, args.idleMinutes);
    } catch (error) {
      state.idle = { error: failure(error, d) };
      console.error(`idle: failed — ${state.idle.error.message}`);
    } finally {
      await d?.close();
    }
  }
  await stopFixtureDaemons(fixture.home);
  state.finishedAt = new Date().toISOString();
  const report = buildReport(args, state);
  await save(report);
  return report;
}

/** Error details plus whether the app was still running and the end of its log. */
function failure(error, d) {
  let appAlive = null;
  if (d?.electronPid) { try { process.kill(d.electronPid, 0); appAlive = true; } catch { appAlive = false; } }
  return {
    message: String(error?.message ?? error).split('\n')[0],
    appAlive,
    logTail: d ? d.log().slice(-5).map((l) => l.message.slice(0, 200)) : [],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.join(REPO_ROOT, 'perf', 'results');
  await fs.mkdir(outDir, { recursive: true });
  const stem = path.join(outDir, `timing-${args.tier}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const report = await runTiming(args, (partial) => fs.writeFile(`${stem}.json`, JSON.stringify(partial, null, 2)));
  const md = markdown(report);
  await fs.writeFile(`${stem}.md`, md);
  process.stdout.write(md);
  console.error(`Report: ${path.relative(REPO_ROOT, stem)}.{json,md}`);
  // Playwright's Electron connection can keep the event loop alive; exit explicitly.
  process.exit(args.check && report.budgets?.some((b) => b.verdict !== 'pass') ? 1 : 0);
}
