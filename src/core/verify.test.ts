import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { detectTestCommand, verifyRepo, verifyWorkspace } from './verify.js';
import * as workspaceState from './workspace-state.js';
import * as workspaceCore from './workspace.js';
import * as featureUtils from '../utils/feature.js';
import * as multiGit from '../utils/multi-git.js';
import { execa } from 'execa';

vi.mock('node:fs/promises');
vi.mock('execa');
vi.mock('./workspace-state.js');
vi.mock('./workspace.js');
vi.mock('../utils/feature.js');
vi.mock('../utils/multi-git.js');

describe('core/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectTestCommand', () => {
    it('uses preferredCommand when provided', async () => {
      const spec = await detectTestCommand('/fake/repo', 'npm run test:unit --ci');
      expect(spec).toEqual({
        command: 'npm',
        args: ['run', 'test:unit', '--ci'],
        runner: 'custom',
      });
    });

    it('detects npm test from package.json', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        scripts: { test: 'vitest run' },
      }) as any);

      const spec = await detectTestCommand('/fake/repo');
      expect(spec).toEqual({
        command: 'npm',
        args: ['test'],
        runner: 'npm',
      });
    });

    it('detects pnpm when pnpm-lock.yaml exists', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        const str = String(p);
        if (str.endsWith('package.json') || str.endsWith('pnpm-lock.yaml')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        scripts: { test: 'jest' },
      }) as any);

      const spec = await detectTestCommand('/fake/repo');
      expect(spec).toEqual({
        command: 'pnpm',
        args: ['test'],
        runner: 'pnpm',
      });
    });

    it('detects cargo test when Cargo.toml exists', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('Cargo.toml')) return undefined;
        throw new Error('ENOENT');
      });

      const spec = await detectTestCommand('/fake/rust-repo');
      expect(spec).toEqual({
        command: 'cargo',
        args: ['test'],
        runner: 'cargo',
      });
    });

    it('detects go test when go.mod exists', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('go.mod')) return undefined;
        throw new Error('ENOENT');
      });

      const spec = await detectTestCommand('/fake/go-repo');
      expect(spec).toEqual({
        command: 'go',
        args: ['test', './...'],
        runner: 'go',
      });
    });

    it('detects pytest when pytest.ini exists', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('pytest.ini')) return undefined;
        throw new Error('ENOENT');
      });

      const spec = await detectTestCommand('/fake/py-repo');
      expect(spec).toEqual({
        command: 'pytest',
        args: [],
        runner: 'pytest',
      });
    });

    it('returns null when no known manifests exist', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readdir).mockResolvedValue([] as any);

      const spec = await detectTestCommand('/fake/empty-repo');
      expect(spec).toBeNull();
    });
  });

  describe('composed verification', () => {
    beforeEach(() => {
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => {
        if (cmd === 'git') return { stdout: 'head-sha' } as any;
        return { exitCode: args[0] === 'fail.mjs' ? 1 : 0, stdout: args[0] } as any;
      });
    });

    it('executes subsequent commands and fails on a failing second gate', async () => {
      const report = await verifyRepo('/repo', 'repo', { command: 'node pass.mjs && node fail.mjs && node skipped.mjs' });
      expect(report.status).toBe('fail');
      expect(report.stdout).toBe('pass.mjs\nfail.mjs');
      const calls = vi.mocked(execa).mock.calls.filter(([cmd]) => cmd === 'node');
      expect(calls.map((call) => call[1])).toEqual([['pass.mjs'], ['fail.mjs']]);
    });

    it('runs all passing commands and preserves quoted arguments including literal &&', async () => {
      const report = await verifyRepo('/repo', 'repo', { command: 'node "first gate.mjs" && node second.mjs "a && b"' });
      expect(report.status).toBe('pass');
      const calls = vi.mocked(execa).mock.calls.filter(([cmd]) => cmd === 'node');
      expect(calls.map((call) => call[1])).toEqual([['first gate.mjs'], ['second.mjs', 'a && b']]);
    });

    it('stops the chain on timeout', async () => {
      vi.mocked(execa).mockImplementation(async (cmd: any) => cmd === 'git'
        ? { stdout: 'head' } as any : { timedOut: true } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node slow.mjs && node skipped.mjs' });
      expect(report.status).toBe('timeout');
      expect(vi.mocked(execa).mock.calls.filter(([cmd]) => cmd === 'node')).toHaveLength(1);
    });

    it.each(['node a &&', 'node "unclosed', 'node a | node b'])('rejects malformed or unsupported command %s', async (command) => {
      await expect(detectTestCommand('/repo', command)).rejects.toThrow();
    });
  });

  describe('verifyRepo', () => {
    it('returns no-tests report when no test runner is found', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readdir).mockResolvedValue([] as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      vi.mocked(execa).mockResolvedValue({ stdout: 'head123' } as any);

      const report = await verifyRepo('/fake/repo', 'repo-1');

      expect(report.status).toBe('no-tests');
      expect(report.clean).toBe(true);
      expect(report.headSha).toBe('head123');
      expect(report.exitCode).toBeNull();
    });

    it('returns pass on clean repo when tests exit 0', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest run' } }) as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => {
        if (cmd === 'git') return { stdout: 'commit-sha-456' } as any;
        return { exitCode: 0, stdout: '48 tests passed', stderr: '' } as any;
      });

      const report = await verifyRepo('/fake/repo', 'repo-1');

      expect(report.status).toBe('pass');
      expect(report.clean).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.headSha).toBe('commit-sha-456');
      expect(report.command).toBe('npm test');
    });

    it('returns pass_dirty on dirty repo when tests exit 0', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest run' } }) as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({
        hasChanges: true,
        files: [{ path: 'src/index.ts', code: 'M ' }],
      } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => {
        if (cmd === 'git') return { stdout: 'commit-sha-456' } as any;
        return { exitCode: 0, stdout: '48 tests passed', stderr: '' } as any;
      });

      const report = await verifyRepo('/fake/repo', 'repo-1');

      expect(report.status).toBe('pass_dirty');
      expect(report.clean).toBe(false);
      expect(report.dirtyFiles).toEqual(['src/index.ts']);
    });

    it('returns fail when tests exit non-zero', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest run' } }) as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => {
        if (cmd === 'git') return { stdout: 'commit-sha-456' } as any;
        return { exitCode: 1, stdout: '', stderr: 'FAIL src/math.test.ts' } as any;
      });

      const report = await verifyRepo('/fake/repo', 'repo-1');

      expect(report.status).toBe('fail');
      expect(report.exitCode).toBe(1);
    });

    it('rejects a successful test run that changed tracked files', async () => {
      vi.mocked(multiGit.getRepoStatus)
        .mockResolvedValueOnce({ hasChanges: false, files: [] } as any)
        .mockResolvedValueOnce({ hasChanges: true, files: [{ path: 'source.ts', code: ' M' }] } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => cmd === 'git'
        ? { stdout: 'same-head' } as any : { exitCode: 0 } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node tests.mjs', allowDirty: true });
      expect(report).toMatchObject({ status: 'fail', exitCode: 0, clean: false, dirtyFiles: ['source.ts'] });
      expect(report.error).toContain('changed while tests');
    });

    it('rejects a HEAD change even if the final working tree is clean', async () => {
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      let headReads = 0;
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => cmd === 'git'
        ? { stdout: args[0] === 'rev-parse' ? (++headReads === 1 ? 'old-head' : 'new-head') : '' } as any
        : { exitCode: 0 } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node tests.mjs' });
      expect(report).toMatchObject({ status: 'fail', headSha: 'old-head' });
      expect(report.error).toContain('changed while tests');
    });

    it('detects changes to already-dirty content despite identical status entries', async () => {
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: true, files: [{ path: 'a.ts', code: 'M ' }] } as any);
      let diffReads = 0;
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => cmd === 'git'
        ? { stdout: args[0] === 'diff' ? `diff-${++diffReads}` : 'head' } as any
        : { exitCode: 0 } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node tests.mjs', allowDirty: true });
      expect(report.status).toBe('fail');
    });

    it('detects changes to an untracked file even when its name and status stay the same', async () => {
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: true, files: [{ path: 'new.ts', code: '??' }] } as any);
      vi.mocked(fs.readFile).mockResolvedValueOnce('before' as any).mockResolvedValueOnce('after' as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => cmd === 'git'
        ? { stdout: 'head' } as any : { exitCode: 0 } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node tests.mjs', allowDirty: true });
      expect(report.status).toBe('fail');
    });

    it('fails closed when Git status cannot be read after tests', async () => {
      vi.mocked(multiGit.getRepoStatus)
        .mockResolvedValueOnce({ hasChanges: false, files: [] } as any)
        .mockResolvedValueOnce({ hasChanges: false, files: [], summary: 'Error: Git unavailable' } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => cmd === 'git'
        ? { stdout: 'head' } as any : { exitCode: 0 } as any);
      const report = await verifyRepo('/repo', 'repo', { command: 'node tests.mjs' });
      expect(report.status).toBe('fail');
      expect(report.error).toContain('Cannot confirm repository state');
    });

    it('passes filter through to test runner', async () => {
      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest run' } }) as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      let executedArgs: string[] = [];
      vi.mocked(execa).mockImplementation(async (cmd: any, args: any) => {
        if (cmd === 'git') return { stdout: 'commit-sha-456' } as any;
        executedArgs = args;
        return { exitCode: 0, stdout: '', stderr: '' } as any;
      });

      await verifyRepo('/fake/repo', 'repo-1', { filter: 'auth.test.ts' });

      expect(executedArgs).toEqual(['test', '--', 'auth.test.ts']);
    });
  });

  describe('verifyWorkspace', () => {
    it('runs verification across workspace repos and saves state', async () => {
      vi.mocked(workspaceCore.loadFeatureConfig).mockResolvedValue({
        id: 'feat-1',
        branchName: 'feat/test',
        description: 'Testing',
        repos: ['repoA'],
        assistants: [],
        workspacePath: '/ws',
      } as any);

      vi.mocked(featureUtils.resolveFeatureRepoPath).mockReturnValue('/ws/repoA');
      vi.mocked(workspaceCore.resolveRepoInfos).mockResolvedValue([
        { name: 'repoA', path: '/ws/repoA', defaultBranch: 'main' },
      ]);

      vi.mocked(fs.access).mockImplementation(async (p) => {
        if (String(p).endsWith('package.json')) return undefined;
        throw new Error('ENOENT');
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ scripts: { test: 'vitest' } }) as any);
      vi.mocked(multiGit.getRepoStatus).mockResolvedValue({ hasChanges: false, files: [] } as any);
      vi.mocked(execa).mockImplementation(async (cmd: any) => {
        if (cmd === 'git') return { stdout: 'abc001' } as any;
        return { exitCode: 0, stdout: 'ok', stderr: '' } as any;
      });

      const report = await verifyWorkspace('/ws');

      expect(report.overallStatus).toBe('pass');
      expect(report.canProgress).toBe(true);
      expect(report.repos).toHaveLength(1);
      expect(report.repos[0]!.repoName).toBe('repoA');
      expect(workspaceState.recordVerificationReport).toHaveBeenCalledWith('/ws', report);
    });
  });
});
