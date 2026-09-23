import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { assertFileHandleMatchesPath, assertNoLinkedPathComponents, readFileHandleAtMost } from '../resources/fs-safety.js';

const textExtensions = new Set(['.md', '.markdown', '.txt', '.rst', '.adoc', '.csv', '.tsv', '.log', '.html', '.htm', '.svg']);
const images: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const officeExtensions = new Set(['.doc', '.docx', '.odt', '.rtf', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_BYTES = 1024 * 1024;

function format(name: string) {
  const extension = path.extname(name).toLowerCase();
  if (textExtensions.has(extension)) return { kind: extension === '.md' || extension === '.markdown' ? 'markdown' : 'text', mime: 'text/plain; charset=utf-8' } as const;
  if (extension === '.pdf') return { kind: 'pdf', mime: 'application/pdf' } as const;
  if (images[extension]) return { kind: 'image', mime: images[extension] } as const;
  if (officeExtensions.has(extension)) return { kind: 'download', mime: 'application/octet-stream' } as const;
  return null;
}

function documentPath(root: string, name: string) {
  if (!name || name.startsWith('.') || /[/\\\x00-\x1f\x7f]/.test(name) || path.isAbsolute(name) || !format(name)) {
    throw new Error('Choose a supported document in the workspace root.');
  }
  return path.join(root, name);
}

/** Agent-created files are local files, not copies registered with a storage adapter. */
export async function listRootDocuments(root: string) {
  const documents = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.') || !format(entry.name)) continue;
    try {
      const target = documentPath(root, entry.name);
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      documents.push({ name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString(), ...format(entry.name)! });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return { documents: documents.sort((a, b) => a.name.localeCompare(b.name)) };
}

export async function readRootDocument(root: string, name: string, download = false) {
  const target = documentPath(root, name);
  await assertNoLinkedPathComponents(root, target);
  const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = await assertFileHandleMatchesPath(handle, target);
    const details = format(name)!;
    const isText = details.kind === 'markdown' || details.kind === 'text';
    const limit = isText && !download ? MAX_TEXT_BYTES : MAX_FILE_BYTES;
    if (stat.size > BigInt(limit)) throw new Error(`This document exceeds the ${limit / 1024 / 1024} MB ${download ? 'download' : 'preview'} limit.`);
    const bytes = await readFileHandleAtMost(handle, limit + 1);
    await assertNoLinkedPathComponents(root, target);
    await assertFileHandleMatchesPath(handle, target);
    if (bytes.length > limit) throw new Error('The document grew beyond the size limit.');
    return { name, ...details, bytes, content: isText && !download ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : undefined };
  } finally {
    await handle.close();
  }
}
