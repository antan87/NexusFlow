import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load } from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

import {
  evaluateDispatchRef,
  evaluateRequiredChecks,
  expectedCheckNames,
} from './release-guard-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'release-guard.mjs');
const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function readYaml(relPath: string): any {
  return load(readFileSync(path.join(ROOT, relPath), 'utf8'));
}

function run(name: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name,
    head_sha: SHA,
    status: 'completed',
    conclusion: 'success',
    app: { slug: 'github-actions' },
    ...overrides,
  };
}

function evaluate(checkRuns: unknown[], required = ['build', 'audit']) {
  return evaluateRequiredChecks({ sha: SHA, required, app: 'github-actions', checkRuns });
}

describe('evaluateDispatchRef', () => {
  it('accepts the default branch', () => {
    expect(evaluateDispatchRef({ ref: 'refs/heads/main', defaultBranch: 'main' }).ok).toBe(true);
  });

  it.each([
    ['a feature branch', 'refs/heads/feature/x'],
    ['a tag', 'refs/tags/v1.0.0'],
    ['a branch that only starts with the default name', 'refs/heads/main-old'],
    ['an empty ref', ''],
  ])('rejects %s', (_label, ref) => {
    const result = evaluateDispatchRef({ ref, defaultBranch: 'main' });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('only refs/heads/main may release');
  });

  it('fails closed when the default branch is unknown', () => {
    expect(evaluateDispatchRef({ ref: 'refs/heads/main', defaultBranch: '' }).ok).toBe(false);
  });
});

describe('evaluateRequiredChecks', () => {
  it('passes when every required check succeeded on the exact SHA', () => {
    const result = evaluate([run('build'), run('audit'), run('unrelated', { conclusion: 'failure' })]);
    expect(result).toMatchObject({ ok: true, problems: [] });
  });

  it.each(['failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', null])(
    'fails closed on conclusion %s',
    (conclusion) => {
      const result = evaluate([run('build'), run('audit', { conclusion })]);
      expect(result.ok).toBe(false);
      expect(result.problems).toEqual([`audit: ${conclusion ?? 'no conclusion'}`]);
    },
  );

  it.each(['queued', 'in_progress', 'waiting'])('fails closed while a check is %s', (status) => {
    const result = evaluate([run('build'), run('audit', { status, conclusion: null })]);
    expect(result.problems).toEqual([`audit: still ${status}`]);
  });

  it('fails closed when a required check never ran', () => {
    expect(evaluate([run('build')]).problems).toEqual(['audit: missing']);
  });

  it('rejects evidence recorded for a different SHA', () => {
    const result = evaluate([run('build'), run('audit', { head_sha: OTHER_SHA })]);
    expect(result.problems).toEqual(['audit: no result for this exact SHA']);
  });

  it('rejects a same-named check reported by another app', () => {
    const result = evaluate([run('build'), run('audit', { app: { slug: 'some-other-app' } })]);
    expect(result.problems).toEqual(['audit: not reported by github-actions']);
  });

  it('lets a successful re-run supersede an earlier failure', () => {
    const result = evaluate([
      run('build'),
      run('audit', { id: 10, conclusion: 'failure' }),
      run('audit', { id: 11 }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('lets a failed re-run supersede an earlier success', () => {
    const result = evaluate([
      run('build'),
      run('audit', { id: 11, conclusion: 'failure' }),
      run('audit', { id: 10 }),
    ]);
    expect(result.problems).toEqual(['audit: failure']);
  });

  it('reports every failing check, not only the first', () => {
    const result = evaluate([]);
    expect(result.problems).toEqual(['build: missing', 'audit: missing']);
  });

  it('refuses an empty required list', () => {
    const result = evaluate([run('build')], []);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('required check list is empty');
  });

  it('refuses unreadable evidence', () => {
    const result = evaluateRequiredChecks({ sha: SHA, required: ['build'], app: 'github-actions', checkRuns: undefined });
    expect(result.ok).toBe(false);
  });
});

describe('expectedCheckNames', () => {
  const derive = (jobs: Record<string, unknown>) => expectedCheckNames([{ path: 'wf.yml', workflow: { jobs } }]);

  it('names plain, named, axis-matrix and include-matrix jobs like GitHub Actions', () => {
    expect(derive({
      plain: { 'runs-on': 'x' },
      scan: { name: 'Scan', strategy: { matrix: { language: ['js'] } } },
      test: { strategy: { matrix: { os: ['linux', 'mac'], node: ['22.13.0', 24] } } },
      pkg: { strategy: { matrix: { include: [{ os: 'win', platform: 'windows' }] } } },
    })).toEqual([
      'plain',
      'Scan (js)',
      'test (linux, 22.13.0)',
      'test (linux, 24)',
      'test (mac, 22.13.0)',
      'test (mac, 24)',
      'pkg (win, windows)',
    ]);
  });

  it('rejects conditional jobs, which would leave a required check skipped', () => {
    expect(() => derive({ job: { if: "github.event_name == 'push'" } })).toThrow(/conditional/);
  });

  it.each([
    ['an expression in a name', { job: { name: '${{ matrix.os }}' } }],
    ['matrix exclude', { job: { strategy: { matrix: { os: ['a'], exclude: [{ os: 'a' }] } } } }],
    ['axes combined with include', { job: { strategy: { matrix: { os: ['a'], include: [{ os: 'b' }] } } } }],
    ['a dynamic matrix', { job: { strategy: { matrix: '${{ fromJSON(needs.x.outputs.m) }}' } } }],
  ])('rejects %s', (_label, jobs) => {
    expect(() => derive(jobs)).toThrow();
  });
});

describe('release required-check list', () => {
  const config = JSON.parse(readFileSync(path.join(ROOT, '.github/release-required-checks.json'), 'utf8'));

  it('matches every job in the gating workflows exactly', () => {
    const derived = expectedCheckNames(
      config.workflows.map((wf: string) => ({ path: wf, workflow: readYaml(wf) })),
    );
    expect([...config.checks].sort()).toEqual([...derived].sort());
  });

  it('has unique names and trusts only GitHub Actions', () => {
    expect(new Set(config.checks).size).toBe(config.checks.length);
    expect(config.app).toBe('github-actions');
  });
});

describe('release workflow wiring', () => {
  const workflow = readYaml('.github/workflows/release.yml');
  const jobs = workflow.jobs;
  const publishJobs = ['npm', 'vscode', 'desktop', 'github-release'];
  const credentialJobs = ['npm', 'vscode', 'github-release'];
  const guardRuns: string[] = jobs.guard.steps.map((step: any) => step.run ?? '');
  const indexOfRun = (needle: string) => guardRuns.findIndex((body) => body.includes(needle));

  it('only starts from explicit dispatches', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['repository_dispatch', 'workflow_dispatch']);
  });

  it('verifies the ref and exact-SHA checks before creating the tag', () => {
    const refCheck = indexOfRun('release-guard.mjs ref');
    const checksCheck = indexOfRun('release-guard.mjs checks');
    const tag = indexOfRun('git push origin "refs/tags/');
    expect(refCheck).toBeGreaterThanOrEqual(0);
    expect(checksCheck).toBeGreaterThan(refCheck);
    expect(tag).toBeGreaterThan(checksCheck);
    expect(jobs.guard.permissions).toMatchObject({ checks: 'read' });
  });

  it.each(publishJobs)('%s depends on the guard and builds the guard-approved SHA', (name) => {
    const job = jobs[name];
    expect([job.needs].flat()).toContain('guard');
    const checkouts = job.steps.filter((step: any) => String(step.uses ?? '').startsWith('actions/checkout@'));
    for (const checkout of checkouts) {
      expect(checkout.with?.ref).toBe('${{ needs.guard.outputs.sha }}');
    }
  });

  it.each(credentialJobs)('%s runs in the protected release environment', (name) => {
    expect(jobs[name].environment).toBe('release');
  });

  it('keeps publishing when the Marketplace fails but reports it as a failed channel', () => {
    const vscode = jobs.vscode;
    const publish = vscode.steps.find((step: any) => step.id === 'marketplace-publish');
    expect(publish['continue-on-error']).toBe(true);
    expect(vscode.outputs.marketplace).toBe('${{ steps.marketplace-status.outputs.status }}');
    const report = jobs['github-release'].steps.find((step: any) => step.id === 'channel-status');
    expect(report.run).toContain('exit 1');
  });
});

describe('release-guard CLI', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function serve(handler: (url: URL) => { status: number; body?: unknown }): Promise<string> {
    server = createServer((req, res) => {
      const { status, body } = handler(new URL(req.url ?? '/', 'http://localhost'));
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  function guard(args: string[], env: Record<string, string> = {}) {
    return new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, [GUARD, ...args], {
        cwd: ROOT,
        env: { PATH: process.env.PATH ?? '', GH_TOKEN: 'test-token', ...env },
      });
      let out = '';
      child.stdout.on('data', (chunk) => (out += chunk));
      child.stderr.on('data', (chunk) => (out += chunk));
      child.on('close', (code) => resolve({ code, out }));
    });
  }

  const config = JSON.parse(readFileSync(path.join(ROOT, '.github/release-required-checks.json'), 'utf8'));
  const allGreen = config.checks.map((name: string, i: number) => run(name, { id: i + 1 }));

  it('rejects a non-default ref with a non-zero exit', async () => {
    const result = await guard(['ref', '--ref', 'refs/heads/topic', '--default-branch', 'main']);
    expect(result.code).toBe(1);
    expect(result.out).toContain('::error::');
  });

  it('passes when every required check is green, following pagination', async () => {
    const api = await serve((url) => {
      const page = Number(url.searchParams.get('page'));
      const slice = page === 1 ? allGreen.slice(0, 5) : page === 2 ? allGreen.slice(5) : [];
      return { status: 200, body: { total_count: allGreen.length, check_runs: slice } };
    });
    const result = await guard(['checks', '--sha', SHA, '--repo', 'o/r'], { GITHUB_API_URL: api });
    expect(result.out).toContain('verified');
    expect(result.code).toBe(0);
  });

  it('fails closed when the API errors', async () => {
    const api = await serve(() => ({ status: 502 }));
    const result = await guard(['checks', '--sha', SHA, '--repo', 'o/r'], { GITHUB_API_URL: api });
    expect(result.code).toBe(1);
    expect(result.out).toContain('GitHub API returned 502');
  });

  it('fails closed when pagination ends before total_count', async () => {
    const api = await serve((url) => ({
      status: 200,
      body: { total_count: allGreen.length, check_runs: url.searchParams.get('page') === '1' ? allGreen.slice(0, 3) : [] },
    }));
    const result = await guard(['checks', '--sha', SHA, '--repo', 'o/r'], { GITHUB_API_URL: api });
    expect(result.code).toBe(1);
    expect(result.out).toContain('pagination ended early');
  });

  it('fails closed without a token', async () => {
    const result = await guard(['checks', '--sha', SHA, '--repo', 'o/r'], { GH_TOKEN: '' });
    expect(result.code).toBe(1);
  });
});
