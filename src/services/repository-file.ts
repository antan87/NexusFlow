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

/** Largest file the review view loads whole; beyond it only the patch hunks are shown. */
export const MAX_VIEWABLE_FILE_BYTES = 1024 * 1024;

// git's own rule: a NUL byte in the first 8000 bytes means binary.
const BINARY_SNIFF_BYTES = 8000;

export function looksBinary(sample: string | Buffer): boolean {
  return typeof sample === 'string'
    ? sample.slice(0, BINARY_SNIFF_BYTES).includes('\0')
    : sample.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

export type OmittedReason = 'binary' | 'too-large';

/** A file read for viewing: its text, or the reason it was not loaded. */
export type ViewableFile = { content: string; omitted?: undefined } | { content: ''; omitted: OmittedReason };

/**
 * Open a regular file below the repository and run `read` on it. The path is
 * checked before and after opening, and a deleted file yields `whenMissing`.
 */
async function readGuarded<T>(
  repoPath: string,
  filePath: string,
  read: (handle: fs.FileHandle) => Promise<T>,
  whenMissing: T,
): Promise<T> {
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
      return await read(handle);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return whenMissing;
    throw new RepositoryFileAccessError('Unable to read a regular repository file.');
  }
}

/** Read only regular files below the selected repository; deleted files are empty. */
export async function readRepositoryFile(repoPath: string, filePath: string): Promise<string> {
  return readGuarded(repoPath, filePath, (handle) => handle.readFile('utf8'), '');
}

/**
 * Like readRepositoryFile, for the review view: a file above `maxBytes`, or one
 * that looks binary, is reported rather than loaded. Loading it would put megabytes
 * of text into the response and hold the server's event loop in the symbol parser.
 */
export async function readRepositoryFileForView(
  repoPath: string,
  filePath: string,
  maxBytes: number = MAX_VIEWABLE_FILE_BYTES,
): Promise<ViewableFile> {
  return readGuarded<ViewableFile>(repoPath, filePath, async (handle) => {
    const { size } = await handle.stat();
    if (size > maxBytes) return { content: '', omitted: 'too-large' };
    const bytes = await handle.readFile();
    if (looksBinary(bytes)) return { content: '', omitted: 'binary' };
    return { content: bytes.toString('utf8') };
  }, { content: '' });
}
