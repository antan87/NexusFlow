import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { assertPathWithin, assertNoLinkedPathComponents, assertFileHandleMatchesPath, assertRegularFile } from '../resources/fs-safety.js';

export class RepositoryFileAccessError extends Error {}

/**
 * Resolve a file an editor may be asked to open. Unlike readRepositoryFile, the
 * file must exist: a path that names nothing is never a legitimate launch target,
 * and accepting one lets a caller smuggle arbitrary text into the launch command.
 */
export async function resolveRepositoryFileForLaunch(repoPath: string, filePath: string): Promise<string> {
  try {
    const target = assertPathWithin(repoPath, path.resolve(repoPath, filePath));
    await assertNoLinkedPathComponents(repoPath, target);
    await assertRegularFile(target);
    return target;
  } catch {
    throw new RepositoryFileAccessError('Invalid repository file path.');
  }
}

/** Read only regular files below the selected repository; deleted files are empty. */
export async function readRepositoryFile(repoPath: string, filePath: string): Promise<string> {
  let target: string;
  try {
    if (path.isAbsolute(filePath)) throw new Error('Expected a repository-relative file path.');
    target = assertPathWithin(repoPath, path.resolve(repoPath, filePath));
    await assertNoLinkedPathComponents(repoPath, target);
  } catch {
    throw new RepositoryFileAccessError('Invalid repository file path.');
  }
  try {
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      await assertFileHandleMatchesPath(handle, target);
      await assertNoLinkedPathComponents(repoPath, target);
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw new RepositoryFileAccessError('Unable to read a regular repository file.');
  }
}
