import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

import {
  BACKUP_ENVELOPE_VERSION,
  BACKUP_FORMAT,
  BACKUP_KDF_DEFAULT_LOG2_N,
  BACKUP_KDF_MAX_LOG2_N,
  BACKUP_KDF_MIN_LOG2_N,
  BACKUP_KDF_P,
  BACKUP_KDF_R,
  BACKUP_MAX_FILE_BYTES,
  BACKUP_MAX_PASSPHRASE_CHARACTERS,
  BACKUP_MAX_PAYLOAD_BYTES,
  BACKUP_MIN_PASSPHRASE_CHARACTERS,
  BackupError,
  backupEnvelopeSchema,
  type BackupEnvelope,
  type BackupHeader,
  type BackupPayload,
} from './contracts.js';
import { isWellFormedText } from './paths.js';
import { validateBackupPayload } from './payload.js';

function scrypt(password: Buffer, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, keyLength, options, (error, key) => error ? reject(error) : resolve(key)));
}
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Stable text for the authenticated header: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/**
 * Passphrases are NFC-normalized so one typed on macOS (decomposed) opens on
 * Linux or Windows. The minimum length is enforced when a backup is made, not
 * when one is opened, so a backup made under an older policy stays readable.
 */
function keyMaterial(passphrase: unknown, enforceMinimum: boolean): Buffer {
  if (typeof passphrase !== 'string' || !isWellFormedText(passphrase)) throw new BackupError('Enter a passphrase.', 'invalid-passphrase');
  const normalized = passphrase.normalize('NFC');
  const characters = Array.from(normalized).length;
  if (characters === 0 || characters > BACKUP_MAX_PASSPHRASE_CHARACTERS) {
    throw new BackupError(`Use a passphrase of up to ${BACKUP_MAX_PASSPHRASE_CHARACTERS} characters.`, 'invalid-passphrase');
  }
  if (enforceMinimum && (characters < BACKUP_MIN_PASSPHRASE_CHARACTERS || normalized.trim() === '')) {
    throw new BackupError(`Use a passphrase of at least ${BACKUP_MIN_PASSPHRASE_CHARACTERS} characters that is not only spaces.`, 'invalid-passphrase');
  }
  return Buffer.from(normalized, 'utf8');
}

async function deriveKey(material: Buffer, salt: Buffer, log2N: number): Promise<Buffer> {
  const N = 2 ** log2N;
  return scrypt(material, salt, 32, { N, r: BACKUP_KDF_R, p: BACKUP_KDF_P, maxmem: 128 * N * BACKUP_KDF_R * 2 });
}

export interface SealOptions {
  /** Test seam. Production backups use the default cost. */
  readonly kdfLog2N?: number;
  /** Test seam: the size the header claims for the decompressed payload. */
  readonly payloadBytes?: number;
}

/** Compress and encrypt already-serialized payload JSON. Prefer `encryptBackup`. */
export async function sealBackupBytes(json: Buffer, passphrase: string, options: SealOptions = {}): Promise<Buffer> {
  const log2N = options.kdfLog2N ?? BACKUP_KDF_DEFAULT_LOG2_N;
  if (!Number.isInteger(log2N) || log2N < BACKUP_KDF_MIN_LOG2_N || log2N > BACKUP_KDF_MAX_LOG2_N) {
    throw new BackupError('Unsupported key-derivation cost.', 'limit-exceeded');
  }
  const material = keyMaterial(passphrase, true);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: BackupHeader = {
    format: BACKUP_FORMAT,
    envelopeVersion: BACKUP_ENVELOPE_VERSION,
    kdf: { name: 'scrypt', N: 2 ** log2N, r: BACKUP_KDF_R, p: BACKUP_KDF_P, salt: salt.toString('base64') },
    passphraseNormalization: 'NFC',
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
    compression: 'gzip',
    payloadBytes: options.payloadBytes ?? json.length,
  };
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(material, salt, log2N), iv);
  cipher.setAAD(Buffer.from(canonicalJson(header), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(await gzipAsync(json)), cipher.final()]);
  const envelope: BackupEnvelope = { ...header, tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  const file = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
  if (file.length > BACKUP_MAX_FILE_BYTES) throw new BackupError('The backup is larger than the supported maximum.', 'limit-exceeded');
  return file;
}

/** Validate, serialize, compress and encrypt a backup. Returns the bytes of the `.ctxbackup` file. */
export async function encryptBackup(payload: BackupPayload, passphrase: string, options: Pick<SealOptions, 'kdfLog2N'> = {}): Promise<Buffer> {
  const valid = validateBackupPayload(payload);
  const json = Buffer.from(JSON.stringify(valid), 'utf8');
  if (json.length > BACKUP_MAX_PAYLOAD_BYTES) {
    throw new BackupError(`The backup is larger than the supported maximum of ${BACKUP_MAX_PAYLOAD_BYTES / 1024 / 1024} MiB.`, 'limit-exceeded');
  }
  return sealBackupBytes(json, passphrase, options);
}

const NOT_A_BACKUP = 'This is not a ContextSpace backup, or the file is damaged.';

/**
 * Read the unencrypted envelope without a passphrase. Nothing here is trusted
 * until `decryptBackup` authenticates it, but it is enough to refuse early.
 */
export function readBackupEnvelope(file: Buffer | string): BackupEnvelope {
  if (Buffer.byteLength(file) > BACKUP_MAX_FILE_BYTES) throw new BackupError('This file is larger than any backup ContextSpace can open.', 'limit-exceeded');
  let value: unknown;
  try { value = JSON.parse(typeof file === 'string' ? file : file.toString('utf8')); } catch { throw new BackupError(NOT_A_BACKUP, 'not-a-backup'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value) || (value as { format?: unknown }).format !== BACKUP_FORMAT) {
    throw new BackupError(NOT_A_BACKUP, 'not-a-backup');
  }
  const version = (value as { envelopeVersion?: unknown }).envelopeVersion;
  if (typeof version === 'number' && Number.isInteger(version) && version > BACKUP_ENVELOPE_VERSION) {
    throw new BackupError('This backup was made by a newer version of ContextSpace. Update ContextSpace to open it.', 'unsupported-version');
  }
  const parsed = backupEnvelopeSchema.safeParse(value);
  if (!parsed.success) throw new BackupError(`${NOT_A_BACKUP} (invalid ${parsed.error.issues[0]?.path.join('.') || 'envelope'})`, 'not-a-backup');
  const { N } = parsed.data.kdf;
  const log2N = Math.log2(N);
  if (!Number.isInteger(log2N) || log2N < BACKUP_KDF_MIN_LOG2_N) throw new BackupError(NOT_A_BACKUP, 'not-a-backup');
  if (log2N > BACKUP_KDF_MAX_LOG2_N) throw new BackupError('This backup asks for more memory than ContextSpace allows when opening a backup.', 'limit-exceeded');
  for (const [name, text, length] of [['salt', parsed.data.kdf.salt, 16], ['iv', parsed.data.iv, 12], ['tag', parsed.data.tag, 16]] as const) {
    if (Buffer.from(text, 'base64').length !== length) throw new BackupError(`${NOT_A_BACKUP} (invalid ${name})`, 'not-a-backup');
  }
  return parsed.data;
}

/**
 * Authenticate and decrypt a backup. A wrong passphrase and a changed file look
 * the same to AES-GCM, so both report `authentication-failed`.
 */
export async function decryptBackup(file: Buffer | string, passphrase: string): Promise<BackupPayload> {
  const { tag, ciphertext, ...header } = readBackupEnvelope(file);
  const material = keyMaterial(passphrase, false);
  const key = await deriveKey(material, Buffer.from(header.kdf.salt, 'base64'), Math.log2(header.kdf.N));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAAD(Buffer.from(canonicalJson(header), 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]);
  } catch {
    throw new BackupError('Could not open the backup: the passphrase is wrong or the file was changed.', 'authentication-failed');
  }
  let json: Buffer;
  try {
    json = await gunzipAsync(compressed, { maxOutputLength: header.payloadBytes });
  } catch {
    throw new BackupError('The backup contents are larger than the file says they are, or damaged.', 'invalid-contents');
  }
  if (json.length !== header.payloadBytes) throw new BackupError('The backup contents do not match the size the file says they have.', 'invalid-contents');
  let value: unknown;
  try { value = JSON.parse(json.toString('utf8')); } catch { throw new BackupError('The backup contents are damaged.', 'invalid-contents'); }
  return validateBackupPayload(value);
}
