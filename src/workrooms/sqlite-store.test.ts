import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkroomResourcePackageV1 } from './contracts.js';
import { digestResourcePackage, makeResourceFile } from './resource-package.js';
import { createInitialWorkroomState, WorkroomService } from './service.js';
import { WorkroomSqliteStore } from './sqlite-store.js';

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const target of cleanupPaths.splice(0)) {
    const resolved = path.resolve(target);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
});

async function stateFixture() {
  return createInitialWorkroomState({
    roomId: 'room-sqlite-test',
    name: 'SQLite room',
    workspaceId: 'feature-one',
    address: '127.0.0.1',
    port: 4242,
    certificateFingerprint: 'A'.repeat(64),
    password: 'correct horse battery staple',
    hostDisplayName: 'Host',
    bundle: {
      schemaVersion: 1,
      project: { id: 'project-one', name: 'Project One' },
      feature: { id: 'feature-one', goal: 'Persist collaboration', description: 'SQLite persistence test.' },
      repos: [{ id: 'repo-one', name: 'Repo One', remoteUrl: 'https://example.test/repo-one', defaultBranch: 'main' }],
      pinnedResources: [],
      createdAt: new Date().toISOString(),
    },
    documents: { plan: '# Plan\nUnicode: räksmörgås' },
  });
}

async function roomFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-sqlite-store-'));
  cleanupPaths.push(root);
  return { root, roomDir: path.join(root, 'room-sqlite-test'), created: await stateFixture() };
}

function resourceFixture(): WorkroomResourcePackageV1 {
  const draft: WorkroomResourcePackageV1 = {
    manifest: {
      schemaVersion: 1,
      kind: 'skill',
      id: 'sqlite-race-skill',
      version: '0.1.0',
      digest: '0'.repeat(64),
      ownerMemberId: 'pending-owner',
      maintainerMemberIds: [],
      createdAt: new Date().toISOString(),
      dependencies: [],
    },
    files: [
      makeResourceFile('definition.json', JSON.stringify({
        id: 'sqlite-race-skill',
        name: 'sqlite-race-skill',
        description: 'Exercises resource lifecycle coordination.',
        content: '# SQLite race skill',
      })),
      makeResourceFile('SKILL.md', '# SQLite race skill'),
    ],
  };
  return { ...draft, manifest: { ...draft.manifest, digest: digestResourcePackage(draft) } };
}

describe('WorkroomSqliteStore', () => {
  it('creates a verified SQLite database and survives a fresh store instance', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);

    await expect(fs.access(path.join(roomDir, 'workroom.sqlite'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(roomDir, 'room.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(new WorkroomSqliteStore(roomDir).read()).resolves.toEqual(created.state);

    const database = new DatabaseSync(path.join(roomDir, 'workroom.sqlite'), { readOnly: true });
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
    expect(database.prepare('PRAGMA quick_check').get()).toMatchObject({ quick_check: 'ok' });
    database.close();
  });

  it('atomically promotes only one of two concurrently verified databases', async () => {
    const { roomDir, created } = await roomFixture();
    await fs.mkdir(roomDir, { recursive: true });
    const first = new WorkroomSqliteStore(roomDir);
    const second = new WorkroomSqliteStore(roomDir);

    const promoted = await Promise.all([
      (first as any).createVerifiedDatabase(created.state),
      (second as any).createVerifiedDatabase(created.state),
    ]);

    expect(promoted.sort()).toEqual([false, true]);
    await expect(first.read()).resolves.toEqual(created.state);
    expect((await fs.readdir(roomDir)).filter((name) => name.includes('.migrating-'))).toEqual([]);
  });

  it('reads legacy JSON without migrating it, then preserves a backup during explicit migration', async () => {
    const { roomDir, created } = await roomFixture();
    const blobPath = path.join(roomDir, 'blobs', `${'a'.repeat(64)}.json`);
    await fs.mkdir(path.dirname(blobPath), { recursive: true });
    await fs.writeFile(path.join(roomDir, 'room.json'), `${JSON.stringify(created.state, null, 2)}\n`, 'utf8');
    await fs.writeFile(blobPath, '{"preserved":true}\n', 'utf8');
    const staleMigration = path.join(roomDir, 'workroom.sqlite.migrating-999999-12345678-1234-1234-1234-123456789abc');
    await fs.writeFile(staleMigration, 'interrupted migration copy', 'utf8');
    const store = new WorkroomSqliteStore(roomDir);

    await expect(store.read()).resolves.toEqual(created.state);
    await expect(fs.access(path.join(roomDir, 'workroom.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });

    await store.migrateLegacy();

    await expect(store.read()).resolves.toEqual(created.state);
    await expect(fs.access(path.join(roomDir, 'room.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(roomDir, 'room.v1.json.backup'), 'utf8')).resolves.toContain('SQLite room');
    await expect(fs.readFile(blobPath, 'utf8')).resolves.toContain('preserved');
    await expect(fs.access(staleMigration)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves invalid legacy JSON untouched and creates no authoritative database', async () => {
    const { roomDir } = await roomFixture();
    await fs.mkdir(roomDir, { recursive: true });
    await fs.writeFile(path.join(roomDir, 'room.json'), '{not-json', 'utf8');
    const store = new WorkroomSqliteStore(roomDir);

    await expect(store.migrateLegacy()).rejects.toThrow(/legacy Workroom JSON is invalid/i);
    await expect(fs.readFile(path.join(roomDir, 'room.json'), 'utf8')).resolves.toBe('{not-json');
    await expect(fs.access(path.join(roomDir, 'workroom.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finishes archiving legacy JSON after an interrupted database promotion', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);
    await fs.writeFile(path.join(roomDir, 'room.json'), `${JSON.stringify(created.state, null, 2)}\n`, 'utf8');

    await store.migrateLegacy();

    await expect(store.read()).resolves.toEqual(created.state);
    await expect(fs.access(path.join(roomDir, 'room.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(roomDir, 'room.v1.json.backup'), 'utf8')).resolves.toContain('SQLite room');
  });

  it('makes concurrent legacy migration promotion idempotent', async () => {
    const { root, roomDir, created } = await roomFixture();
    await fs.mkdir(roomDir, { recursive: true });
    await fs.writeFile(path.join(roomDir, 'room.json'), `${JSON.stringify(created.state, null, 2)}\n`, 'utf8');
    const aliasDir = path.join(root, 'room-alias');
    await fs.symlink(roomDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    const first = new WorkroomSqliteStore(roomDir);
    const second = new WorkroomSqliteStore(aliasDir);

    await expect(Promise.all([first.migrateLegacy(), second.migrateLegacy()])).resolves.toEqual([undefined, undefined]);
    await expect(first.read()).resolves.toEqual(created.state);
    await expect(fs.readFile(path.join(roomDir, 'room.v1.json.backup'), 'utf8')).resolves.toContain('SQLite room');
  });

  it('fails closed on a corrupt authoritative database instead of using an older backup', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);
    await fs.writeFile(path.join(roomDir, 'room.v1.json.backup'), `${JSON.stringify(created.state)}\n`, 'utf8');
    await fs.writeFile(path.join(roomDir, 'workroom.sqlite'), 'not a sqlite database', 'utf8');

    await expect(store.read()).rejects.toThrow(/authoritative Workroom SQLite database could not be read/i);
    await expect(fs.readFile(path.join(roomDir, 'room.v1.json.backup'), 'utf8')).resolves.toContain('SQLite room');
  });

  it('fails closed when valid SQLite contains a state with a bad digest', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);
    const database = new DatabaseSync(path.join(roomDir, 'workroom.sqlite'));
    database.prepare('UPDATE workroom_state SET state_digest = ? WHERE singleton = 1').run('0'.repeat(64));
    database.close();

    await expect(store.read()).rejects.toThrow(/state digest is invalid/i);
  });

  it('preserves divergent SQLite and legacy states for manual recovery', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);
    const divergent = { ...created.state, name: 'Divergent legacy room' };
    await fs.writeFile(path.join(roomDir, 'room.json'), `${JSON.stringify(divergent, null, 2)}\n`, 'utf8');

    await expect(store.migrateLegacy()).rejects.toThrow(/states exist but differ/i);
    await expect(store.read()).resolves.toEqual(created.state);
    await expect(fs.readFile(path.join(roomDir, 'room.json'), 'utf8')).resolves.toContain('Divergent legacy room');
    await expect(fs.access(path.join(roomDir, 'room.v1.json.backup'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a newer storage schema without changing its WAL journal mode', async () => {
    const { roomDir, created } = await roomFixture();
    const store = new WorkroomSqliteStore(roomDir);
    await store.initialize(created.state);
    const database = new DatabaseSync(path.join(roomDir, 'workroom.sqlite'));
    expect(database.prepare('PRAGMA journal_mode = WAL').get()).toMatchObject({ journal_mode: 'wal' });
    database.exec('PRAGMA user_version = 2;');
    database.close();

    await expect(store.read()).rejects.toThrow(/uses SQLite storage version 2/i);
    const inspection = new DatabaseSync(path.join(roomDir, 'workroom.sqlite'), { readOnly: true });
    expect(inspection.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    inspection.close();
  });

  it('serializes separate store instances so concurrent updates are both retained', async () => {
    const { roomDir, created } = await roomFixture();
    const first = new WorkroomSqliteStore(roomDir);
    const second = new WorkroomSqliteStore(roomDir);
    await first.initialize(created.state);
    let releaseSlow!: () => void;
    let markSlowStarted!: () => void;
    const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });

    const slowMutation = first.mutate(async (state) => {
      markSlowStarted();
      await slowReleased;
      return { state: { ...state, revision: state.revision + 1, name: 'Slow writer' }, result: undefined };
    });
    await slowStarted;
    const secondMutation = second.mutate((state) => ({
      state: { ...state, revision: state.revision + 1, name: 'Winning writer' },
      result: undefined,
    }));
    releaseSlow();

    await expect(Promise.all([slowMutation, secondMutation])).resolves.toEqual([undefined, undefined]);
    await expect(first.read()).resolves.toMatchObject({ name: 'Winning writer', revision: created.state.revision + 2 });
  });

  it('serializes same-process mutations reached through a directory alias', async () => {
    const { root, roomDir, created } = await roomFixture();
    const first = new WorkroomSqliteStore(roomDir);
    await first.initialize(created.state);
    const aliasDir = path.join(root, 'mutation-alias');
    await fs.symlink(roomDir, aliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    const second = new WorkroomSqliteStore(aliasDir);
    let releaseSlow!: () => void;
    let markSlowStarted!: () => void;
    const slowReleased = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });

    const firstMutation = first.mutate(async (state) => {
      markSlowStarted();
      await slowReleased;
      return { state: { ...state, revision: state.revision + 1, name: 'First alias writer' }, result: undefined };
    });
    await slowStarted;
    const secondMutation = second.mutate((state) => ({
      state: { ...state, revision: state.revision + 1, name: 'Second alias writer' },
      result: undefined,
    }));
    setTimeout(releaseSlow, 50);

    await expect(Promise.all([firstMutation, secondMutation])).resolves.toEqual([undefined, undefined]);
    await expect(first.read()).resolves.toMatchObject({ name: 'Second alias writer', revision: created.state.revision + 2 });
  });

  it('coordinates package pruning and failed-publisher cleanup across store instances', async () => {
    const { roomDir, created } = await roomFixture();
    const firstStore = new WorkroomSqliteStore(roomDir);
    const secondStore = new WorkroomSqliteStore(roomDir);
    await firstStore.initialize(created.state);
    const firstService = new WorkroomService(firstStore);
    const secondService = new WorkroomService(secondStore);
    const pkg = resourceFixture();
    let releaseFirstWrite!: () => void;
    let markFirstWriteComplete!: () => void;
    let markSecondPruneComplete!: () => void;
    const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteComplete = new Promise<void>((resolve) => { markFirstWriteComplete = resolve; });
    const secondPruneComplete = new Promise<void>((resolve) => { markSecondPruneComplete = resolve; });
    const originalFirstWrite = firstStore.writePackage.bind(firstStore);
    const originalSecondPrune = secondStore.pruneUnreferencedPackages.bind(secondStore);
    firstStore.writePackage = async (candidate) => {
      await originalFirstWrite(candidate);
      markFirstWriteComplete();
      await firstWriteReleased;
    };
    secondStore.pruneUnreferencedPackages = async () => {
      await originalSecondPrune();
      markSecondPruneComplete();
    };

    const firstPublish = firstService.publishResource(created.hostToken, pkg);
    await firstWriteComplete;
    const secondPublish = secondService.publishResource(created.hostToken, pkg);
    const prunedWhileFirstWasUncommitted = await Promise.race([
      secondPruneComplete.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 150)),
    ]);
    releaseFirstWrite();
    const outcomes = await Promise.allSettled([firstPublish, secondPublish]);

    expect(prunedWhileFirstWasUncommitted).toBe(false);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const committed = await firstStore.read();
    expect(committed.resources).toHaveLength(1);
    await expect(firstStore.readPackage(committed.resources[0]!.digest)).resolves.toBeDefined();
  });
});
