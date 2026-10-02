import { BACKUP_MAX_LOGICAL_PATH_CHARACTERS, BackupError } from './contracts.js';

const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const FORMAT_CHARACTERS = /\p{Cf}/u;
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*\\]/;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** `String.prototype.isWellFormed` needs a newer lib than this project targets. */
export function isWellFormedText(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

function reject(value: string, reason: string): never {
  throw new BackupError(`Backup contains an unsafe path (${reason}): ${JSON.stringify(value.slice(0, 80))}.`, 'invalid-contents');
}

/**
 * Logical paths are relative, use `/` and are already normalized. They are checked
 * against every platform's rules, so a backup made on Linux restores safely on Windows.
 */
export function assertLogicalPath(value: string): void {
  if (!value) reject(value, 'empty');
  if (value.length > BACKUP_MAX_LOGICAL_PATH_CHARACTERS) reject(value, 'too long');
  if (!isWellFormedText(value)) reject(value, 'invalid Unicode');
  if (value !== value.normalize('NFC')) reject(value, 'not NFC-normalized');
  if (CONTROL_CHARACTERS.test(value)) reject(value, 'control character');
  if (FORMAT_CHARACTERS.test(value)) reject(value, 'invisible or direction-changing character');
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) reject(value, 'absolute');
  if (value.includes('\\')) reject(value, 'backslash');
  for (const segment of value.split('/')) {
    if (!segment) reject(value, 'empty segment');
    if (segment === '.' || segment === '..') reject(value, 'relative segment');
    if (Buffer.byteLength(segment, 'utf8') > 255) reject(value, 'segment too long');
    if (WINDOWS_RESERVED_CHARACTERS.test(segment)) reject(value, 'character not allowed on Windows');
    if (/[. ]$/.test(segment) || segment.startsWith(' ')) reject(value, 'leading space or trailing dot or space');
    if (WINDOWS_DEVICE_NAMES.test(segment.split('.')[0])) reject(value, 'reserved device name');
  }
}

/** Compare paths the way a case-insensitive, normalizing filesystem would. */
export function foldLogicalPath(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/**
 * Rejects exact duplicates, names that differ only by case, and a path that is
 * both a file and the folder of another entry.
 */
export function assertUniqueLogicalPaths(paths: readonly string[]): void {
  const folded = new Map<string, string>();
  for (const path of paths) {
    const key = foldLogicalPath(path);
    const earlier = folded.get(key);
    if (earlier !== undefined) {
      reject(path, earlier === path ? 'duplicate path' : `collides with ${JSON.stringify(earlier.slice(0, 80))} on case-insensitive filesystems`);
    }
    folded.set(key, path);
  }
  for (const [key, path] of folded) {
    const parts = key.split('/');
    for (let length = 1; length < parts.length; length++) {
      const ancestor = folded.get(parts.slice(0, length).join('/'));
      if (ancestor !== undefined) reject(path, `${JSON.stringify(ancestor.slice(0, 80))} is both a file and a folder`);
    }
  }
}
