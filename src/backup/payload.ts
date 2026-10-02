import { createHash } from 'node:crypto';

import {
  BACKUP_MAX_ENTRY_BYTES,
  BACKUP_MAX_PAYLOAD_BYTES,
  BackupError,
  backupPayloadSchema,
  type BackupEntry,
  type BackupPayload,
} from './contracts.js';
import { assertLogicalPath, assertUniqueLogicalPaths } from './paths.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createBackupEntry(logicalPath: string, participant: string, bytes: Uint8Array): BackupEntry {
  if (bytes.length > BACKUP_MAX_ENTRY_BYTES) {
    throw new BackupError(`${JSON.stringify(logicalPath.slice(0, 80))} is larger than the ${BACKUP_MAX_ENTRY_BYTES / 1024 / 1024} MiB limit for one file.`, 'limit-exceeded');
  }
  assertLogicalPath(logicalPath);
  return { logicalPath, participant, size: bytes.length, sha256: sha256(bytes), bytes: Buffer.from(bytes).toString('base64') };
}

export function decodeBackupEntry(entry: BackupEntry): Buffer {
  const bytes = Buffer.from(entry.bytes, 'base64');
  // Reject non-canonical encodings so equal content always has one spelling.
  if (bytes.toString('base64') !== entry.bytes) invalid(entry, 'its bytes are not canonical base64');
  if (bytes.length !== entry.size) invalid(entry, 'its size does not match its bytes');
  if (sha256(bytes) !== entry.sha256) invalid(entry, 'its checksum does not match its bytes');
  return bytes;
}

function invalid(entry: Pick<BackupEntry, 'logicalPath'>, reason: string): never {
  throw new BackupError(`Backup entry ${JSON.stringify(entry.logicalPath.slice(0, 80))} is damaged: ${reason}.`, 'invalid-contents');
}

/**
 * Everything about a payload that encryption cannot vouch for: shape, hostile
 * paths, collisions, per-entry hashes, and that the manifest agrees with the entries.
 */
export function validateBackupPayload(value: unknown): BackupPayload {
  const parsed = backupPayloadSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BackupError(`Backup contents are malformed at ${issue?.path.join('.') || 'the top level'}.`, 'invalid-contents');
  }
  const { manifest, entries } = parsed.data;

  for (const entry of entries) assertLogicalPath(entry.logicalPath);
  assertUniqueLogicalPaths(entries.map(entry => entry.logicalPath));

  const known = new Set(manifest.participants.map(participant => participant.id));
  if (known.size !== manifest.participants.length) {
    throw new BackupError('Backup manifest lists the same participant twice.', 'invalid-contents');
  }
  for (const store of manifest.stores) {
    if (!known.has(store.participant)) throw new BackupError(`Backup manifest names a store for unknown participant "${store.participant}".`, 'invalid-contents');
  }

  let total = 0;
  for (const entry of entries) {
    if (!known.has(entry.participant)) invalid(entry, `no participant "${entry.participant}" in the manifest`);
    decodeBackupEntry(entry);
    total += entry.size;
    if (total > BACKUP_MAX_PAYLOAD_BYTES) throw new BackupError('Backup contents exceed the supported maximum.', 'limit-exceeded');
  }
  if (manifest.entryCount !== entries.length) throw new BackupError('Backup manifest does not match its entries (count).', 'invalid-contents');
  if (manifest.totalBytes !== total) throw new BackupError('Backup manifest does not match its entries (size).', 'invalid-contents');
  return parsed.data;
}
