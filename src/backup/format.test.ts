import { randomUUID } from 'node:crypto';
import * as zlib from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

import {
  BACKUP_ENVELOPE_VERSION,
  BACKUP_KDF_DEFAULT_LOG2_N,
  BACKUP_MAX_ENTRY_BYTES,
  BackupError,
  type BackupEntry,
  type BackupErrorCode,
  type BackupManifest,
  type BackupPayload,
} from './contracts.js';
import { canonicalJson, decryptBackup, encryptBackup, readBackupEnvelope, sealBackupBytes } from './envelope.js';
import { createBackupEntry, decodeBackupEntry, validateBackupPayload } from './payload.js';

// Wrap gunzip so a test can see which output limit decryption asked zlib to enforce.
vi.mock('node:zlib', async importOriginal => {
  const actual = await importOriginal<typeof import('node:zlib')>();
  return { ...actual, gunzip: vi.fn(actual.gunzip) };
});

// Production uses 2^17. Tests use the smallest allowed cost so the suite stays fast;
// one test below checks the real default.
const FAST = { kdfLog2N: 10 } as const;
const PASSPHRASE = 'correct horse battery staple';

function manifestFor(entries: readonly BackupEntry[], overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    manifestVersion: 1,
    backupId: randomUUID(),
    exportedAt: '2026-10-02T12:00:00.000Z',
    product: { name: 'contextspace', version: '2.31.1' },
    source: { platform: 'linux', pathSeparator: '/' },
    scope: { wholeProfile: false, workspaces: [{ id: 'demo', name: 'demo' }] },
    participants: [{ id: 'workspace-files', schemaVersion: 1, owner: 'workspace', capability: { commit: 'create-only' } }],
    stores: [{ participant: 'workspace-files', root: 'primary' }],
    exclusions: [{ id: 'chat', reason: 'Chat history is not part of a backup.' }],
    missingDependencies: [],
    repos: [],
    entryCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    ...overrides,
  };
}

function payloadOf(entries: BackupEntry[], overrides: Partial<BackupManifest> = {}): BackupPayload {
  return { manifest: manifestFor(entries, overrides), entries };
}

const SECRET = 'authored-secret-marker-7f3a';
function samplePayload(): BackupPayload {
  return payloadOf([
    createBackupEntry('workspaces/demo/contextspace.json', 'workspace-files', Buffer.from(JSON.stringify({ id: 'demo' }))),
    createBackupEntry('workspaces/demo/contextspace-knowledge.md', 'workspace-files', Buffer.from(`# Notes\n${SECRET}\n`)),
    createBackupEntry('workspaces/demo/binary.dat', 'workspace-files', Buffer.from([0, 255, 254, 1, 0x80, 0xc3, 0x28])),
    createBackupEntry('workspaces/demo/empty.md', 'workspace-files', Buffer.alloc(0)),
  ]);
}

async function failure(action: () => Promise<unknown> | unknown): Promise<BackupError> {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(BackupError);
    return error as BackupError;
  }
  throw new Error('Expected a BackupError but nothing was thrown.');
}
async function expectCode(code: BackupErrorCode, action: () => Promise<unknown> | unknown): Promise<BackupError> {
  const error = await failure(action);
  expect(error.code).toBe(code);
  return error;
}

function edit(file: Buffer, change: (envelope: Record<string, any>) => void): Buffer {
  const envelope = JSON.parse(file.toString('utf8'));
  change(envelope);
  return Buffer.from(`${JSON.stringify(envelope)}\n`);
}
/** Change the first base64 character to a different valid one. */
function flip(text: string): string {
  return (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
}

describe('canonical JSON', () => {
  it('is independent of key order, at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('keeps array order', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
  });
});

describe('backup envelope', () => {
  it('round-trips every entry byte for byte, including binary and empty files', async () => {
    const payload = samplePayload();
    const file = await encryptBackup(payload, PASSPHRASE, FAST);
    const opened = await decryptBackup(file, PASSPHRASE);
    expect(opened).toEqual(payload);
    for (const [index, entry] of opened.entries.entries()) {
      expect(decodeBackupEntry(entry).equals(decodeBackupEntry(payload.entries[index]))).toBe(true);
    }
    expect(decodeBackupEntry(opened.entries[2])).toEqual(Buffer.from([0, 255, 254, 1, 0x80, 0xc3, 0x28]));
  });

  it('records the production key-derivation cost in the authenticated header', async () => {
    const file = await encryptBackup(samplePayload(), PASSPHRASE);
    const header = readBackupEnvelope(file);
    expect(header.kdf).toMatchObject({ name: 'scrypt', N: 2 ** BACKUP_KDF_DEFAULT_LOG2_N, r: 8, p: 1 });
    expect(header.envelopeVersion).toBe(BACKUP_ENVELOPE_VERSION);
    expect(header.cipher).toBe('aes-256-gcm');
    expect((await decryptBackup(file, PASSPHRASE)).manifest.entryCount).toBe(4);
  });

  it('shows no authored content in the file, readable or base64-encoded', async () => {
    const text = (await encryptBackup(samplePayload(), PASSPHRASE, FAST)).toString('utf8');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(Buffer.from(SECRET).toString('base64'));
    expect(text).not.toContain('contextspace-knowledge');
    expect(text).not.toContain('workspaces/demo');
  });

  it('uses a fresh salt and nonce every time', async () => {
    const [first, second] = await Promise.all([encryptBackup(samplePayload(), PASSPHRASE, FAST), encryptBackup(samplePayload(), PASSPHRASE, FAST)]);
    const [a, b] = [readBackupEnvelope(first), readBackupEnvelope(second)];
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('opens a file whose JSON keys were reordered, because the header is authenticated canonically', async () => {
    const payload = samplePayload();
    const file = await encryptBackup(payload, PASSPHRASE, FAST);
    const envelope = JSON.parse(file.toString('utf8'));
    const reordered = Object.fromEntries(Object.entries(envelope).reverse());
    reordered.kdf = Object.fromEntries(Object.entries(envelope.kdf).reverse());
    expect(Object.keys(reordered)).not.toEqual(Object.keys(envelope));
    expect(await decryptBackup(JSON.stringify(reordered), PASSPHRASE)).toEqual(payload);
  });

  describe('passphrases', () => {
    it('reports a wrong passphrase without echoing it or any content', async () => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      const error = await expectCode('authentication-failed', () => decryptBackup(file, 'a different passphrase'));
      expect(error.message).not.toContain('a different passphrase');
      expect(error.message).not.toContain(SECRET);
    });

    it.each([
      ['too short', 'short one'],
      ['only spaces', ' '.repeat(20)],
      ['empty', ''],
      ['too long', 'x'.repeat(1025)],
    ])('refuses to make a backup with a passphrase that is %s', async (_name, passphrase) => {
      await expectCode('invalid-passphrase', () => encryptBackup(samplePayload(), passphrase, FAST));
    });

    it.each([[undefined], [null], [12345678901234], [{}]])('refuses a non-string passphrase (%j)', async (passphrase) => {
      await expectCode('invalid-passphrase', () => encryptBackup(samplePayload(), passphrase as unknown as string, FAST));
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('invalid-passphrase', () => decryptBackup(file, passphrase as unknown as string));
    });

    it('accepts exactly the minimum length, counting characters and not bytes', async () => {
      await expect(encryptBackup(samplePayload(), 'é'.repeat(12), FAST)).resolves.toBeInstanceOf(Buffer);
      await expectCode('invalid-passphrase', () => encryptBackup(samplePayload(), 'é'.repeat(11), FAST));
    });

    it('opens with the same passphrase typed in decomposed or composed form (macOS vs Linux)', async () => {
      const composed = 'caf\u00e9 passphrase!!';
      const decomposed = 'cafe\u0301 passphrase!!';
      expect(composed).not.toBe(decomposed);
      const payload = samplePayload();
      const file = await encryptBackup(payload, composed, FAST);
      expect(await decryptBackup(file, decomposed)).toEqual(payload);
      expect(await decryptBackup(await encryptBackup(payload, decomposed, FAST), composed)).toEqual(payload);
    });

    it('treats a passphrase as case- and space-sensitive', async () => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('authentication-failed', () => decryptBackup(file, PASSPHRASE.toUpperCase()));
      await expectCode('authentication-failed', () => decryptBackup(file, `${PASSPHRASE} `));
    });
  });

  describe('tampering', () => {
    it.each([
      ['ciphertext', (e: Record<string, any>) => { e.ciphertext = flip(e.ciphertext); }],
      ['tag', (e: Record<string, any>) => { e.tag = flip(e.tag); }],
      ['nonce', (e: Record<string, any>) => { e.iv = flip(e.iv); }],
      ['salt', (e: Record<string, any>) => { e.kdf.salt = flip(e.kdf.salt); }],
      ['key-derivation cost', (e: Record<string, any>) => { e.kdf.N *= 2; }],
      ['declared payload size', (e: Record<string, any>) => { e.payloadBytes += 1; }],
    ])('detects a changed %s', async (_name, change) => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('authentication-failed', () => decryptBackup(edit(file, change), PASSPHRASE));
    });

    it('detects truncated ciphertext', async () => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('authentication-failed', () => decryptBackup(edit(file, e => { e.ciphertext = e.ciphertext.slice(0, -8); }), PASSPHRASE));
    });

    it('detects ciphertext moved from another backup, even with the right passphrase', async () => {
      const [one, two] = await Promise.all([encryptBackup(samplePayload(), PASSPHRASE, FAST), encryptBackup(samplePayload(), PASSPHRASE, FAST)]);
      const other = JSON.parse(two.toString('utf8'));
      await expectCode('authentication-failed', () => decryptBackup(edit(one, e => { e.ciphertext = other.ciphertext; }), PASSPHRASE));
    });

    it.each([
      ['an extra field', (e: Record<string, any>) => { e.note = 'added'; }],
      ['a different cipher', (e: Record<string, any>) => { e.cipher = 'aes-128-gcm'; }],
      ['a different compression', (e: Record<string, any>) => { e.compression = 'zip'; }],
      ['a different kdf', (e: Record<string, any>) => { e.kdf.name = 'pbkdf2'; }],
      ['different scrypt parameters', (e: Record<string, any>) => { e.kdf.r = 1; }],
      ['a missing field', (e: Record<string, any>) => { delete e.iv; }],
      ['a wrong-length nonce', (e: Record<string, any>) => { e.iv = 'AAAA'; }],
      ['a non-base64 tag', (e: Record<string, any>) => { e.tag = '!'.repeat(24); }],
      ['a different normalization label', (e: Record<string, any>) => { e.passphraseNormalization = 'NFD'; }],
    ])('rejects %s as not a valid backup, before any key is derived', async (_name, change) => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('not-a-backup', () => decryptBackup(edit(file, change), PASSPHRASE));
    });
  });

  describe('files that are not backups', () => {
    it.each([
      ['empty', Buffer.alloc(0)],
      ['random bytes', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe])],
      ['plain text', Buffer.from('hello')],
      ['an array', Buffer.from('[]')],
      ['null', Buffer.from('null')],
      ['another JSON document', Buffer.from('{"format":"something-else"}')],
      ['a Workroom export', Buffer.from('{"schemaVersion":1,"algorithm":"aes-256-gcm+scrypt"}')],
    ])('rejects %s', async (_name, file) => {
      await expectCode('not-a-backup', () => decryptBackup(file, PASSPHRASE));
      await expectCode('not-a-backup', () => readBackupEnvelope(file));
    });

    it('rejects a file cut in half', async () => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('not-a-backup', () => decryptBackup(file.subarray(0, file.length >> 1), PASSPHRASE));
    });
  });

  describe('versions', () => {
    it('asks the user to update when the backup is from a newer version', async () => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      const error = await expectCode('unsupported-version', () => decryptBackup(edit(file, e => { e.envelopeVersion = 2; e.extra = 'new field'; }), PASSPHRASE));
      expect(error.message).toMatch(/newer version/);
    });
    it.each([0, -1, 1.5, '1'])('rejects envelope version %j as damaged', async (version) => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode('not-a-backup', () => decryptBackup(edit(file, e => { e.envelopeVersion = version; }), PASSPHRASE));
    });
  });

  describe('key-derivation limits', () => {
    it.each([
      ['far above the maximum', 2 ** 25, 'limit-exceeded'],
      ['just above the maximum', 2 ** 19, 'limit-exceeded'],
      ['not a power of two', 1000, 'not-a-backup'],
      ['below the minimum', 2 ** 4, 'not-a-backup'],
      ['zero', 0, 'not-a-backup'],
      ['negative', -1024, 'not-a-backup'],
    ] as const)('refuses a file asking for a cost %s', async (_name, N, code) => {
      const file = await encryptBackup(samplePayload(), PASSPHRASE, FAST);
      await expectCode(code, () => decryptBackup(edit(file, e => { e.kdf.N = N; }), PASSPHRASE));
    });

    it('refuses to make a backup at an unsupported cost', async () => {
      await expectCode('limit-exceeded', () => encryptBackup(samplePayload(), PASSPHRASE, { kdfLog2N: 9 }));
      await expectCode('limit-exceeded', () => encryptBackup(samplePayload(), PASSPHRASE, { kdfLog2N: 19 }));
    });
  });

  describe('size limits', () => {
    const bomb = Buffer.alloc(4 * 1024 * 1024, 0x61);

    it('stops a payload that expands past the size the header claims', async () => {
      const file = await sealBackupBytes(bomb, PASSPHRASE, { ...FAST, payloadBytes: 1000 });
      await expectCode('invalid-contents', () => decryptBackup(file, PASSPHRASE));
    });

    it('asks zlib to stop at the authenticated size claim, so a bomb is never fully expanded', async () => {
      const file = await sealBackupBytes(bomb, PASSPHRASE, { ...FAST, payloadBytes: 1000 });
      const gunzip = vi.mocked(zlib.gunzip);
      gunzip.mockClear();
      await expectCode('invalid-contents', () => decryptBackup(file, PASSPHRASE));
      expect(gunzip).toHaveBeenCalledTimes(1);
      expect(gunzip.mock.calls[0][1]).toEqual({ maxOutputLength: 1000 });
    });

    it('rejects a payload that is smaller than the size the header claims', async () => {
      const file = await sealBackupBytes(Buffer.from('{"a":1}'), PASSPHRASE, { ...FAST, payloadBytes: 5000 });
      await expectCode('invalid-contents', () => decryptBackup(file, PASSPHRASE));
    });

    it('refuses a header that claims more than the supported maximum, before decrypting', async () => {
      const file = await sealBackupBytes(Buffer.from('{"a":1}'), PASSPHRASE, { ...FAST, payloadBytes: 256 * 1024 * 1024 + 1 });
      await expectCode('not-a-backup', () => decryptBackup(file, PASSPHRASE));
    });

    it('rejects authenticated contents that are not JSON, or not a backup payload', async () => {
      await expectCode('invalid-contents', async () => decryptBackup(await sealBackupBytes(Buffer.from('not json at all'), PASSPHRASE, FAST), PASSPHRASE));
      await expectCode('invalid-contents', async () => decryptBackup(await sealBackupBytes(Buffer.from('{"manifest":{}}'), PASSPHRASE, FAST), PASSPHRASE));
    });
  });
});

describe('backup payload validation', () => {
  const bytes = Buffer.from('content');
  const good = () => createBackupEntry('a.md', 'workspace-files', bytes);

  it('accepts a consistent payload', () => {
    expect(() => validateBackupPayload(samplePayload())).not.toThrow();
  });

  it.each([
    ['../escape.md'], ['/etc/passwd'], ['C:/x.md'], ['a/../b.md'], ['a\\b.md'], ['CON'], ['x.'], ['file\u202etxt.md'],
  ])('rejects the hostile path %j without writing anything', async (logicalPath) => {
    const entries = [{ ...good(), logicalPath }];
    await expectCode('invalid-contents', () => encryptBackup(payloadOf(entries), PASSPHRASE, FAST));
    await expectCode('invalid-contents', () => validateBackupPayload(payloadOf(entries)));
  });

  it('refuses to create an entry with a hostile path', () => {
    expect(() => createBackupEntry('../x', 'workspace-files', bytes)).toThrowError(BackupError);
  });

  it('rejects duplicate, case-colliding and file-versus-folder paths', () => {
    const entry = (logicalPath: string) => createBackupEntry(logicalPath, 'workspace-files', bytes);
    expect(() => validateBackupPayload(payloadOf([entry('a.md'), entry('a.md')]))).toThrowError(/duplicate/);
    expect(() => validateBackupPayload(payloadOf([entry('Notes.md'), entry('notes.md')]))).toThrowError(/case-insensitive/);
    expect(() => validateBackupPayload(payloadOf([entry('evidence'), entry('evidence/summary.md')]))).toThrowError(/file and a folder/);
  });

  it('rejects an entry whose bytes, size or checksum do not agree', () => {
    expect(() => validateBackupPayload(payloadOf([{ ...good(), bytes: Buffer.from('other!!').toString('base64') }]))).toThrowError(/checksum/);
    expect(() => validateBackupPayload(payloadOf([{ ...good(), size: 99 }], { totalBytes: 99 }))).toThrowError(/size does not match/);
    expect(() => validateBackupPayload(payloadOf([{ ...good(), sha256: 'f'.repeat(64) }]))).toThrowError(/checksum/);
  });

  it('rejects non-canonical base64, so equal content has one spelling', () => {
    const entry = good();
    expect(() => validateBackupPayload(payloadOf([{ ...entry, bytes: entry.bytes.replace(/=+$/, '') }]))).toThrowError(/canonical/);
  });

  it('rejects a manifest that disagrees with its entries', () => {
    const entries = [good()];
    expect(() => validateBackupPayload(payloadOf(entries, { entryCount: 2 }))).toThrowError(/count/);
    expect(() => validateBackupPayload(payloadOf(entries, { totalBytes: 1 }))).toThrowError(/size/);
  });

  it('rejects entries from a participant the manifest does not list', () => {
    expect(() => validateBackupPayload(payloadOf([createBackupEntry('a.md', 'someone-else', bytes)]))).toThrowError(/someone-else/);
  });

  it('rejects a participant listed twice and a store for an unknown participant', () => {
    const participant = { id: 'workspace-files', schemaVersion: 1, owner: 'workspace', capability: { commit: 'create-only' as const } };
    expect(() => validateBackupPayload(payloadOf([good()], { participants: [participant, participant] }))).toThrowError(/twice/);
    expect(() => validateBackupPayload(payloadOf([good()], { stores: [{ participant: 'ghost', root: 'primary' }] }))).toThrowError(/ghost/);
  });

  it('rejects unknown fields instead of silently dropping them', () => {
    const payload = payloadOf([good()]);
    expect(() => validateBackupPayload({ ...payload, extra: true })).toThrowError(/malformed/);
    expect(() => validateBackupPayload({ ...payload, manifest: { ...payload.manifest, extra: true } })).toThrowError(/malformed/);
    expect(() => validateBackupPayload({ ...payload, entries: [{ ...good(), extra: 1 }] })).toThrowError(/malformed/);
  });

  it('rejects malformed participant ids and manifests that are not objects', () => {
    expect(() => validateBackupPayload(payloadOf([createBackupEntry('a.md', 'Bad_ID', bytes)]))).toThrowError(/malformed/);
    expect(() => validateBackupPayload(null)).toThrowError(/malformed/);
    expect(() => validateBackupPayload({ manifest: 1, entries: [] })).toThrowError(/malformed/);
  });

  it('enforces the per-file size limit when an entry is created', () => {
    try { createBackupEntry('big.bin', 'workspace-files', Buffer.alloc(BACKUP_MAX_ENTRY_BYTES + 1)); } catch (error) {
      expect((error as BackupError).code).toBe('limit-exceeded');
      return;
    }
    throw new Error('Expected a size error.');
  });
});
