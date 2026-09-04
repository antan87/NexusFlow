import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

import { z } from 'zod';

import { WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES, WorkroomValidationError } from './contracts.js';

const scrypt = promisify(scryptCallback);

export interface PasswordDigest {
  readonly salt: string;
  readonly hash: string;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function hashPassword(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 32) as Buffer;
  return { salt: salt.toString('base64'), hash: derived.toString('base64') };
}

export async function verifyPassword(password: string, digest: PasswordDigest): Promise<boolean> {
  const expected = Buffer.from(digest.hash, 'base64');
  const actual = await scrypt(password, Buffer.from(digest.salt, 'base64'), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function normalizeFingerprint(value: string): string {
  return value.replace(/[^a-f0-9]/gi, '').toUpperCase();
}

export interface EncryptedExportV1 {
  readonly schemaVersion: 1;
  readonly algorithm: 'aes-256-gcm+scrypt';
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

export const encryptedExportSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal('aes-256-gcm+scrypt'),
  salt: z.string().max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  iv: z.string().max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  tag: z.string().max(128).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  ciphertext: z.string().max(144 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/),
});

export function assertExportPlaintextSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES) {
    throw new WorkroomValidationError('Workroom exports are limited to 96 MiB before encryption.');
  }
}

export async function encryptExport(value: unknown, passphrase: string): Promise<EncryptedExportV1> {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  assertExportPlaintextSize(plaintext.length);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await scrypt(passphrase, salt, 32) as Buffer;
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return encryptedExportSchema.parse({
    schemaVersion: 1,
    algorithm: 'aes-256-gcm+scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

export async function decryptExport<T>(envelope: EncryptedExportV1, passphrase: string): Promise<T> {
  const parsed = encryptedExportSchema.parse(envelope);
  const salt = Buffer.from(parsed.salt, 'base64');
  const iv = Buffer.from(parsed.iv, 'base64');
  if (salt.length !== 16 || iv.length !== 12 || Buffer.from(parsed.tag, 'base64').length !== 16) {
    throw new Error('Invalid Workroom export cryptographic parameters.');
  }
  const key = await scrypt(passphrase, salt, 32) as Buffer;
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  assertExportPlaintextSize(plaintext.length);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
