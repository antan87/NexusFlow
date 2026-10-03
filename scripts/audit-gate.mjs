#!/usr/bin/env node
/**
 * Dependency audit gate: `npm audit`, with a narrow, expiring list of accepted advisories.
 *
 * `npm audit --audit-level=low` fails on any advisory at all, and it has no way to accept one.
 * That is the right default, but an advisory with no patched release (the whole range is
 * affected) then fails every branch until someone fixes the upstream package, and the only
 * ways out are to weaken the gate for everything or to delete it. This keeps the gate exactly
 * as strict for everything else:
 *
 * - every advisory the audit reports must be listed in .github/audit-exceptions.json,
 *   by GHSA id, with a reason;
 * - every exception expires on a date, after which the gate fails again so the decision is
 *   made again, not forgotten;
 * - an audit that cannot run is a failure, never a pass.
 *
 * Usage: node scripts/audit-gate.mjs <dir> [<dir> ...] [--exceptions <file>]
 */
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_EXCEPTIONS = fileURLToPath(new URL('../.github/audit-exceptions.json', import.meta.url));
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validate the exceptions file. A typo here must fail loudly, not excuse nothing or everything. */
export function parseExceptions(config) {
  if (!config || !Array.isArray(config.exceptions)) throw new Error('The exceptions file must be an object with an "exceptions" array.');
  const seen = new Set();
  return config.exceptions.map((entry, index) => {
    const where = `exceptions[${index}]`;
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') throw new Error(`${where} needs an "id" (a GHSA id).`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') throw new Error(`${where} (${entry.id}) needs a "reason".`);
    const match = typeof entry.expires === 'string' ? DATE.exec(entry.expires) : null;
    const real = match && new Date(`${entry.expires}T00:00:00Z`).toISOString().startsWith(entry.expires);
    if (!real) throw new Error(`${where} (${entry.id}) needs an "expires" date as YYYY-MM-DD.`);
    if (seen.has(entry.id)) throw new Error(`${entry.id} is listed more than once.`);
    seen.add(entry.id);
    return { id: entry.id, expires: entry.expires, reason: entry.reason };
  });
}

/**
 * The advisories in an `npm audit --json` report, one per id however many packages carry it.
 * A package that is vulnerable only because it depends on another lists that one by name in
 * `via`; those strings are not advisories and are skipped.
 */
export function advisoriesIn(audit) {
  const advisories = new Map();
  for (const [pkg, vulnerability] of Object.entries(audit?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (typeof via !== 'object' || via === null) continue;
      const id = String(via.url ?? '').split('/').filter(Boolean).pop() || String(via.source ?? '');
      if (!id) continue;
      const known = advisories.get(id) ?? { id, packages: [], severity: via.severity ?? vulnerability.severity, title: via.title ?? '' };
      if (!known.packages.includes(via.name ?? pkg)) known.packages.push(via.name ?? pkg);
      advisories.set(id, known);
    }
  }
  return advisories;
}

/**
 * Decide one audit report against the exceptions on `today` (YYYY-MM-DD; an exception holds
 * through its last day). `blocking` has no exception, `expired` had one that lapsed.
 */
export function evaluateAudit(audit, exceptions, today) {
  if (audit?.error) {
    const detail = [audit.error.summary, audit.error.detail].filter(Boolean).join(': ');
    return { ok: false, error: `npm audit could not report${detail ? `: ${detail}` : ''}`, blocking: [], excepted: [], expired: [] };
  }
  const byId = new Map(exceptions.map((entry) => [entry.id, entry]));
  const blocking = [];
  const excepted = [];
  const expired = [];
  for (const advisory of advisoriesIn(audit).values()) {
    const exception = byId.get(advisory.id);
    if (!exception) blocking.push(advisory);
    else if (today > exception.expires) expired.push({ ...advisory, expires: exception.expires, reason: exception.reason });
    else excepted.push({ ...advisory, expires: exception.expires, reason: exception.reason });
  }
  return { ok: blocking.length === 0 && expired.length === 0, blocking, excepted, expired };
}

/** Run `npm audit --json` in a directory. npm exits non-zero when it finds anything, so read stdout either way. */
export function runNpmAudit(dir) {
  return new Promise((resolve) => {
    execFile('npm', ['audit', '--json'], { cwd: dir, maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32' }, (error, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ error: { summary: 'npm audit produced no JSON', detail: (stderr || error?.message || '').trim().split('\n')[0] } });
      }
    });
  });
}

export async function checkDirectory({ dir, runAudit = runNpmAudit, exceptions, today }) {
  return evaluateAudit(await runAudit(dir), exceptions, today);
}

const describeAdvisory = (advisory) => `${advisory.id} (${advisory.packages.join(', ')}; ${advisory.severity})`;

export async function main(argv, {
  runAudit = runNpmAudit,
  readText = (file) => fs.readFile(file, 'utf8'),
  today = () => new Date().toISOString().slice(0, 10),
  log = console.log,
} = {}) {
  const dirs = [];
  let exceptionsFile = DEFAULT_EXCEPTIONS;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--exceptions') exceptionsFile = argv[(index += 1)];
    else dirs.push(argv[index]);
  }
  if (dirs.length === 0) {
    log('Usage: node scripts/audit-gate.mjs <dir> [<dir> ...] [--exceptions <file>]');
    return 1;
  }

  let exceptions;
  try {
    exceptions = parseExceptions(JSON.parse(await readText(exceptionsFile)));
  } catch (error) {
    log(`FAIL: cannot use ${exceptionsFile}: ${error.message}`);
    return 1;
  }

  const date = today();
  let failed = false;
  for (const dir of dirs) {
    log(`== npm audit in ${dir} ==`);
    let result;
    try {
      result = await checkDirectory({ dir, runAudit, exceptions, today: date });
    } catch (error) {
      result = { ok: false, error: `npm audit could not run: ${error.message}`, blocking: [], excepted: [], expired: [] };
    }
    if (result.error) log(`FAIL: ${result.error}`);
    for (const advisory of result.blocking) log(`BLOCKING ${describeAdvisory(advisory)}: ${advisory.title} - https://github.com/advisories/${advisory.id}`);
    for (const advisory of result.expired) log(`EXPIRED exception ${describeAdvisory(advisory)}: it lapsed after ${advisory.expires}. Fix the dependency, or renew it in .github/audit-exceptions.json with a new date and reason.`);
    for (const advisory of result.excepted) log(`accepted ${describeAdvisory(advisory)} until ${advisory.expires}: ${advisory.reason}`);
    log(result.ok ? `OK: no advisory without a live exception (${result.excepted.length} accepted).` : 'FAIL: see above.');
    if (!result.ok) failed = true;
  }
  return failed ? 1 : 0;
}

// Run as a command, not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
