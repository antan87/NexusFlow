import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkConfigPaths, expandHome } from './config-paths.js';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'config-paths-')); });
afterEach(async () => {
  await fs.chmod(root, 0o700).catch(() => {});
  await fs.rm(root, { recursive: true, force: true });
});

describe('checkConfigPaths', () => {
  it('accepts existing folders and counts repositories in the code folder', async () => {
    await fs.mkdir(path.join(root, 'dev'));
    await fs.mkdir(path.join(root, 'workspaces'));
    const report = await checkConfigPaths(
      { devDir: path.join(root, 'dev'), workspacesDir: path.join(root, 'workspaces') },
      { countRepos: async () => 3 },
    );
    expect(report).toMatchObject({ ok: true, devDir: { status: 'ok', repoCount: 3 }, workspacesDir: { status: 'ok' } });
  });

  it('explains missing folders and whether they can be created', async () => {
    const report = await checkConfigPaths({ devDir: path.join(root, 'nope'), workspacesDir: path.join(root, 'new', 'workspaces') });
    expect(report.ok).toBe(false);
    expect(report.devDir).toMatchObject({ status: 'missing', canCreate: true });
    expect(report.workspacesDir).toMatchObject({ status: 'missing', canCreate: true, message: "This folder doesn't exist." });
  });

  it('rejects files, relative paths, drive roots and a shared folder', async () => {
    await fs.writeFile(path.join(root, 'file.txt'), 'x');
    expect((await checkConfigPaths({ devDir: path.join(root, 'file.txt') })).devDir?.status).toBe('not-directory');
    expect((await checkConfigPaths({ devDir: 'dev' })).devDir?.status).toBe('invalid');
    expect((await checkConfigPaths({ devDir: '' })).devDir).toMatchObject({ status: 'invalid', message: 'Enter a folder path.' });
    expect((await checkConfigPaths({ devDir: path.parse(root).root })).devDir?.status).toBe('invalid');
    const shared = await checkConfigPaths({ devDir: root, workspacesDir: `${root}${path.sep}` });
    expect(shared.workspacesDir).toMatchObject({ status: 'invalid' });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports a workspaces folder that cannot be written', async () => {
    const locked = path.join(root, 'locked');
    await fs.mkdir(locked);
    await fs.chmod(locked, 0o500);
    try {
      const report = await checkConfigPaths({ workspacesDir: locked });
      expect(report.workspacesDir?.status).toBe('not-writable');
      // The code folder only needs to be readable.
      expect((await checkConfigPaths({ devDir: locked })).devDir?.status).toBe('ok');
      expect((await checkConfigPaths({ workspacesDir: path.join(locked, 'child') })).workspacesDir).toMatchObject({ status: 'missing', canCreate: false });
    } finally {
      await fs.chmod(locked, 0o700);
    }
  });

  it('keeps setup usable when repository counting fails', async () => {
    const report = await checkConfigPaths({ devDir: root }, { countRepos: async () => { throw new Error('EACCES'); } });
    expect(report).toMatchObject({ ok: true, devDir: { status: 'ok' } });
    expect(report.devDir?.repoCount).toBeUndefined();
  });
});

describe('expandHome', () => {
  it('expands a leading tilde only', () => {
    expect(expandHome('~')).toBe(os.homedir());
    expect(expandHome('~/dev')).toBe(path.join(os.homedir(), 'dev'));
    expect(expandHome(' /opt/dev ')).toBe('/opt/dev');
    expect(expandHome('/tmp/~/dev')).toBe('/tmp/~/dev');
  });
});
