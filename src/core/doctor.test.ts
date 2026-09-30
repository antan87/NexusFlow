import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runDoctor } from './doctor.js';
import { CLI_LAUNCHER } from './workspace-tools.js';

let root: string;
let repo: string;

/** A workspace shaped enough for the doctor: a config, a git repo, and the generated view. */
async function scaffold(assistants: string[]) {
  repo = path.join(root, 'repo');
  await fs.mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '.'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'README.md'), '# repo\n');
  execFileSync('git', ['add', '-A'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  await fs.writeFile(
    path.join(root, 'contextspace.json'),
    JSON.stringify({
      id: 'test', mode: 'in-place', workType: 'feature', name: 'test', branchName: 'test',
      description: 'doctor fixture', repos: [repo], originalRepos: [repo], assistants, domainPacks: [],
    }, null, 2),
  );
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Test\n\n## Repositories\n');
  await fs.writeFile(path.join(root, 'WORKSPACE.md'), '# Workspace: test\n');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-'));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('doctor: assistant checks', () => {
  it('reports an assistant id this version does not know instead of throwing', async () => {
    // A workspace outlives the harness it was created with. The check used to
    // dereference the missing harness and abort the whole report.
    await scaffold(['claude', 'some-removed-harness']);

    const report = await runDoctor(root);

    expect(report.warnings.join('\n')).toMatch(/some-removed-harness/);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: 'some-removed-harness', status: 'warn' }),
    );
    // claude is still checked, so the loop did not bail on the unknown id.
    expect(report.checks.some((check) => check.name === 'claude')).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('warns when the workspace launcher is not executable', async () => {
    // Every generated MCP config invokes this launcher, so a lost mode bit
    // breaks MCP for every client at once with someone else's error message.
    await scaffold(['claude']);
    const launcher = path.join(root, CLI_LAUNCHER);
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    await fs.chmod(launcher, 0o644);

    const report = await runDoctor(root);

    expect(report.warnings.join('\n')).toMatch(/launcher \.contextspace\/bin\/ctxspace is not executable/);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: CLI_LAUNCHER, status: 'warn' }),
    );
  });

  it.skipIf(process.platform === 'win32')('passes the launcher check when it is executable', async () => {
    await scaffold(['claude']);
    const launcher = path.join(root, CLI_LAUNCHER);
    await fs.mkdir(path.dirname(launcher), { recursive: true });
    await fs.writeFile(launcher, '#!/bin/sh\nexit 0\n');
    await fs.chmod(launcher, 0o755);

    const report = await runDoctor(root);

    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: CLI_LAUNCHER, status: 'pass' }),
    );
  });
});
