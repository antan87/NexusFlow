import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import fse from 'fs-extra';
import { execa } from 'execa';

import {
  captureGenerationSnapshot,
  checkGenerationLock,
  renderFreshnessBanner,
  writeGenerationLock,
} from './generation-lock.js';
import { getStorageProvider, setActiveStorageProvider } from './adapters/registry.js';
import type { StoragePort } from './ports/storage.js';

describe('generation lock', () => {
  let workspacePath: string;
  let repoPath: string;

  beforeEach(async () => {
    setActiveStorageProvider(getStorageProvider('local'));
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-lock-'));
    repoPath = path.join(workspacePath, 'repo');
    await fs.mkdir(repoPath);
    await execa('git', ['init'], { cwd: repoPath });
    await execa('git', ['config', 'user.name', 'NexusFlow Test'], { cwd: repoPath });
    await execa('git', ['config', 'user.email', 'nexusflow-test@local'], { cwd: repoPath });
    await fs.writeFile(path.join(repoPath, 'README.md'), '# repo\n');
    await execa('git', ['add', 'README.md'], { cwd: repoPath });
    await execa('git', ['commit', '-m', 'fixture'], { cwd: repoPath });
    await fs.writeFile(path.join(workspacePath, 'nexusflow.json'), JSON.stringify({
      id: 'lock-test', mode: 'in-place', branchName: 'lock-test', description: 'test',
      repos: [repoPath], assistants: [], workspacePath, createdAt: new Date().toISOString(),
    }));
  });

  afterEach(async () => {
    setActiveStorageProvider(getStorageProvider('local'));
    await fse.remove(workspacePath);
  });

  async function createLock(): Promise<void> {
    const repos = [{ name: 'repo', path: repoPath, defaultBranch: 'main' }];
    const snapshot = await captureGenerationSnapshot(repos);
    await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), `${renderFreshnessBanner(snapshot)}\n\n# Test\n`);
    await writeGenerationLock(workspacePath, snapshot, [{ path: 'AGENTS.md', source: 'test' }]);
  }

  it('accepts the exact repo and generated-output snapshot', async () => {
    await createLock();
    await expect(checkGenerationLock(workspacePath)).resolves.toMatchObject({ fresh: true, drift: [] });
  });

  it('retains generatedAt when refresh reproduces the identical snapshot and outputs', async () => {
    await createLock();
    const before = JSON.parse(await fs.readFile(path.join(workspacePath, 'nexusflow.lock'), 'utf-8')) as { generatedAt: string };
    const snapshot = await captureGenerationSnapshot([{ name: 'repo', path: repoPath, defaultBranch: 'main' }]);
    snapshot.generatedAt = '2099-01-01T00:00:00.000Z';
    await writeGenerationLock(workspacePath, snapshot, [{ path: 'AGENTS.md', source: 'test' }]);
    const after = JSON.parse(await fs.readFile(path.join(workspacePath, 'nexusflow.lock'), 'utf-8')) as { generatedAt: string };

    expect(after.generatedAt).toBe(before.generatedAt);
  });

  it('detects dirty repo state and injects a loud bounded banner', async () => {
    await createLock();
    await fs.writeFile(path.join(repoPath, 'README.md'), '# changed\n');
    const result = await checkGenerationLock(workspacePath, { markDocuments: true });
    expect(result.fresh).toBe(false);
    expect(result.drift).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'repo', name: 'repo' })]));
    expect(await fs.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toContain('STALE NEXUSFLOW CONTEXT');
  });

  it('detects edits outside the mutable freshness banner', async () => {
    await createLock();
    await fs.appendFile(path.join(workspacePath, 'AGENTS.md'), 'manual edit\n');
    const result = await checkGenerationLock(workspacePath);
    expect(result.drift).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'output', name: 'AGENTS.md' })]));
  });

  it('marks context stale when the generator version changes', async () => {
    await createLock();
    const lockPath = path.join(workspacePath, 'nexusflow.lock');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as { toolVersion: string };
    lock.toolVersion = '0.0.0-old';
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');

    const result = await checkGenerationLock(workspacePath, { markDocuments: true });

    expect(result.drift).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'tool' })]));
    expect(await fs.readFile(path.join(workspacePath, 'AGENTS.md'), 'utf-8')).toContain('Generated with NexusFlow 0.0.0-old');
  });

  it('hashes local binary resource bytes without UTF-8 replacement collisions', async () => {
    const assetPath = path.join(workspacePath, '.agents', 'skills', 'demo', 'assets', 'sample.bin');
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, Buffer.from([0x80]));
    const snapshot = await captureGenerationSnapshot([{ name: 'repo', path: repoPath, defaultBranch: 'main' }]);
    await writeGenerationLock(workspacePath, snapshot, [{
      path: '.agents/skills/demo/assets/sample.bin',
      source: 'test asset',
      location: 'local',
    }]);

    await fs.writeFile(assetPath, Buffer.from([0x81]));
    const result = await checkGenerationLock(workspacePath);

    expect(result.drift).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'output', name: '.agents/skills/demo/assets/sample.bin' }),
    ]));
  });

  it('reads workspace documents through the active storage adapter', async () => {
    const documents = new Map<string, string>([['AGENTS.md', '# Adapter context\n']]);
    const adapter: StoragePort = {
      meta: { name: 'memory', displayName: 'Memory', description: 'test', configFields: [] },
      writeWorkspaceFile: async (_workspace, _feature, filename, content) => { documents.set(filename, content); },
      readWorkspaceFile: async (_workspace, _feature, filename) => {
        const content = documents.get(filename);
        if (content === undefined) throw new Error('missing');
        return content;
      },
      workspaceFileExists: async (_workspace, _feature, filename) => documents.has(filename),
      resolveWorkspaceFileUrl: (_workspace, _feature, filename) => `memory:${filename}`,
      writeBaseFile: async () => {},
      readBaseFile: async () => '',
      baseFileExists: async () => false,
      resolveBaseFileUrl: () => 'memory:base',
      deleteWorkspace: async () => {},
    };
    setActiveStorageProvider(adapter);
    const snapshot = await captureGenerationSnapshot([{ name: 'repo', path: repoPath, defaultBranch: 'main' }]);
    await writeGenerationLock(workspacePath, snapshot, [{ path: 'AGENTS.md', source: 'test', location: 'workspace' }]);
    await expect(checkGenerationLock(workspacePath)).resolves.toMatchObject({ fresh: true });

    documents.set('AGENTS.md', '# Changed adapter context\n');
    const result = await checkGenerationLock(workspacePath);
    expect(result.drift).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'output', name: 'AGENTS.md' })]));
  });
});
