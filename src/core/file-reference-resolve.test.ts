import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveFileReference, type ReferenceRepo } from './file-reference-resolve.js';

let workspace: string;
let api: ReferenceRepo;
let web: ReferenceRepo;

async function touch(file: string, content = 'x'): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

beforeEach(async () => {
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-ref-')));
  api = { repoName: 'api', repoPath: path.join(workspace, 'api') };
  web = { repoName: 'web', repoPath: path.join(workspace, 'web') };
  await touch(path.join(api.repoPath, 'src/index.ts'));
  await touch(path.join(api.repoPath, 'src/server/routes.ts'));
  await touch(path.join(api.repoPath, 'README.md'));
  await touch(path.join(web.repoPath, 'README.md'));
  await touch(path.join(web.repoPath, 'gui/src/index.ts'));
  await touch(path.join(web.repoPath, 'gui/src/App.tsx'));
  await touch(path.join(workspace, 'notes.md'));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

const resolve = (reference: string, extra: Partial<Parameters<typeof resolveFileReference>[1]> = {}) =>
  resolveFileReference(reference, { repos: [api, web], workspacePath: workspace, ...extra });

describe('resolveFileReference', () => {
  it('resolves a path relative to the session working directory first', async () => {
    const result = await resolve('src/index.ts', { cwd: path.join(web.repoPath, 'gui') });
    expect(result).toEqual({ status: 'found', repoName: 'web', repoPath: web.repoPath, file: 'gui/src/index.ts' });
  });

  it('resolves ../ paths from a subfolder the session runs in', async () => {
    const result = await resolve('../README.md', { cwd: path.join(web.repoPath, 'gui') });
    expect(result).toMatchObject({ status: 'found', repoName: 'web', file: 'README.md' });
  });

  it('prefers the exact repository path over a longer path that ends the same way', async () => {
    const result = await resolve('src/index.ts', { listFiles: async (repo) => repo === web ? ['gui/src/index.ts'] : ['src/index.ts'] });
    expect(result).toMatchObject({ status: 'found', repoName: 'api', file: 'src/index.ts' });
  });

  it('reports every repository when the same relative path exists in several', async () => {
    const result = await resolve('README.md');
    expect(result.status).toBe('ambiguous');
    expect(result.status === 'ambiguous' && result.candidates.map((c) => c.repoName).sort()).toEqual(['api', 'web']);
  });

  it('lets the working directory settle what would otherwise be ambiguous', async () => {
    const result = await resolve('README.md', { cwd: api.repoPath });
    expect(result).toMatchObject({ status: 'found', repoName: 'api', file: 'README.md' });
  });

  it('resolves a repository-qualified path and a path from the workspace root', async () => {
    expect(await resolve('web/gui/src/App.tsx')).toMatchObject({ status: 'found', repoName: 'web', file: 'gui/src/App.tsx' });
    expect(await resolve('./api/src/server/routes.ts')).toMatchObject({ status: 'found', repoName: 'api', file: 'src/server/routes.ts' });
  });

  it('resolves absolute paths inside a repository and refuses those outside', async () => {
    expect(await resolve(path.join(api.repoPath, 'src/index.ts'))).toMatchObject({ status: 'found', repoName: 'api', file: 'src/index.ts' });
    expect(await resolve(path.join(workspace, 'notes.md'))).toEqual({ status: 'not-found', reason: 'outside-repositories', absolutePath: path.join(workspace, 'notes.md') });
    expect(await resolve('/etc/passwd')).toMatchObject({ status: 'not-found', reason: 'outside-repositories' });
  });

  it('expands ~ to the home directory', async () => {
    const result = await resolve('~/api/src/index.ts', { homeDir: workspace });
    expect(result).toMatchObject({ status: 'found', repoName: 'api', file: 'src/index.ts' });
  });

  it('falls back to a unique listed suffix, and lists several when the suffix is shared', async () => {
    const listFiles = async (repo: ReferenceRepo) => repo === api ? ['src/server/routes.ts', 'src/index.ts'] : ['gui/src/index.ts', 'gui/src/App.tsx'];
    expect(await resolve('server/routes.ts', { listFiles })).toMatchObject({ status: 'found', repoName: 'api', file: 'src/server/routes.ts' });
    const shared = await resolve('index.ts', { listFiles });
    expect(shared.status).toBe('ambiguous');
    expect(shared.status === 'ambiguous' && shared.candidates.map((c) => `${c.repoName}/${c.file}`)).toEqual(['api/src/index.ts', 'web/gui/src/index.ts']);
  });

  it('says a directory or a missing file is not a file, instead of guessing', async () => {
    expect(await resolve('src/server')).toEqual({ status: 'not-found', reason: 'directory' });
    expect(await resolve('src/missing.ts', { listFiles: async () => [] })).toEqual({ status: 'not-found', reason: 'missing' });
  });

  it('does not follow a link that leads out of the repository', async () => {
    const outsideDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-outside-')));
    try {
      await touch(path.join(outsideDir, 'secret.txt'));
      await fs.symlink(path.join(outsideDir, 'secret.txt'), path.join(api.repoPath, 'leak.txt'));
      expect(await resolve('leak.txt')).toMatchObject({ status: 'not-found' });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not use the suffix fallback for paths that climb out with ..', async () => {
    const result = await resolve('../../index.ts', { listFiles: async () => ['src/index.ts'] });
    expect(result.status).toBe('not-found');
  });
});
