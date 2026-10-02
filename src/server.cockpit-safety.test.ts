import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { app } from './server.js';
import * as config from './core/config.js';
import * as workspace from './core/workspace.js';
import * as launcher from './utils/workspace-launch.js';
import { MAX_VIEWABLE_FILE_BYTES } from './services/repository-file.js';

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

    it('skips a file too large to parse and still indexes the rest', async () => {
      git(repo, 'init', '-q');
      await fs.writeFile(path.join(repo, 'small.ts'), 'export class Small {}\n');
      await fs.writeFile(path.join(repo, 'huge.ts'), 'export class Huge {}\n'.repeat(Math.ceil(MAX_VIEWABLE_FILE_BYTES / 20) + 10));

      await expect(symbolFiles()).resolves.toEqual(['small.ts']);
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

  describe('GET /api/workspace/:id/changes/diff content limits', () => {
    let repo: string;

    beforeEach(async () => {
      repo = path.join(workspacesDir, 'feat', 'repo');
      await fs.mkdir(repo, { recursive: true });
      vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({
        id: 'feat',
        mode: 'worktree',
        repos: [path.join(devDir, 'repo')],
      } as never);
      git(repo, 'init', '-q');
    });

    async function diffOf(file: string) {
      const response = await app.request(`/api/workspace/feat/changes/diff?repo=repo&file=${encodeURIComponent(file)}`);
      expect(response.status).toBe(200);
      return await response.json() as { diff: string; fileContent: string; originalContent: string; symbols: unknown[]; contentOmitted?: string };
    }

    const oversized = () => 'export const a = 1;\n'.repeat(Math.ceil(MAX_VIEWABLE_FILE_BYTES / 20) + 10);

    it('still returns the full content, original and symbols for an ordinary modified file', async () => {
      await fs.writeFile(path.join(repo, 'a.ts'), 'export class Old {}\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'a.ts'), 'export class Old {}\nexport class Added {}\n');

      const body = await diffOf('a.ts');

      expect(body.contentOmitted).toBeUndefined();
      expect(body.fileContent).toContain('Added');
      expect(body.originalContent).toBe('export class Old {}\n');
      expect(body.diff).toContain('+export class Added {}');
      expect(body.symbols.length).toBeGreaterThan(0);
    });

    it('omits content and symbols for a binary file but still returns git\'s diff', async () => {
      await fs.writeFile(path.join(repo, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'logo.bin'), Buffer.from([0x00, 0x09, 0x08, 0x07, 0x06]));

      const body = await diffOf('logo.bin');

      expect(body).toMatchObject({ contentOmitted: 'binary', fileContent: '', originalContent: '', symbols: [] });
      expect(body.diff).toContain('Binary files');
    });

    it('omits content and symbols for an oversized modified file without parsing it', async () => {
      await fs.writeFile(path.join(repo, 'bundle.ts'), 'export const a = 1;\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'bundle.ts'), oversized());

      const body = await diffOf('bundle.ts');

      expect(body).toMatchObject({ contentOmitted: 'too-large', fileContent: '', originalContent: '', symbols: [] });
      expect(body.diff).toContain('+++ b/bundle.ts');
    });

    it('omits an oversized original (a big committed file that was then shrunk) on both sides', async () => {
      await fs.writeFile(path.join(repo, 'bundle.ts'), oversized());
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'bundle.ts'), 'export const small = 1;\n');

      const body = await diffOf('bundle.ts');

      expect(body).toMatchObject({ contentOmitted: 'too-large', fileContent: '', originalContent: '', symbols: [] });
    });

    it('still produces a diff for an untracked file that is too large to show', async () => {
      await fs.writeFile(path.join(repo, 'seed.ts'), 'export {};\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'generated.ts'), oversized());

      const body = await diffOf('generated.ts');

      expect(body.contentOmitted).toBe('too-large');
      expect(body.diff).toContain('+++ b/generated.ts');
    });

    it('still produces content and a diff for a small untracked file', async () => {
      await fs.writeFile(path.join(repo, 'seed.ts'), 'export {};\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'init');
      await fs.writeFile(path.join(repo, 'fresh.ts'), 'export class Fresh {}\n');

      const body = await diffOf('fresh.ts');

      expect(body.contentOmitted).toBeUndefined();
      expect(body.fileContent).toBe('export class Fresh {}\n');
      expect(body.diff).toContain('+export class Fresh {}');
      expect(body.symbols.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/open-editor with a filePath', () => {
    let repo: string;
    // The launch uses the resolved path; a temp dir can sit behind a symlink (macOS).
    let resolvedRepo: string;

    async function openFile(filePath: string) {
      return app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath: repo, command: 'code', filePath }),
      });
    }

    beforeEach(async () => {
      repo = path.join(devDir, 'repo');
      await fs.mkdir(path.join(repo, '.git'), { recursive: true });
      await fs.writeFile(path.join(repo, 'real.ts'), 'export {};\n');
      await fs.writeFile(path.join(root, 'outside.ts'), 'export {};\n');
      resolvedRepo = await fs.realpath(repo);
    });

    it('opens an existing regular file with its resolved absolute path', async () => {
      const response = await openFile('real.ts');

      expect(response.status).toBe(200);
      expect(launcher.launchWorkspaceTarget).toHaveBeenCalledWith(
        expect.any(String),
        resolvedRepo,
        { kind: 'new-workspace' },
        process.platform,
        path.join(resolvedRepo, 'real.ts'),
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

  describe('POST /api/open-editor for a folder under devDir', () => {
    let resolvedRepo: string;

    async function openFolder(workspacePath: string) {
      return app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspacePath, command: 'code' }),
      });
    }

    beforeEach(async () => {
      await fs.mkdir(path.join(devDir, 'repo', '.git'), { recursive: true });
      resolvedRepo = await fs.realpath(path.join(devDir, 'repo'));
    });

    it('opens a source repository, including a linked worktree whose .git is a file', async () => {
      await fs.mkdir(path.join(devDir, 'worktree'));
      await fs.writeFile(path.join(devDir, 'worktree', '.git'), 'gitdir: /elsewhere\n');

      expect((await openFolder(path.join(devDir, 'repo'))).status).toBe(200);
      expect((await openFolder(path.join(devDir, 'worktree'))).status).toBe(200);
      expect(launcher.launchWorkspaceTarget).toHaveBeenNthCalledWith(1, expect.any(String), resolvedRepo, { kind: 'new-workspace' }, process.platform, undefined);
    });

    it('refuses a plain directory, and devDir itself, unless it is a repository', async () => {
      await fs.mkdir(path.join(devDir, 'not-a-repo'));

      for (const target of [path.join(devDir, 'not-a-repo'), devDir]) {
        const response = await openFolder(target);
        expect(response.status, target).toBe(404);
      }
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });

    it.skipIf(process.platform === 'win32')('refuses a link under devDir that leads outside it, even to a repository', async () => {
      const outside = path.join(root, 'outside-repo');
      await fs.mkdir(path.join(outside, '.git'), { recursive: true });
      await fs.symlink(outside, path.join(devDir, 'escape'));

      const response = await openFolder(path.join(devDir, 'escape'));

      expect(response.status).toBe(404);
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });

    it('still refuses a path outside both devDir and the workspaces directory', async () => {
      await fs.mkdir(path.join(root, 'elsewhere', '.git'), { recursive: true });

      const response = await openFolder(path.join(root, 'elsewhere'));

      expect(response.status).toBe(400);
      expect(launcher.launchWorkspaceTarget).not.toHaveBeenCalled();
    });
  });
});
