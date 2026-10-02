import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { app } from './server.js';
import * as config from './core/config.js';
import * as workspace from './core/workspace.js';
import * as launcher from './utils/workspace-launch.js';

// Real files and real git throughout: these tests exist to prove path and
// status handling that the mock-heavy server.test.ts cannot exercise.
vi.mock('./core/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/config.js')>()),
  loadConfig: vi.fn(),
}));
vi.mock('./core/workspace.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./core/workspace.js')>()),
  loadFeatureConfig: vi.fn(),
}));
vi.mock('./utils/workspace-launch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/workspace-launch.js')>()),
  launchWorkspaceTarget: vi.fn().mockResolvedValue(undefined),
}));

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { cwd, stdio: 'ignore' });
}

describe('cockpit endpoints against a real repository', () => {
  let root: string;
  let workspacesDir: string;
  let devDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-safety-'));
    workspacesDir = path.join(root, 'workspaces');
    devDir = path.join(root, 'dev');
    await fs.mkdir(workspacesDir, { recursive: true });
    await fs.mkdir(devDir, { recursive: true });
    vi.mocked(config.loadConfig).mockResolvedValue({ workspacesDir, devDir } as never);
    vi.mocked(launcher.launchWorkspaceTarget).mockClear();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  describe('GET /api/workspace/:id/changes/symbols', () => {
    let repo: string;

    beforeEach(async () => {
      repo = path.join(workspacesDir, 'feat', 'repo');
      await fs.mkdir(repo, { recursive: true });
      vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
        id: 'feat',
        mode: 'worktree',
        repos: [path.join(devDir, 'repo')],
      } as never);
    });

    async function symbolFiles(): Promise<string[]> {
      const response = await app.request('/api/workspace/feat/changes/symbols');
      expect(response.status).toBe(200);
      const body = await response.json() as { symbols: Array<{ filePath: string }> };
      return [...new Set(body.symbols.map((s) => s.filePath))].sort();
    }

    it('indexes renamed files, files in new directories and paths with spaces, and skips deletions', async () => {
      git(repo, 'init', '-q');
      await fs.writeFile(path.join(repo, 'old.ts'), 'export class OldThing {}\n');
      await fs.writeFile(path.join(repo, 'keep.ts'), 'export class KeepThing {}\n');
      await fs.writeFile(path.join(repo, 'gone.ts'), 'export class GoneThing {}\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');

      git(repo, 'mv', 'old.ts', 'renamed.ts');
      await fs.appendFile(path.join(repo, 'keep.ts'), 'export class KeepMore {}\n');
      await fs.rm(path.join(repo, 'gone.ts'));
      await fs.writeFile(path.join(repo, 'with space.ts'), 'export class Spaced {}\n');
      await fs.mkdir(path.join(repo, 'newdir'));
      await fs.writeFile(path.join(repo, 'newdir', 'inner.ts'), 'export class Inner {}\n');

      await expect(symbolFiles()).resolves.toEqual(['keep.ts', 'newdir/inner.ts', 'renamed.ts', 'with space.ts']);
    });

    it('returns no symbols for a clean repository', async () => {
      git(repo, 'init', '-q');
      await fs.writeFile(path.join(repo, 'a.ts'), 'export class A {}\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');

      await expect(symbolFiles()).resolves.toEqual([]);
    });

    it('recovers when the workspace repository is not a git repository', async () => {
      await fs.writeFile(path.join(repo, 'a.ts'), 'export class A {}\n');

      await expect(symbolFiles()).resolves.toEqual([]);
    });
  });

  describe('POST /api/open-editor with a filePath', () => {
    let repo: string;

    async function openFile(filePath: string) {
      return app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: repo, command: 'code', filePath }),
      });
    }

    beforeEach(async () => {
      repo = path.join(devDir, 'repo');
      await fs.mkdir(repo, { recursive: true });
      await fs.writeFile(path.join(repo, 'real.ts'), 'export {};\n');
      await fs.writeFile(path.join(root, 'outside.ts'), 'export {};\n');
    });

    it('opens an existing regular file with its resolved absolute path', async () => {
      const response = await openFile('real.ts');

      expect(response.status).toBe(200);
      expect(launcher.launchWorkspaceTarget).toHaveBeenCalledWith(
        expect.any(String),
        repo,
        { kind: 'new-workspace' },
        process.platform,
        path.join(repo, 'real.ts'),
      );
    });

    it('refuses a name that does not exist, including shell metacharacters that would break out of quoting', async () => {
      for (const filePath of ['missing.ts', 'x" & calc.exe & "', 'x"\r\nwhoami']) {
        const response = await openFile(filePath);
        expect(response.status, filePath).toBe(400);
      }
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });

    it('refuses traversal and absolute paths outside the repository', async () => {
      for (const filePath of ['../outside.ts', path.join(root, 'outside.ts')]) {
        const response = await openFile(filePath);
        expect(response.status, filePath).toBe(400);
      }
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });

    it('refuses a directory', async () => {
      await fs.mkdir(path.join(repo, 'sub'));

      const response = await openFile('sub');

      expect(response.status).toBe(400);
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });

    it.skipIf(process.platform === 'win32')('refuses a symlink that points outside the repository', async () => {
      await fs.symlink(path.join(root, 'outside.ts'), path.join(repo, 'escape.ts'));

      const response = await openFile('escape.ts');

      expect(response.status).toBe(400);
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });
  });
});
