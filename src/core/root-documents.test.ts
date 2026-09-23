import { beforeEach, afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { listRootDocuments, readRootDocument } from './root-documents.js';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'root-docs-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it('discovers unregistered root documents and reads their current contents', async () => {
  await fs.writeFile(path.join(root, 'agent notes.md'), '# Findings');
  await fs.writeFile(path.join(root, 'brief.docx'), 'office');
  await fs.writeFile(path.join(root, '.private.md'), 'hidden');
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'other.md'), 'nested');
  expect((await listRootDocuments(root)).documents.map((doc) => doc.name)).toEqual(['agent notes.md', 'brief.docx']);
  expect(await readRootDocument(root, 'agent notes.md')).toMatchObject({ kind: 'markdown', content: '# Findings' });
  await fs.writeFile(path.join(root, 'agent notes.md'), '# Updated');
  expect((await readRootDocument(root, 'agent notes.md')).content).toBe('# Updated');
  expect(await readRootDocument(root, 'brief.docx')).toMatchObject({ kind: 'download' });
});

it('rejects traversal, linked files, unsupported files and nonregular paths', async () => {
  for (const name of ['../escape.md', '..\\escape.md', '/tmp/escape.md', '.private.md', 'nested/doc.md', 'keys.env', 'bad\nname.md']) {
    await expect(readRootDocument(root, name)).rejects.toThrow();
  }
  await fs.writeFile(path.join(root, 'real.md'), 'original');
  await fs.symlink(path.join(root, 'real.md'), path.join(root, 'linked.md'));
  await fs.mkdir(path.join(root, 'directory.md'));
  expect((await listRootDocuments(root)).documents.map((doc) => doc.name)).toEqual(['real.md']);
  await expect(readRootDocument(root, 'linked.md')).rejects.toThrow();
  await expect(readRootDocument(root, 'directory.md')).rejects.toThrow();
});

it('bounds previews and rejects invalid text, then recovers after the file is fixed', async () => {
  const target = path.join(root, 'large.md');
  await fs.writeFile(target, 'x'.repeat(1024 * 1024 + 1));
  await expect(readRootDocument(root, 'large.md')).rejects.toThrow('preview limit');
  expect((await readRootDocument(root, 'large.md', true)).bytes.length).toBe(1024 * 1024 + 1);
  await fs.writeFile(target, Buffer.from([0xff, 0xfe]));
  await expect(readRootDocument(root, 'large.md')).rejects.toThrow();
  await fs.writeFile(target, 'fixed');
  expect((await readRootDocument(root, 'large.md')).content).toBe('fixed');
});
