import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { looksBinary, MAX_VIEWABLE_FILE_BYTES, readHandleAtMost, readRepositoryFileForView, RepositoryFileAccessError } from './repository-file.js';

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
    await expect(readRepositoryFileForView(repo, 'normal.ts')).resolves.toEqual({ content: 'export const value = 1;\n' });
    await expect(readRepositoryFileForView(repo, 'deleted.ts')).resolves.toEqual({ content: '' });
  });
  it('rejects traversal, absolute paths and sibling-prefix escapes', async () => {
    for (const file of ['../outside.txt', path.join(root, 'outside.txt'), '../repo-other/file']) {
      await expect(readRepositoryFileForView(repo, file)).rejects.toBeInstanceOf(RepositoryFileAccessError);
    }
  });
  it('rejects linked directories, including deleted files reached through them', async () => {
    await fs.symlink(root, path.join(repo, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readRepositoryFileForView(repo, 'linked/outside.txt')).rejects.toBeInstanceOf(RepositoryFileAccessError);
    await expect(readRepositoryFileForView(repo, 'linked/deleted.ts')).rejects.toBeInstanceOf(RepositoryFileAccessError);
  });
  it.skipIf(process.platform === 'win32')('rejects symlink files', async () => {
    await fs.symlink(path.join(root, 'outside.txt'), path.join(repo, 'linked.ts'));
    await expect(readRepositoryFileForView(repo, 'linked.ts')).rejects.toBeInstanceOf(RepositoryFileAccessError);
  });
});

describe('repository file viewing', () => {
  let root: string;
  let repo: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-view-'));
    repo = path.join(root, 'repo');
    await fs.mkdir(repo);
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('returns the text of an ordinary file, and nothing for a deleted one', async () => {
    await fs.writeFile(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    await expect(readRepositoryFileForView(repo, 'a.ts')).resolves.toEqual({ content: 'export const a = 1;\n' });
    await expect(readRepositoryFileForView(repo, 'gone.ts')).resolves.toEqual({ content: '' });
  });

  it('reports a file above the limit instead of loading it', async () => {
    await fs.writeFile(path.join(repo, 'big.ts'), 'x'.repeat(101));
    await expect(readRepositoryFileForView(repo, 'big.ts', 100)).resolves.toEqual({ content: '', omitted: 'too-large' });
    await fs.writeFile(path.join(repo, 'exact.ts'), 'x'.repeat(100));
    await expect(readRepositoryFileForView(repo, 'exact.ts', 100)).resolves.toMatchObject({ content: 'x'.repeat(100) });
  });

  it('reports a binary file instead of decoding it as text', async () => {
    await fs.writeFile(path.join(repo, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    await expect(readRepositoryFileForView(repo, 'image.png')).resolves.toEqual({ content: '', omitted: 'binary' });
  });

  it('uses git\'s rule for binary text: a NUL within the first 8000 bytes', () => {
    expect(looksBinary('plain text')).toBe(false);
    expect(looksBinary('ab\0cd')).toBe(true);
    expect(looksBinary('a'.repeat(8000) + '\0')).toBe(false);
    expect(looksBinary(Buffer.from('a\0b'))).toBe(true);
    expect(MAX_VIEWABLE_FILE_BYTES).toBeGreaterThan(0);
  });
});

describe('bounded reading of an open file', () => {
  const handleOf = (...chunks: string[]) => {
    const queue = chunks.map((chunk) => Buffer.from(chunk));
    return {
      read: async (buffer: Buffer) => {
        const next = queue.shift();
        if (!next) return { bytesRead: 0 };
        next.copy(buffer);
        return { bytesRead: next.length };
      },
    };
  };

  it('returns everything when the file fits', async () => {
    await expect(readHandleAtMost(handleOf('abc', 'def'), 6)).resolves.toEqual(Buffer.from('abcdef'));
    await expect(readHandleAtMost(handleOf(), 6)).resolves.toEqual(Buffer.alloc(0));
  });

  it('gives up as soon as the file turns out to be longer, even if it grew after it was measured', async () => {
    let reads = 0;
    const growing = {
      read: async (buffer: Buffer) => { reads += 1; buffer.fill(97); return { bytesRead: buffer.length }; },
    };

    await expect(readHandleAtMost(growing, 200_000)).resolves.toBeNull();
    expect(reads).toBeLessThan(10);
  });
});

