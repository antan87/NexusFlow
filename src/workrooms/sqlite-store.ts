import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createMutationQueue, getErrorCode } from '../core/locks.js';
import { atomicWriteJson } from '../resources/fs-safety.js';
import {
  WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES,
  WorkroomRevisionError,
  WorkroomValidationError,
  type WorkroomResourcePackageV1,
} from './contracts.js';
import {
  parseStoredWorkroom,
  type StoredWorkroomV1,
  type WorkroomExportPayloadV1,
  type WorkroomMutation,
  type WorkroomStore,
} from './store.js';

const SQLITE_STORAGE_VERSION = 1;
const DATABASE_FILE = 'workroom.sqlite';
const LEGACY_STATE_FILE = 'room.json';
const LEGACY_BACKUP_FILE = 'room.v1.json.backup';

type MutationQueue = ReturnType<typeof createMutationQueue>;
const mutationQueues = new Map<string, MutationQueue>();

function mutationQueueFor(roomDir: string): MutationQueue {
  const resolved = path.resolve(roomDir);
  // Existing rooms can be reached through junctions/symlinks. Collapse those
  // aliases so a synchronous SQLite busy wait cannot block another mutation's
  // promise continuation in this same event loop.
  let canonical = resolved;
  try {
    canonical = realpathSync.native(resolved);
  } catch {
    // New rooms do not exist until initialize() creates their blobs directory;
    // canonicalize their already-existing parent so pre/post-create keys agree.
    try {
      canonical = path.join(realpathSync.native(path.dirname(resolved)), path.basename(resolved));
    } catch {}
  }
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const existing = mutationQueues.get(key);
  if (existing) return existing;
  const created = createMutationQueue();
  mutationQueues.set(key, created);
  return created;
}

interface StateRow {
  readonly room_id: string;
  readonly state_schema_version: number;
  readonly revision: number;
  readonly state_json: string;
  readonly state_digest: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stateJson(state: StoredWorkroomV1): string {
  return JSON.stringify(state);
}

function stateDigest(serialized: string): string {
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

function configureConnection(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA busy_timeout = 5000;
  `);
}

function configureWritableDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
  `);
}

function rollbackQuietly(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK;');
  } catch {
    // Preserve the original failure if SQLite already ended the transaction.
  }
}

function createSchema(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE;');
  try {
    database.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE workroom_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        room_id TEXT NOT NULL UNIQUE,
        state_schema_version INTEGER NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        state_json TEXT NOT NULL,
        state_digest TEXT NOT NULL CHECK (length(state_digest) = 64)
      ) STRICT;
    `);
    database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(SQLITE_STORAGE_VERSION, new Date().toISOString());
    database.exec(`PRAGMA user_version = ${SQLITE_STORAGE_VERSION};`);
    database.exec('COMMIT;');
  } catch (error) {
    rollbackQuietly(database);
    throw error;
  }
}

function assertStorageVersion(database: DatabaseSync): void {
  const row = database.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  const version = Number(row?.user_version);
  if (version !== SQLITE_STORAGE_VERSION) {
    throw new WorkroomValidationError(
      version > SQLITE_STORAGE_VERSION
        ? `This Workroom uses SQLite storage version ${version}, but this NexusFlow build supports version ${SQLITE_STORAGE_VERSION}. Upgrade NexusFlow before opening it.`
        : `The Workroom SQLite storage schema is missing or unsupported (version ${version || 0}). Preserve the database and restore or import from a verified backup.`,
    );
  }
  const migration = database.prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as Record<string, unknown> | undefined;
  if (Number(migration?.version) !== SQLITE_STORAGE_VERSION) {
    throw new WorkroomValidationError('The Workroom SQLite migration record is inconsistent. Preserve the database and restore or import from a verified backup.');
  }
}

function openDatabase(databasePath: string, mode: 'read' | 'write' | 'initialize' = 'read'): DatabaseSync {
  const database = new DatabaseSync(databasePath, {
    allowExtension: false,
    readOnly: mode === 'read',
  });
  try {
    configureConnection(database);
    if (mode === 'initialize') {
      configureWritableDatabase(database);
      createSchema(database);
    } else {
      // Check compatibility before applying any persistent PRAGMA. An older
      // NexusFlow build must leave a newer database byte-for-byte under the
      // newer build's control.
      assertStorageVersion(database);
      if (mode === 'write') configureWritableDatabase(database);
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function readStateRow(database: DatabaseSync): { readonly row: StateRow; readonly state: StoredWorkroomV1 } {
  const raw = database.prepare(`
    SELECT room_id, state_schema_version, revision, state_json, state_digest
    FROM workroom_state WHERE singleton = 1
  `).get() as Record<string, unknown> | undefined;
  if (!raw
    || typeof raw.room_id !== 'string'
    || typeof raw.state_json !== 'string'
    || typeof raw.state_digest !== 'string') {
    throw new WorkroomValidationError('The Workroom SQLite database does not contain a valid room state. Preserve it and restore or import from a verified backup.');
  }
  const row: StateRow = {
    room_id: raw.room_id,
    state_schema_version: Number(raw.state_schema_version),
    revision: Number(raw.revision),
    state_json: raw.state_json,
    state_digest: raw.state_digest,
  };
  if (stateDigest(row.state_json) !== row.state_digest) {
    throw new WorkroomValidationError('The Workroom SQLite state digest is invalid. Preserve the database and restore or import from a verified backup.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch {
    throw new WorkroomValidationError('The Workroom SQLite state is not valid JSON. Preserve the database and restore or import from a verified backup.');
  }
  const state = parseStoredWorkroom(parsed);
  if (row.room_id !== state.roomId
    || row.state_schema_version !== state.schemaVersion
    || row.revision !== state.revision) {
    throw new WorkroomValidationError('The Workroom SQLite row metadata does not match its validated state. Preserve the database and restore or import from a verified backup.');
  }
  return { row, state };
}

function insertState(database: DatabaseSync, state: StoredWorkroomV1): void {
  const validated = parseStoredWorkroom(state);
  const serialized = stateJson(validated);
  database.prepare(`
    INSERT INTO workroom_state(singleton, room_id, state_schema_version, revision, state_json, state_digest)
    VALUES (1, ?, ?, ?, ?, ?)
  `).run(validated.roomId, validated.schemaVersion, validated.revision, serialized, stateDigest(serialized));
}

function quickCheck(database: DatabaseSync): void {
  const result = database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
  if (result?.quick_check !== 'ok') {
    throw new WorkroomValidationError('The new Workroom SQLite database failed its integrity check. The existing room data was left untouched.');
  }
}

export class WorkroomSqliteStore implements WorkroomStore {
  private readonly runMutation: MutationQueue;
  private readonly databasePath: string;
  private readonly legacyStatePath: string;
  private readonly legacyBackupPath: string;
  private readonly blobsDir: string;

  constructor(public readonly roomDir: string) {
    this.runMutation = mutationQueueFor(roomDir);
    this.databasePath = path.join(roomDir, DATABASE_FILE);
    this.legacyStatePath = path.join(roomDir, LEGACY_STATE_FILE);
    this.legacyBackupPath = path.join(roomDir, LEGACY_BACKUP_FILE);
    this.blobsDir = path.join(roomDir, 'blobs');
  }

  public async initialize(state: StoredWorkroomV1): Promise<void> {
    return this.runMutation(async () => {
      await fs.mkdir(this.blobsDir, { recursive: true, mode: 0o700 });
      if (await exists(this.databasePath) || await exists(this.legacyStatePath)) {
        throw new Error(`Workroom already exists at ${this.roomDir}.`);
      }
      if (!await this.createVerifiedDatabase(state)) {
        throw new Error(`Workroom already exists at ${this.roomDir}.`);
      }
    });
  }

  public async read(): Promise<StoredWorkroomV1> {
    if (await exists(this.databasePath)) return this.readDatabaseState();
    return this.readLegacyState();
  }

  /**
   * Converts a password-verified legacy room on explicit resume. Merely listing
   * paused rooms calls read() and never mutates their storage.
   */
  public async migrateLegacy(): Promise<void> {
    return this.runMutation(async () => {
      await this.pruneStaleMigrationFiles();
      const databasePresent = await exists(this.databasePath);
      const legacyPresent = await exists(this.legacyStatePath);
      if (databasePresent) {
        const databaseState = await this.readDatabaseState();
        if (legacyPresent) {
          const legacyState = await this.readLegacyState();
          if (stateDigest(stateJson(databaseState)) !== stateDigest(stateJson(legacyState))) {
            throw new WorkroomValidationError('Both SQLite and legacy JSON Workroom states exist but differ. Preserve both files and resolve the migration before resuming.');
          }
          await this.archiveLegacyState();
        }
        return;
      }
      if (!legacyPresent) {
        throw new WorkroomValidationError('No Workroom SQLite database or legacy JSON state was found. Restore or import from a verified backup.');
      }
      const legacyState = await this.readLegacyState();
      if (!await this.createVerifiedDatabase(legacyState)) {
        const databaseState = await this.readDatabaseState();
        if (stateDigest(stateJson(databaseState)) !== stateDigest(stateJson(legacyState))) {
          throw new WorkroomValidationError('A concurrent SQLite migration completed with different Workroom state. Preserve both files and resolve the migration before resuming.');
        }
      }
      await this.archiveLegacyState();
    });
  }

  public async mutate<T>(operation: (current: StoredWorkroomV1) => WorkroomMutation<T> | Promise<WorkroomMutation<T>>): Promise<T> {
    let afterCommit: (() => Promise<void>) | undefined;
    const result = await this.runMutation(async () => {
      if (!await exists(this.databasePath)) {
        throw new WorkroomValidationError('This legacy Workroom must be migrated to SQLite before it can be changed. Resume it with the room password first.');
      }
      const database = openDatabase(this.databasePath, 'write');
      try {
        database.exec('BEGIN IMMEDIATE;');
        const current = readStateRow(database).state;
        const currentSerialized = stateJson(current);
        const currentDigest = stateDigest(currentSerialized);
        const outcome = await operation(clone(current));
        const next = parseStoredWorkroom(outcome.state);
        if (next.roomId !== current.roomId || next.schemaVersion !== current.schemaVersion || next.revision < current.revision) {
          throw new WorkroomValidationError('A Workroom mutation cannot replace its identity, schema, or revision with an older value.');
        }
        const nextSerialized = stateJson(next);
        const update = database.prepare(`
          UPDATE workroom_state
          SET room_id = ?, state_schema_version = ?, revision = ?, state_json = ?, state_digest = ?
          WHERE singleton = 1 AND state_digest = ?
        `).run(
          next.roomId,
          next.schemaVersion,
          next.revision,
          nextSerialized,
          stateDigest(nextSerialized),
          currentDigest,
        );
        if (Number(update.changes) !== 1) {
          rollbackQuietly(database);
          throw new WorkroomRevisionError(current.revision, readStateRow(database).state.revision);
        }
        database.exec('COMMIT;');
        afterCommit = outcome.afterCommit;
        return outcome.result;
      } catch (error) {
        rollbackQuietly(database);
        throw error;
      } finally {
        database.close();
      }
    });
    await afterCommit?.();
    return result;
  }

  public async writePackage(pkg: WorkroomResourcePackageV1): Promise<void> {
    await fs.mkdir(this.blobsDir, { recursive: true, mode: 0o700 });
    const destination = path.join(this.blobsDir, `${pkg.manifest.digest}.json`);
    try {
      await fs.access(destination);
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') {
        await atomicWriteJson(destination, pkg);
        return;
      }
      throw error;
    }
  }

  public async removePackage(digest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid Workroom package digest.');
    return this.runMutation(async () => {
      const database = openDatabase(this.databasePath, 'write');
      try {
        database.exec('BEGIN IMMEDIATE;');
        const state = readStateRow(database).state;
        if (!state.resources.some((resource) => resource.digest === digest)) {
          await fs.unlink(path.join(this.blobsDir, `${digest}.json`)).catch((error: unknown) => {
            if (getErrorCode(error) !== 'ENOENT') throw error;
          });
        }
        database.exec('COMMIT;');
      } catch (error) {
        rollbackQuietly(database);
        throw error;
      } finally {
        database.close();
      }
    });
  }

  public async pruneUnreferencedPackages(): Promise<void> {
    return this.runMutation(async () => {
      const database = openDatabase(this.databasePath, 'write');
      try {
        database.exec('BEGIN IMMEDIATE;');
        const state = readStateRow(database).state;
        const referenced = new Set(state.resources.map((resource) => `${resource.digest}.json`));
        const entries = await fs.readdir(this.blobsDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          if (entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name) && !referenced.has(entry.name)) {
            await fs.unlink(path.join(this.blobsDir, entry.name)).catch(() => {});
          }
        }
        database.exec('COMMIT;');
      } catch (error) {
        rollbackQuietly(database);
        throw error;
      } finally {
        database.close();
      }
    });
  }

  public async readPackage(digest: string): Promise<WorkroomResourcePackageV1> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid package digest.');
    return JSON.parse(await fs.readFile(path.join(this.blobsDir, `${digest}.json`), 'utf8')) as WorkroomResourcePackageV1;
  }

  public async packageStorageBytes(digests: readonly string[]): Promise<number> {
    const sizes = await Promise.all(digests.map(async (digest) => {
      if (!/^[a-f0-9]{64}$/.test(digest)) throw new WorkroomValidationError('Invalid package digest.');
      return (await fs.stat(path.join(this.blobsDir, `${digest}.json`))).size;
    }));
    return sizes.reduce((total, size) => total + size, 0);
  }

  public async createExportPayload(): Promise<WorkroomExportPayloadV1> {
    const state = await this.read();
    const packages = await Promise.all(
      state.resources
        .filter((resource) => !resource.quarantinedAt)
        .map((resource) => this.readPackage(resource.digest)),
    );
    const payload: WorkroomExportPayloadV1 = {
      schemaVersion: 1,
      room: {
        name: state.name,
        workspaceId: state.workspaceId,
        bundle: state.bundle,
        documents: state.documents,
        resources: state.resources.filter((resource) => !resource.quarantinedAt),
        workflowProgress: state.workflowProgress,
        activity: state.activity,
      },
      packages,
      exportedAt: new Date().toISOString(),
    };
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES) {
      throw new WorkroomValidationError('This Workroom exceeds the 96 MiB encrypted export limit. Quarantine large resource versions before exporting.');
    }
    return payload;
  }

  private async readLegacyState(): Promise<StoredWorkroomV1> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(this.legacyStatePath, 'utf8'));
    } catch (error) {
      if (getErrorCode(error) === 'ENOENT') throw error;
      throw new WorkroomValidationError('The legacy Workroom JSON is invalid. It was left untouched; repair it or import a verified export before migrating.');
    }
    try {
      return parseStoredWorkroom(parsed);
    } catch {
      throw new WorkroomValidationError('The legacy Workroom JSON does not match the supported schema. It was left untouched; repair it or import a verified export before migrating.');
    }
  }

  private async readDatabaseState(): Promise<StoredWorkroomV1> {
    let database: DatabaseSync | undefined;
    try {
      database = openDatabase(this.databasePath);
      return readStateRow(database).state;
    } catch (error) {
      if (error instanceof WorkroomValidationError) throw error;
      throw new WorkroomValidationError('The authoritative Workroom SQLite database could not be read. It was not replaced from the older JSON backup; preserve both files and restore or import from a verified backup.');
    } finally {
      database?.close();
    }
  }

  private async createVerifiedDatabase(state: StoredWorkroomV1): Promise<boolean> {
    const validated = parseStoredWorkroom(state);
    const temporaryPath = path.join(this.roomDir, `${DATABASE_FILE}.migrating-${process.pid}-${randomUUID()}`);
    let database: DatabaseSync | undefined;
    try {
      database = openDatabase(temporaryPath, 'initialize');
      database.exec('BEGIN IMMEDIATE;');
      try {
        insertState(database, validated);
        database.exec('COMMIT;');
      } catch (error) {
        rollbackQuietly(database);
        throw error;
      }
      quickCheck(database);
      const roundTrip = readStateRow(database).state;
      if (stateDigest(stateJson(roundTrip)) !== stateDigest(stateJson(validated))) {
        throw new WorkroomValidationError('The new Workroom SQLite database did not preserve the complete room state. The existing data was left untouched.');
      }
      database.close();
      database = undefined;
      await fs.chmod(temporaryPath, 0o600).catch(() => {});
      try {
        // A same-directory hard link publishes the fully closed database only
        // if no competing host has already claimed the authoritative path.
        await fs.link(temporaryPath, this.databasePath);
      } catch (error) {
        if (getErrorCode(error) === 'EEXIST') return false;
        throw error;
      }
      return true;
    } catch (error) {
      database?.close();
      throw error;
    } finally {
      await fs.unlink(temporaryPath).catch(() => {});
    }
  }

  private async archiveLegacyState(): Promise<void> {
    let destination = this.legacyBackupPath;
    if (await exists(destination)) {
      destination = `${this.legacyBackupPath}.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    }
    await fs.rename(this.legacyStatePath, destination).catch((error: unknown) => {
      // Concurrent migrations are idempotent: once another process archived
      // the same validated legacy file, there is nothing left to move.
      if (getErrorCode(error) !== 'ENOENT') throw error;
    });
  }

  private async pruneStaleMigrationFiles(): Promise<void> {
    const entries = await fs.readdir(this.roomDir, { withFileTypes: true }).catch(() => []);
    const temporaryPattern = /^workroom\.sqlite\.migrating-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-journal)?$/;
    await Promise.all(entries
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const match = temporaryPattern.exec(entry.name);
        if (!match) return false;
        try {
          process.kill(Number(match[1]), 0);
          return false;
        } catch (error) {
          return getErrorCode(error) !== 'EPERM';
        }
      })
      .map((entry) => fs.unlink(path.join(this.roomDir, entry.name)).catch(() => {})));
  }
}
