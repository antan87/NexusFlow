import { z } from 'zod';

export const BACKUP_FORMAT = 'contextspace-backup';
export const BACKUP_ENVELOPE_VERSION = 1;
export const BACKUP_MANIFEST_VERSION = 1;
export const BACKUP_FILE_EXTENSION = '.ctxbackup';

export const BACKUP_MIN_PASSPHRASE_CHARACTERS = 12;
export const BACKUP_MAX_PASSPHRASE_CHARACTERS = 1024;

/** scrypt cost is recorded per file and authenticated. 2^17 with r=8 needs about 128 MiB. */
export const BACKUP_KDF_DEFAULT_LOG2_N = 17;
export const BACKUP_KDF_MIN_LOG2_N = 10;
export const BACKUP_KDF_MAX_LOG2_N = 18;
export const BACKUP_KDF_R = 8;
export const BACKUP_KDF_P = 1;

const MIB = 1024 * 1024;
/** Decompressed payload JSON. Checked before and after decompression, so a bomb fails safely. */
export const BACKUP_MAX_PAYLOAD_BYTES = 256 * MIB;
export const BACKUP_MAX_ENTRY_BYTES = 64 * MIB;
export const BACKUP_MAX_ENTRIES = 20_000;
/** Ciphertext is gzip output (barely larger than its input) in base64 (4/3), plus the header. */
export const BACKUP_MAX_FILE_BYTES = 360 * MIB;
export const BACKUP_MAX_LOGICAL_PATH_CHARACTERS = 512;

export type BackupErrorCode =
  | 'invalid-passphrase'
  | 'not-a-backup'
  | 'unsupported-version'
  | 'authentication-failed'
  | 'limit-exceeded'
  | 'invalid-contents';

export class BackupError extends Error {
  constructor(message: string, readonly code: BackupErrorCode) {
    super(message);
    this.name = 'BackupError';
  }
}

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);
const PARTICIPANT_ID = /^[a-z][a-z0-9-]{0,63}$/;
const text = (maximum: number) => z.string().max(maximum);

/** Every field except `tag` and `ciphertext` is authenticated as additional data. */
export const backupHeaderSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  envelopeVersion: z.literal(BACKUP_ENVELOPE_VERSION),
  kdf: z.strictObject({
    name: z.literal('scrypt'),
    N: z.number().int(),
    r: z.literal(BACKUP_KDF_R),
    p: z.literal(BACKUP_KDF_P),
    salt: base64.length(24),
  }),
  passphraseNormalization: z.literal('NFC'),
  cipher: z.literal('aes-256-gcm'),
  iv: base64.length(16),
  compression: z.literal('gzip'),
  payloadBytes: z.number().int().min(2).max(BACKUP_MAX_PAYLOAD_BYTES),
});
export type BackupHeader = z.infer<typeof backupHeaderSchema>;

export const backupEnvelopeSchema = backupHeaderSchema.extend({
  tag: base64.length(24),
  ciphertext: z.string().max(BACKUP_MAX_FILE_BYTES).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export type BackupEnvelope = z.infer<typeof backupEnvelopeSchema>;

export const backupManifestSchema = z.strictObject({
  manifestVersion: z.literal(BACKUP_MANIFEST_VERSION),
  backupId: z.uuid(),
  exportedAt: z.iso.datetime(),
  product: z.strictObject({ name: text(100), version: text(50) }),
  source: z.strictObject({ platform: text(32), pathSeparator: z.enum(['/', '\\']) }),
  scope: z.strictObject({
    wholeProfile: z.boolean(),
    workspaces: z.array(z.strictObject({ id: text(200), name: text(200), projectId: text(200).optional() })).max(1000),
  }),
  participants: z.array(z.strictObject({
    id: z.string().regex(PARTICIPANT_ID),
    schemaVersion: z.number().int().min(1),
    owner: text(100),
    capability: z.strictObject({ commit: z.enum(['create-only', 'create-or-merge']) }),
  })).max(64),
  stores: z.array(z.strictObject({ participant: z.string().regex(PARTICIPANT_ID), root: z.enum(['primary', 'legacy', 'custom']) })).max(64),
  exclusions: z.array(z.strictObject({ id: text(100), reason: text(500) })).max(200),
  missingDependencies: z.array(z.strictObject({ title: text(300), documentId: text(200), owningWorkspace: text(200) })).max(1000),
  repos: z.array(z.strictObject({
    workspaceId: text(200),
    name: text(200),
    identity: z.strictObject({ kind: z.enum(['remote', 'path']), value: text(2000) }),
    pathHint: text(2000).optional(),
    branch: text(300).optional(),
    headSha: text(64).optional(),
  })).max(2000),
  entryCount: z.number().int().min(0).max(BACKUP_MAX_ENTRIES),
  totalBytes: z.number().int().min(0).max(BACKUP_MAX_PAYLOAD_BYTES),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

export const backupEntrySchema = z.strictObject({
  logicalPath: text(BACKUP_MAX_LOGICAL_PATH_CHARACTERS),
  participant: z.string().regex(PARTICIPANT_ID),
  size: z.number().int().min(0).max(BACKUP_MAX_ENTRY_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: base64,
});
export type BackupEntry = z.infer<typeof backupEntrySchema>;

export const backupPayloadSchema = z.strictObject({
  manifest: backupManifestSchema,
  entries: z.array(backupEntrySchema).max(BACKUP_MAX_ENTRIES),
});
export type BackupPayload = z.infer<typeof backupPayloadSchema>;
