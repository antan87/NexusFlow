import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readRepositoryFile, RepositoryFileAccessError } from './repository-file.js';

describe('repository file containment', () => {
  let root: string;
  let repo: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-file-'));
    repo = path.join(root, 'repo');
    await fs.mkdir(repo);
    await fs.writeFile(path.join(root, 'outside.txt'), 'outside');
    await fs.writeFile(path.join(repo, 'normal.ts'), 'export const value = 1;\n');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('reads regular files without trimming their final newline and allows deleted files', async () => {
    await expect(readRepositoryFile(repo, 'normal.ts')).resolves.toBe('export const value = 1;\n');
    await expect(readRepositoryFile(repo, 'deleted.ts')).resolves.toBe('');
  });
  it('rejects traversal, absolute paths and sibling-prefix escapes', async () => {
    for (const file of ['../outside.txt', path.join(root, 'outside.txt'), '../repo-other/file']) {
      await expect(readRepositoryFile(repo, file)).rejects.toBeInstanceOf(RepositoryFileAccessError);
    }
  });
  it('rejects linked directories, including deleted files reached through them', async () => {
    await fs.symlink(root, path.join(repo, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readRepositoryFile(repo, 'linked/outside.txt')).rejects.toBeInstanceOf(RepositoryFileAccessError);
    await expect(readRepositoryFile(repo, 'linked/deleted.ts')).rejects.toBeInstanceOf(RepositoryFileAccessError);
  });
  it.skipIf(process.platform === 'win32')('rejects symlink files', async () => {
    await fs.symlink(path.join(root, 'outside.txt'), path.join(repo, 'linked.ts'));
    await expect(readRepositoryFile(repo, 'linked.ts')).rejects.toBeInstanceOf(RepositoryFileAccessError);
  });
});
