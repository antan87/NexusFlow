/**
 * Machine description for reports, and per-process CPU/memory sampling.
 * Process sampling reads /proc and is Linux-only; elsewhere it returns null.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { REPO_ROOT } from './backend.mjs';

const read = (file) => { try { return readFileSync(file, 'utf8').trim(); } catch { return null; } };
const run = (cmd, args, cwd) => { try { return execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } };

export function describeMachine(fixtureDir) {
  const acOnline = existsSync('/sys/class/power_supply')
    ? readdirSync('/sys/class/power_supply').map((d) => read(`/sys/class/power_supply/${d}/online`)).find((v) => v !== null)
    : null;
  return {
    cpu: os.cpus()[0]?.model ?? 'unknown',
    logicalCpus: os.cpus().length,
    memoryGiB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    os: `${os.type()} ${os.release()}`,
    node: process.version,
    governor: read('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor'),
    onAcPower: acOnline === null ? null : acOnline === '1',
    loadAverage1m: Math.round(os.loadavg()[0] * 100) / 100,
    fixtureFilesystem: fixtureDir ? run('df', ['--output=fstype', fixtureDir])?.split('\n').pop() ?? null : null,
    commit: run('git', ['rev-parse', 'HEAD'], REPO_ROOT),
    uncommittedChanges: (run('git', ['status', '--porcelain'], REPO_ROOT) ?? '').split('\n').filter(Boolean).length,
  };
}

const CLOCK_TICKS = Number(run('getconf', ['CLK_TCK']) ?? 100);

/** CPU seconds and resident memory of one process, or null if unavailable. */
export function sampleProcess(pid) {
  const stat = read(`/proc/${pid}/stat`);
  const status = read(`/proc/${pid}/status`);
  if (!stat || !status) return null;
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const cpuSeconds = (Number(fields[11]) + Number(fields[12])) / CLOCK_TICKS; // utime + stime
  const rssKiB = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
  return { at: Date.now(), cpuSeconds, rssMiB: Math.round((rssKiB / 1024) * 10) / 10 };
}

/** Finds a descendant of `rootPid` whose command line matches `pattern`. */
export function findDescendant(rootPid, pattern) {
  if (!existsSync('/proc')) return null;
  const parents = new Map();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const stat = read(`/proc/${entry}/stat`);
    if (stat) parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
  }
  const isDescendant = (pid) => {
    for (let p = parents.get(pid), guard = 0; p && guard < 64; p = parents.get(p), guard += 1) if (p === rootPid) return true;
    return false;
  };
  for (const pid of parents.keys()) {
    if (!isDescendant(pid)) continue;
    const cmd = read(`/proc/${pid}/cmdline`)?.replace(/\0/g, ' ') ?? '';
    if (pattern.test(cmd)) return pid;
  }
  return null;
}

export const relativeToRepo = (p) => path.relative(REPO_ROOT, p);
