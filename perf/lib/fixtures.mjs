/**
 * Where perf fixtures live, and reuse of an existing one.
 *
 * Fixtures default to ~/.cache/contextspace-perf rather than the OS temp dir:
 * /tmp is often a RAM-backed tmpfs, which would hide the disk costs being
 * measured (and tier M alone is ~3 GB). Override with CONTEXTSPACE_PERF_DIR.
 */
import { existsSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GENERATOR_VERSION, generateFixture, removeFixture } from '../fixture/generate.mjs';

export function fixturesRoot() {
  return process.env.CONTEXTSPACE_PERF_DIR || path.join(os.homedir(), '.cache', 'contextspace-perf');
}

export function fixtureDir(tier, seed = 1) {
  return path.join(fixturesRoot(), `${tier}-s${seed}`);
}

export function readFixtureManifest(dir) {
  const file = path.join(dir, 'fixture.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

/** Guards against measuring an empty or real home by mistake. */
export function assertFixtureHome(home) {
  const manifest = readFixtureManifest(path.dirname(path.resolve(home)));
  if (!manifest || path.resolve(manifest.home) !== path.resolve(home)) {
    throw new Error(`${home} is not a generated perf fixture home (no matching fixture.json). Generate one with perf/fixture/generate.mjs.`);
  }
  return manifest;
}

/** Returns the fixture for tier+seed, generating it when missing or outdated. */
export async function ensureFixture({ tier, seed = 1, faults, log = () => {} }) {
  const dir = fixtureDir(tier, seed);
  const existing = readFixtureManifest(dir);
  const wantFaults = faults ?? tier !== 'S';
  if (existing && existing.generatorVersion === GENERATOR_VERSION && existing.faults.length > 0 === wantFaults) {
    return existing;
  }
  if (existsSync(dir)) await removeFixture(dir);
  log(`Generating tier ${tier} (seed ${seed}) in ${dir}…`);
  return generateFixture({ tier, seed, out: dir, faults: wantFaults });
}
