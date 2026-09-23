import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { listRepositoryChanges, parseGitStatus } from './repository-changes.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('repository file listing', () => {
  it('preserves destination paths, whitespace, Unicode, and rename-looking filenames', () => {
    expect(parseGitStatus(' M src/ space \"å\".ts\0R  new\nname.ts\0old.ts\0?? literal -> arrow.ts\0').map(file => [file.file, file.type])).toEqual([
      ['src/ space \"å\".ts', 'modified'], ['new\nname.ts', 'renamed'], ['literal -> arrow.ts', 'added'],
    ]);
  });
  it('lists nested untracked files, excludes ignored files, and keeps clean files in Files mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ctx-code-tree-')); roots.push(root);
    const git = (...args: string[]) => execa('git', args, { cwd: root });
    await git('init'); await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test');
    await writeFile(path.join(root, '.gitignore'), 'ignored/\n');
    await writeFile(path.join(root, 'clean.ts'), 'old\n');
    await git('add', '.'); await git('commit', '-m', 'initial');
    await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'ignored'));
    await writeFile(path.join(root, 'src', 'å space.ts'), 'new\n');
    await writeFile(path.join(root, 'ignored', 'secret'), 'ignored');
    expect((await listRepositoryChanges(root)).map(file => file.file)).toEqual(['src/å space.ts']);
    const all = await listRepositoryChanges(root, true);
    expect(all.map(file => file.file).sort()).toEqual(['.gitignore', 'clean.ts', 'src/å space.ts']);
    await git('mv', 'clean.ts', 'renamed.ts');
    expect(await listRepositoryChanges(root)).toContainEqual(expect.objectContaining({ file: 'renamed.ts', type: 'renamed' }));
  });
});
