import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { dispatchCommand, evaluatePreflight } from './release-preflight-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIP = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

const greenChecks = { ok: true, problems: [] as string[] };

function preflight(overrides: Record<string, unknown> = {}) {
  return evaluatePreflight({
    version: '2.30.0',
    mainVersion: '2.30.0',
    tipSha: TIP,
    tags: [{ sha: OLD, version: '2.29.1' }],
    runs: [{ databaseId: 1, status: 'completed', headSha: OLD, createdAt: '2026-10-01T00:00:00Z' }],
    releaseExists: false,
    checks: greenChecks,
    ...overrides,
  });
}

describe('evaluatePreflight', () => {
  it('goes when the bump is merged, nothing is in flight, and every check is green', () => {
    expect(preflight()).toEqual({ ok: true, problems: [], notes: [] });
  });

  it('refuses a version that main does not carry yet', () => {
    const result = preflight({ mainVersion: '2.29.1' });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('package.json on the default branch is 2.29.1, not 2.30.0');
  });

  it('refuses a version below an existing release tag', () => {
    const result = preflight({
      version: '2.29.0',
      mainVersion: '2.29.0',
      tags: [{ sha: OLD, version: '2.29.1' }],
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('v2.29.1 is already tagged and is newer than 2.29.0');
  });

  it.each(['waiting', 'pending', 'queued', 'in_progress', 'requested'])(
    'refuses while a release run is %s, naming the run',
    (status) => {
      const result = preflight({
        runs: [{ databaseId: 36971169374, status, headSha: OLD, createdAt: '2026-10-02T05:56:06Z' }],
      });
      expect(result.ok).toBe(false);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain(`Release run 36971169374 is ${status}`);
      expect(result.problems[0]).toContain('bbbbbbb');
    },
  );

  it('names every in-flight run', () => {
    const result = preflight({
      runs: [
        { databaseId: 2, status: 'pending', headSha: OLD, createdAt: 't2' },
        { databaseId: 1, status: 'waiting', headSha: OLD, createdAt: 't1' },
      ],
    });
    expect(result.problems).toHaveLength(2);
  });

  it('ignores finished runs, whatever their conclusion', () => {
    expect(preflight({ runs: [{ databaseId: 1, status: 'completed', headSha: OLD, createdAt: 't' }] }).ok).toBe(true);
  });

  describe('a version that is already tagged', () => {
    const tagged = { tags: [{ sha: TIP, version: '2.30.0' }] };

    it('refuses to dispatch it again once its GitHub Release exists', () => {
      const result = preflight({ ...tagged, releaseExists: true });
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toContain('already released from this commit');
    });

    it('lets --rerun finish a partial release and says so', () => {
      const result = preflight({ ...tagged, releaseExists: true, rerun: true });
      expect(result.ok).toBe(true);
      expect(result.notes[0]).toContain('--rerun was given');
    });

    it('treats a tag without a GitHub Release as an unfinished release', () => {
      const result = preflight({ ...tagged, releaseExists: false });
      expect(result.ok).toBe(true);
      expect(result.notes[0]).toContain('no GitHub Release');
    });

    it('refuses when the tag sits on a different commit than main', () => {
      const result = preflight({ tags: [{ sha: OLD, version: '2.30.0' }] });
      expect(result.ok).toBe(false);
      expect(result.problems[0]).toContain(`already tagged at ${OLD}`);
    });
  });

  it('carries the required-check failures through, prefixed with the commit', () => {
    const result = preflight({
      checks: { ok: false, problems: ['Dependency Security Audit: still in_progress'] },
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([`Required checks on ${TIP}: Dependency Security Audit: still in_progress`]);
  });

  it('reports every problem together, not only the first', () => {
    const result = preflight({
      mainVersion: '2.29.1',
      runs: [{ databaseId: 1, status: 'waiting', headSha: OLD, createdAt: 't' }],
      checks: { ok: false, problems: ['build: missing'] },
    });
    expect(result.problems).toHaveLength(3);
  });

  it.each(['', 'latest', 'v2.30.0'])('refuses %j as a version', (version) => {
    expect(preflight({ version }).ok).toBe(false);
  });
});

describe('dispatchCommand', () => {
  it('pins the commit the preflight verified', () => {
    expect(dispatchCommand({ version: '2.30.0', tipSha: TIP })).toBe(
      `gh workflow run release.yml -f version=2.30.0 -f expected_sha=${TIP}`,
    );
  });
});

describe('release:preflight script', () => {
  it('is wired in package.json and never dispatches or approves anything', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['release:preflight']).toBe('node scripts/release-preflight.mjs');

    const source = readFileSync(path.join(ROOT, 'scripts', 'release-preflight.mjs'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    const ghCalls = [...source.matchAll(/'gh',\s*\[\s*'([a-z]+)'(?:,\s*'([a-z-]+)')?/g)].map((m) => m.slice(1).filter(Boolean).join(' '));
    expect(ghCalls.sort()).toEqual(['auth token', 'release view', 'repo view', 'run list']);
    expect(source).not.toMatch(/workflow',\s*'run'|dispatches|pending_deployments|--method|-X/);
  });
});
