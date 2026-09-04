import * as fs from 'node:fs/promises';
import * as https from 'node:https';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  WORKROOM_SCHEMA_VERSION,
  WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES,
  WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES,
  WorkroomAuthorizationError,
  WorkroomRevisionError,
  WorkroomValidationError,
  type PortableFeatureBundleV1,
  type WorkroomResourcePackageV1,
} from './contracts.js';
import { PinnedWorkroomClient, formatWorkroomInvite, parseWorkroomInvite } from './client.js';
import { digestResourcePackage, makeResourceFile, validateResourcePackage } from './resource-package.js';
import { applyCachedResource, assertLocalResourceCompatibility, cacheResourcePackage, digestLocalResourceDefinition, getLocalResourceDefinition, packageLocalResource } from './local-resources.js';
import { assertResourceCatalogStorageSize, createInitialWorkroomState, WorkroomService } from './service.js';
import { WorkroomSqliteStore } from './sqlite-store.js';
import { digestPortableWorkroomContext, normalizeGitRemote, scanPortableContextWarnings } from './portable.js';
import { validateWorkroomExportPayload, WorkroomManager } from './manager.js';
import { assertExportPlaintextSize, decryptExport, encryptedExportSchema, encryptExport } from './crypto.js';
import { saveSkill } from '../utils/skills-catalog.js';
import { createWorkroomApp, discardQuarantinedWorkroom, listPausedWorkrooms, listQuarantinedWorkrooms, prepareHostedWorkroomCredentialRotation, resumeHostedWorkroom, startHostedWorkroom, type HostedWorkroom } from './host.js';

const cleanupPaths: string[] = [];
const hosted: HostedWorkroom[] = [];

afterEach(async () => {
  await Promise.all(hosted.splice(0).map((item) => item.stop().catch(() => {})));
  for (const target of cleanupPaths.splice(0)) {
    const resolved = path.resolve(target);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, { recursive: true, force: true });
  }
});

function bundle(): PortableFeatureBundleV1 {
  return {
    schemaVersion: WORKROOM_SCHEMA_VERSION,
    project: { id: 'project-one', name: 'Project One' },
    feature: { id: 'feature-one', goal: 'Collaborate safely', description: 'Synthetic test feature.' },
    repos: [{ id: 'repo-one', name: 'Repo One', remoteUrl: 'https://example.test/repo-one', defaultBranch: 'main' }],
    pinnedResources: [],
    createdAt: new Date().toISOString(),
  };
}

async function serviceFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-test-'));
  cleanupPaths.push(root);
  const roomDir = path.join(root, 'room-one');
  const created = await createInitialWorkroomState({
    roomId: 'room-one',
    name: 'Test room',
    workspaceId: 'feature-one',
    address: '127.0.0.1',
    port: 4242,
    certificateFingerprint: 'A'.repeat(64),
    password: 'correct horse battery staple',
    hostDisplayName: 'Host',
    bundle: bundle(),
    documents: { plan: '# Plan' },
  });
  const store = new WorkroomSqliteStore(roomDir);
  await store.initialize(created.state);
  return { service: new WorkroomService(store), hostToken: created.hostToken, hostAgentToken: created.hostAgentToken };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function resourcePackage(overrides: Partial<WorkroomResourcePackageV1> = {}): WorkroomResourcePackageV1 {
  const draft: WorkroomResourcePackageV1 = {
    manifest: {
      schemaVersion: 1,
      kind: 'skill',
      id: 'review-skill',
      version: '0.1.0',
      digest: '0'.repeat(64),
      ownerMemberId: 'pending-owner',
      maintainerMemberIds: [],
      createdAt: new Date().toISOString(),
      dependencies: [],
    },
    files: [
      makeResourceFile('definition.json', JSON.stringify({ id: 'review-skill', name: 'review-skill', description: 'Review safely', content: '# Review' }, null, 2)),
      makeResourceFile('SKILL.md', '# Review'),
    ],
    ...overrides,
  };
  return { ...draft, manifest: { ...draft.manifest, digest: digestResourcePackage(draft) } };
}

describe('Workroom portable contracts', () => {
  it('normalizes provider remotes without leaking credentials', () => {
    expect(normalizeGitRemote('https://token:secret@GitHub.com/Org/Repo.git?token=bad', 'Repo'))
      .toBe('https://github.com/Org/Repo');
    expect(normalizeGitRemote('git@dev.azure.com:org/project/_git/repo', 'Repo'))
      .toBe('https://dev.azure.com/org/project/_git/repo');
    expect(normalizeGitRemote('C:\\Users\\developer\\secret-repo', 'Repo'))
      .toMatch(/^unrecognized:\/\/repo\/[a-f0-9]{16}$/);
    expect(normalizeGitRemote('C:private-repo', 'Repo'))
      .toMatch(/^unrecognized:\/\/repo\/[a-f0-9]{16}$/);
  });

  it('round-trips a password-free invite URI', () => {
    const invite = formatWorkroomInvite({
      schemaVersion: 1,
      url: 'https://10.0.0.7:4242',
      roomId: 'room-one',
      token: 'a'.repeat(43),
      fingerprint: 'AB'.repeat(32),
    });
    expect(invite).not.toContain('password');
    expect(parseWorkroomInvite(invite).roomId).toBe('room-one');
  });

  it('warns before reviewed context includes secrets, diffs, paths, or transcripts', () => {
    const warnings = scanPortableContextWarnings('api_key=secret-value-123\ndiff --git a/x b/x\nC:\\Users\\dev\\repo\nassistant: copied text');
    expect(warnings.join(' ')).toMatch(/secret/i);
    expect(warnings.join(' ')).toMatch(/diff/i);
    expect(warnings.join(' ')).toMatch(/path/i);
    expect(warnings.join(' ')).toMatch(/transcript/i);
  });

  it('rejects package traversal, case collisions, and digest tampering', () => {
    const traversal = resourcePackage({ files: [makeResourceFile('SKILL.md', '# Review'), { path: '../escape', contentBase64: 'YQ==' }] });
    traversal.manifest.digest = digestResourcePackage(traversal);
    expect(() => validateResourcePackage(traversal)).toThrow(WorkroomValidationError);

    const collision = resourcePackage({ files: [makeResourceFile('A.txt', 'a'), makeResourceFile('a.TXT', 'b')] });
    collision.manifest.digest = digestResourcePackage(collision);
    expect(() => validateResourcePackage(collision)).toThrow(/case-colliding/);

    const windowsInvalid = resourcePackage();
    windowsInvalid.files.push({ path: 'scripts/setup.ps1:payload', contentBase64: 'YQ==' });
    windowsInvalid.manifest.digest = digestResourcePackage(windowsInvalid);
    expect(() => validateResourcePackage(windowsInvalid)).toThrow(/unsupported resource path/i);

    const unpairedSurrogate = resourcePackage();
    unpairedSurrogate.files.push({ path: 'scripts/\ud800.txt', contentBase64: 'YQ==' });
    unpairedSurrogate.manifest.digest = digestResourcePackage(unpairedSurrogate);
    expect(() => validateResourcePackage(unpairedSurrogate)).toThrow(/unpaired UTF-16 surrogate/i);

    const nonNormalizedUnicode = resourcePackage();
    nonNormalizedUnicode.files.push({ path: 'references/e\u0301.md', contentBase64: 'YQ==' });
    nonNormalizedUnicode.manifest.digest = digestResourcePackage(nonNormalizedUnicode);
    expect(() => validateResourcePackage(nonNormalizedUnicode)).toThrow(/NFC-normalized Unicode/i);

    const tampered = resourcePackage();
    tampered.files[1]!.contentBase64 = Buffer.from('changed').toString('base64');
    expect(() => validateResourcePackage(tampered)).toThrow(/digest/);

    const identityMismatch = resourcePackage();
    identityMismatch.files[0]!.contentBase64 = Buffer.from(JSON.stringify({ id: 'other-skill', name: 'other-skill', content: '# Hidden' })).toString('base64');
    identityMismatch.manifest.digest = digestResourcePackage(identityMismatch);
    expect(() => validateResourcePackage(identityMismatch)).toThrow(/definition ID/i);
  });

  it('rejects package files that are not bound by the reviewed definition', () => {
    const ghost = resourcePackage();
    ghost.files.push(makeResourceFile('scripts/ghost.sh', '#!/bin/sh\necho ghost\n', 0o755));
    ghost.manifest.digest = digestResourcePackage(ghost);
    expect(() => validateResourcePackage(ghost)).toThrow(/exactly match/i);
  });

  it('uses locale-independent UTF-8 ordering for Unicode package paths', () => {
    const first = resourcePackage({ files: [
      makeResourceFile('definition.json', JSON.stringify({ id: 'review-skill', name: 'review-skill', description: 'Review', content: '# Review' })),
      makeResourceFile('ä.txt', 'umlaut'),
      makeResourceFile('z.txt', 'zed'),
    ] });
    const second = { ...first, files: [...first.files].reverse() };
    expect(digestResourcePackage(first)).toBe(digestResourcePackage(second));
  });

  it('frames package structure so file-boundary bytes cannot collide', () => {
    const ambiguousContent = Buffer.concat([
      Buffer.from('x'), Buffer.from([0]), Buffer.from('b'), Buffer.from([0]),
      Buffer.from('0'), Buffer.from([0]), Buffer.from('y'),
    ]);
    const oneFile = resourcePackage({ files: [makeResourceFile('a', ambiguousContent)] });
    const twoFiles = resourcePackage({ files: [makeResourceFile('a', 'x'), makeResourceFile('b', 'y')] });
    expect(digestResourcePackage(oneFile)).not.toBe(digestResourcePackage(twoFiles));
  });

  it('binds confirmation to both portable metadata and the exact selected documents', () => {
    const empty = { plan: '', decisions: '', handoff: '' };
    const reviewed = { ...empty, plan: '# Reviewed plan' };
    expect(digestPortableWorkroomContext(bundle(), empty)).not.toBe(digestPortableWorkroomContext(bundle(), reviewed));
  });
});

describe('Workroom service', () => {
  it('requires host approval, issues no server-side plaintext device token, and enforces revisions', async () => {
    const { service, hostToken } = await serviceFixture();
    const invite = await service.createInvite(hostToken);
    const deviceToken = 'd'.repeat(43);
    const join = await service.requestJoin({
      roomId: 'room-one',
      inviteToken: invite.token,
      password: 'correct horse battery staple',
      displayName: 'Guest',
      deviceToken,
      agentToken: 'a'.repeat(43),
      sourceKey: '127.0.0.2',
    });
    expect((await service.getJoinStatus(join.requestId, deviceToken)).status).toBe('pending');
    await expect(service.snapshot(deviceToken)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await service.decideJoin(hostToken, join.requestId, true);
    expect((await service.getJoinStatus(join.requestId, deviceToken)).status).toBe('accepted');
    await expect(service.requestJoin({
      roomId: 'room-one', inviteToken: invite.token, password: 'correct horse battery staple',
      displayName: 'Replay', deviceToken: 'r'.repeat(43), sourceKey: '127.0.0.3',
      agentToken: 'q'.repeat(43),
    })).rejects.toThrow(/Invalid or expired/);

    const updated = await service.updateDocument(deviceToken, 'plan', '# Shared plan', 0);
    expect(updated.revision).toBe(1);
    await expect(service.updateDocument(hostToken, 'plan', '# Stale', 0)).rejects.toBeInstanceOf(WorkroomRevisionError);

    const stored = await service.store.read();
    expect(JSON.stringify(stored)).not.toContain(deviceToken);
    expect(JSON.stringify(stored)).not.toContain('a'.repeat(43));
    expect(stored.documents.plan.history).toHaveLength(1);
  });

  it('revokes both human and agent credentials when the host rotates access', async () => {
    const { service, hostToken } = await serviceFixture();
    const invite = await service.createInvite(hostToken);
    const deviceToken = 'h'.repeat(43);
    const agentToken = 'g'.repeat(43);
    const join = await service.requestJoin({
      roomId: 'room-one', inviteToken: invite.token, password: 'correct horse battery staple',
      displayName: 'Guest', deviceToken, agentToken, sourceKey: 'rotation-test',
    });
    await service.decideJoin(hostToken, join.requestId, true);
    await expect(service.snapshot(deviceToken)).resolves.toMatchObject({ roomId: 'room-one' });
    await expect(service.snapshot(agentToken)).resolves.toMatchObject({ roomId: 'room-one' });
    await service.rotatePassword(hostToken, 'replacement horse battery staple', true);
    await expect(service.snapshot(deviceToken)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await expect(service.snapshot(agentToken)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await expect(service.snapshot(hostToken)).resolves.toMatchObject({ roomId: 'room-one' });
  });

  it('consumes invitations once and rate-limits repeated failures', async () => {
    const { service, hostToken } = await serviceFixture();
    const invite = await service.createInvite(hostToken);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.requestJoin({
        roomId: 'room-one', inviteToken: invite.token, password: 'wrong-password',
        displayName: 'Guest', deviceToken: `x${'d'.repeat(42)}`, sourceKey: 'attacker',
        agentToken: `a${'d'.repeat(42)}`,
      })).rejects.toThrow();
    }
    await expect(service.requestJoin({
      roomId: 'room-one', inviteToken: invite.token, password: 'correct horse battery staple',
      displayName: 'Guest', deviceToken: `y${'d'.repeat(42)}`, sourceKey: 'attacker',
      agentToken: `b${'d'.repeat(42)}`,
    })).rejects.toThrow(/Too many/);
  });

  it('rejects distributed unknown invitations before password hashing without locking out a valid invite', async () => {
    const { service, hostToken } = await serviceFixture();
    let passwordVerifications = 0;
    const guardedService = new WorkroomService(service.store, async (password) => {
      passwordVerifications += 1;
      return password === 'correct horse battery staple';
    });
    const invite = await guardedService.createInvite(hostToken);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await expect(guardedService.requestJoin({
        roomId: 'room-one',
        inviteToken: `${String(attempt).padStart(3, '0')}${'x'.repeat(40)}`,
        password: 'wrong-password-value',
        displayName: 'Distributed attacker',
        deviceToken: `${String(attempt).padStart(3, '0')}${'d'.repeat(40)}`,
        agentToken: `${String(attempt).padStart(3, '0')}${'a'.repeat(40)}`,
        sourceKey: `source-${attempt}`,
      })).rejects.toThrow(/Invalid or expired/);
    }
    expect(passwordVerifications).toBe(0);
    expect((await guardedService.store.read()).attemptWindows).toEqual([]);

    await expect(guardedService.requestJoin({
      roomId: 'room-one',
      inviteToken: invite.token,
      password: 'correct horse battery staple',
      displayName: 'Legitimate guest',
      deviceToken: 'l'.repeat(43),
      agentToken: 'g'.repeat(43),
      sourceKey: 'legitimate-source',
    })).resolves.toMatchObject({ status: 'pending' });
    expect(passwordVerifications).toBe(1);
  });

  it('limits distributed password hashing per invitation without locking the room', async () => {
    const { service, hostToken } = await serviceFixture();
    let passwordVerifications = 0;
    const guardedService = new WorkroomService(service.store, async (password) => {
      passwordVerifications += 1;
      return password === 'correct horse battery staple';
    });
    const attackedInvite = await guardedService.createInvite(hostToken);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await expect(guardedService.requestJoin({
        roomId: 'room-one', inviteToken: attackedInvite.token, password: 'wrong-password-value',
        displayName: 'Distributed attacker', deviceToken: `${String(attempt).padStart(3, '0')}${'d'.repeat(40)}`,
        agentToken: `${String(attempt).padStart(3, '0')}${'a'.repeat(40)}`, sourceKey: `distributed-${attempt}`,
      })).rejects.toThrow(/Invalid or expired/);
    }
    await expect(guardedService.requestJoin({
      roomId: 'room-one', inviteToken: attackedInvite.token, password: 'wrong-password-value',
      displayName: 'Distributed attacker', deviceToken: 'x'.repeat(43), agentToken: 'y'.repeat(43), sourceKey: 'distributed-final',
    })).rejects.toThrow(/invitation is temporarily limiting/i);
    expect(passwordVerifications).toBe(20);

    const freshInvite = await guardedService.createInvite(hostToken);
    await expect(guardedService.requestJoin({
      roomId: 'room-one', inviteToken: freshInvite.token, password: 'correct horse battery staple',
      displayName: 'Legitimate guest', deviceToken: 'l'.repeat(43), agentToken: 'g'.repeat(43), sourceKey: 'legitimate-source',
    })).resolves.toMatchObject({ status: 'pending' });
    expect(passwordVerifications).toBe(21);
  });

  it('does not hold the room mutation queue while verifying a valid invitation password', async () => {
    const { service, hostToken } = await serviceFixture();
    let signalVerificationStarted!: () => void;
    let releaseVerification!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { signalVerificationStarted = resolve; });
    const verificationRelease = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const guardedService = new WorkroomService(service.store, async () => {
      signalVerificationStarted();
      await verificationRelease;
      return false;
    });
    const invite = await guardedService.createInvite(hostToken);
    const joinAttempt = guardedService.requestJoin({
      roomId: 'room-one', inviteToken: invite.token, password: 'wrong-password-value',
      displayName: 'Slow verifier', deviceToken: 'v'.repeat(43), agentToken: 'w'.repeat(43), sourceKey: 'slow-verifier',
    });
    await verificationStarted;

    const mutationResult = await Promise.race([
      service.updateDocument(hostToken, 'plan', '# Mutation remained available', 0).then(() => 'completed' as const),
      new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 500)),
    ]);
    releaseVerification();
    await expect(joinAttempt).rejects.toThrow(/Invalid or expired/);
    expect(mutationResult).toBe('completed');
  });

  it('limits resource publication by role and preserves immutable versions', async () => {
    const { service, hostToken } = await serviceFixture();
    const invite = await service.createInvite(hostToken);
    const deviceToken = 'm'.repeat(43);
    const join = await service.requestJoin({
      roomId: 'room-one', inviteToken: invite.token, password: 'correct horse battery staple',
      displayName: 'Publisher', deviceToken, agentToken: 'n'.repeat(43), sourceKey: 'publisher-source',
    });
    await service.decideJoin(hostToken, join.requestId, true);
    const memberId = (await service.getJoinStatus(join.requestId, deviceToken)).memberId!;
    await expect(service.publishResource(deviceToken, resourcePackage())).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await service.setParticipantRole(hostToken, memberId, 'publisher');
    const first = await service.publishResource(deviceToken, resourcePackage());
    expect(first.manifest.ownerMemberId).toBe(memberId);
    await expect(service.publishResource(hostToken, resourcePackage())).rejects.toThrow(/immutable/);

    const secondInvite = await service.createInvite(hostToken);
    const otherDevice = 'o'.repeat(43);
    const otherJoin = await service.requestJoin({
      roomId: 'room-one', inviteToken: secondInvite.token, password: 'correct horse battery staple',
      displayName: 'Other publisher', deviceToken: otherDevice, agentToken: 'p'.repeat(43), sourceKey: 'other-publisher',
    });
    await service.decideJoin(hostToken, otherJoin.requestId, true);
    const otherMemberId = (await service.getJoinStatus(otherJoin.requestId, otherDevice)).memberId!;
    await service.setParticipantRole(hostToken, otherMemberId, 'publisher');
    const nextVersion = resourcePackage();
    nextVersion.manifest.version = '0.2.0';
    nextVersion.manifest.digest = digestResourcePackage(nextVersion);
    await expect(service.publishResource(otherDevice, nextVersion)).rejects.toThrow(/owner, a maintainer, or the host/);
    await service.quarantineResource(hostToken, first.manifest.digest);
    await expect(service.getResource(deviceToken, first.manifest.digest)).rejects.toThrow(/quarantined/);
    expect((await service.store.createExportPayload()).packages).toEqual([]);
    await expect(service.purgeResource(deviceToken, first.manifest.digest)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await service.purgeResource(hostToken, first.manifest.digest);
    await expect(service.store.readPackage(first.manifest.digest)).rejects.toThrow();
    const purgedState = await service.store.read();
    expect(purgedState.resources).toEqual([]);
    expect(purgedState.activity.at(-1)?.type).toBe('resource.purged');
  });

  it('enforces resource platform and NexusFlow compatibility before cache or apply', () => {
    expect(() => assertLocalResourceCompatibility({}, 'win32', '2.8.0')).not.toThrow();
    expect(() => assertLocalResourceCompatibility({
      compatibility: { platforms: ['win32', 'linux'], nexusflow: '>=2.7.0 <3.0.0' },
    }, 'linux', '2.8.0')).not.toThrow();
    expect(() => assertLocalResourceCompatibility({
      compatibility: { platforms: ['darwin'] },
    }, 'linux', '2.8.0')).toThrow(/does not support.*linux/i);
    expect(() => assertLocalResourceCompatibility({
      compatibility: { nexusflow: '>=2.9.0' },
    }, 'win32', '2.8.0')).toThrow(/requires NexusFlow/i);
    expect(() => assertLocalResourceCompatibility({
      compatibility: { nexusflow: '^2.8.0' },
    }, 'win32', '2.8.0')).toThrow(/space-separated/i);
  });

  it('rejects a workflow package whose Markdown would install under another workflow ID', () => {
    const definition = { id: 'workflow-a', name: 'Workflow A', description: 'Reviewed workflow.', content: '# Workflow B\n\nUnsafe target.' };
    const draft: WorkroomResourcePackageV1 = {
      manifest: {
        schemaVersion: 1, kind: 'workflow', id: 'workflow-a', version: '0.1.0', digest: '0'.repeat(64),
        ownerMemberId: 'pending-owner', maintainerMemberIds: [], createdAt: new Date().toISOString(), dependencies: [],
      },
      files: [
        makeResourceFile('definition.json', JSON.stringify(definition, null, 2)),
        makeResourceFile('WORKFLOW.md', definition.content),
        makeResourceFile('workflow.json', JSON.stringify({ schemaVersion: 1, id: 'workflow-a', version: '0.1.0', steps: [] }, null, 2)),
      ],
    };
    const pkg = { ...draft, manifest: { ...draft.manifest, digest: digestResourcePackage(draft) } };
    expect(() => validateResourcePackage(pkg)).toThrow(/heading.*reviewed manifest ID/i);
  });

  it('removes an unreferenced package blob when the room state commit fails', async () => {
    const { service, hostToken } = await serviceFixture();
    const originalMutate = service.store.mutate.bind(service.store);
    (service.store as any).mutate = (operation: any) => originalMutate(async (state) => {
      await operation(state);
      throw new Error('synthetic state commit failure');
    });

    await expect(service.publishResource(hostToken, resourcePackage())).rejects.toThrow(/synthetic state commit failure/);
    expect(await fs.readdir(path.join(service.store.roomDir, 'blobs'))).toEqual([]);
    expect((await service.store.read()).resources).toEqual([]);
  });

  it('reconciles a package blob after a transient purge unlink failure', async () => {
    const { service, hostToken } = await serviceFixture();
    const first = await service.publishResource(hostToken, resourcePackage());
    await service.quarantineResource(hostToken, first.manifest.digest);
    const removePackage = service.store.removePackage.bind(service.store);
    let failOnce = true;
    service.store.removePackage = async (digest: string) => {
      if (failOnce) {
        failOnce = false;
        throw Object.assign(new Error('synthetic Windows file lock'), { code: 'EPERM' });
      }
      await removePackage(digest);
    };

    await expect(service.purgeResource(hostToken, first.manifest.digest)).resolves.toBeUndefined();
    await expect(service.store.readPackage(first.manifest.digest)).resolves.toBeDefined();
    await expect(service.publishResource(hostToken, resourcePackage())).resolves.toMatchObject({
      manifest: { digest: first.manifest.digest },
    });
    expect((await service.store.read()).resources).toHaveLength(1);
    await expect(service.store.readPackage(first.manifest.digest)).resolves.toBeDefined();
  });

  it('keeps remote snapshots bounded while retaining a limited host-local history', async () => {
    const { service, hostToken } = await serviceFixture();
    const content = 'x'.repeat(200 * 1024);
    for (let revision = 0; revision < 12; revision += 1) {
      await service.updateDocument(hostToken, 'plan', `${revision}${content}`, revision);
    }
    const snapshot = await service.snapshot(hostToken);
    expect(snapshot.documents.plan.history).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(snapshot), 'utf8')).toBeLessThan(2 * 1024 * 1024);
    expect((await service.store.read()).documents.plan.history).toHaveLength(10);
  });

  it('rechecks member capacity on acceptance and compacts retained membership history', async () => {
    const { service, hostToken } = await serviceFixture();
    const at = new Date().toISOString();
    await service.store.mutate((state) => ({
      state: {
        ...state,
        participants: [
          ...state.participants,
          ...Array.from({ length: 499 }, (_, index) => ({
            id: `member-capacity-${index}`,
            displayName: `Member ${index}`,
            role: 'member' as const,
            joinedAt: at,
            lastSeenAt: at,
            deviceTokenHash: `${index}`.padStart(64, '0'),
            agentTokenHash: `${index + 500}`.padStart(64, '0'),
          })),
        ],
        joinRequests: [{
          id: 'join-at-capacity',
          displayName: 'Waiting member',
          deviceTokenHash: 'd'.repeat(64),
          agentTokenHash: 'e'.repeat(64),
          requestedAt: at,
          sourceKey: 'test',
          status: 'pending' as const,
        }],
      },
      result: undefined,
    }));

    await expect(service.decideJoin(hostToken, 'join-at-capacity', true)).rejects.toThrow(/member limit/i);
    await service.revokeParticipant(hostToken, 'member-capacity-0');
    await service.decideJoin(hostToken, 'join-at-capacity', true);
    const stored = await service.store.read();
    expect(stored.participants).toHaveLength(500);
    expect(stored.participants.filter((participant) => !participant.revokedAt)).toHaveLength(500);
    expect(stored.joinRequests).toHaveLength(1);
  });

  it('keeps workflow completion as a human-confirmed transition', async () => {
    const { service, hostToken, hostAgentToken } = await serviceFixture();
    await service.selectWorkflow(hostToken, {
      schemaVersion: 1,
      id: 'review-flow',
      version: '0.1.0',
      name: 'Review Flow',
      description: 'Propose, then confirm.',
      markdown: '# Review Flow',
      steps: [{ id: 'verify', title: 'Verify', requiresEvidence: true }],
      dependencies: [],
    }, 0);
    await expect(service.proposeWorkflowStep(hostToken, 'verify', 0, 'not an agent credential')).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await expect(service.transitionWorkflowStep(hostAgentToken, 'verify', 'completed', 0)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await expect(service.transitionWorkflowStep(hostToken, 'verify', 'completed', 0)).rejects.toThrow(/requires evidence/i);
    await expect(service.selectWorkflow(hostToken, {
      schemaVersion: 1,
      id: 'stale-replacement',
      version: '0.1.0',
      name: 'Stale Replacement',
      description: '',
      markdown: '# Stale Replacement',
      steps: [],
      dependencies: [],
    }, 0)).rejects.toBeInstanceOf(WorkroomRevisionError);
    const proposed = await service.proposeWorkflowStep(hostAgentToken, 'verify', 0, '7 tests passed');
    expect(proposed.status).toBe('completion_proposed');
    const confirmed = await service.transitionWorkflowStep(hostToken, 'verify', 'completed', proposed.revision);
    expect(confirmed.status).toBe('completed');
    expect(confirmed.evidence).toBe('7 tests passed');
    await expect(service.proposeWorkflowStep(hostAgentToken, 'verify', confirmed.revision, 'replace human evidence'))
      .rejects.toThrow(/terminal human/i);
    const retainedProgress = (await service.snapshot(hostAgentToken)).workflowProgress;
    expect(retainedProgress?.package.markdown).toBe('# Review Flow');
    expect(retainedProgress?.steps[0]).toMatchObject({
      status: 'completed',
      evidence: '7 tests passed',
      revision: confirmed.revision,
    });
    await expect(service.transitionWorkflowStep(hostToken, 'verify', 'completion_proposed', confirmed.revision)).rejects.toThrow(/scoped agent/);
  });

  it('bounds aggregate workflow evidence by UTF-8 bytes so snapshots remain readable', async () => {
    const { service, hostToken } = await serviceFixture();
    await service.selectWorkflow(hostToken, {
      schemaVersion: 1,
      id: 'evidence-budget',
      version: '0.1.0',
      name: 'Evidence Budget',
      description: 'Exercise the aggregate evidence limit.',
      markdown: '# Evidence Budget',
      steps: Array.from({ length: 33 }, (_, index) => ({ id: `step-${index}`, title: `Step ${index}`, requiresEvidence: true })),
      dependencies: [],
    }, 0);
    const sixteenKiB = 'é'.repeat(8 * 1024);
    for (let index = 0; index < 32; index += 1) {
      await service.transitionWorkflowStep(hostToken, `step-${index}`, 'in_progress', 0, sixteenKiB);
    }
    await expect(service.transitionWorkflowStep(hostToken, 'step-32', 'in_progress', 0, sixteenKiB)).rejects.toThrow(/512 KiB/);
    await expect(service.transitionWorkflowStep(hostToken, 'step-32', 'in_progress', 0, 'é'.repeat(9 * 1024))).rejects.toThrow(/16 KiB/);
    expect(Buffer.byteLength(JSON.stringify(await service.snapshot(hostToken)), 'utf8')).toBeLessThan(2 * 1024 * 1024);
  });

  it('rejects browser-originated requests on the narrow remote API', async () => {
    const { service } = await serviceFixture();
    const response = await createWorkroomApp(service).request('/v1/health', { headers: { Origin: 'https://evil.example' } });
    expect(response.status).toBe(403);
  });

  it('bounds concurrent authenticated snapshot reads per credential', async () => {
    const { service, hostAgentToken } = await serviceFixture();
    const originalSnapshot = service.snapshot.bind(service);
    let entered = 0;
    let releaseReads!: () => void;
    let readsEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseReads = resolve; });
    const admitted = new Promise<void>((resolve) => { readsEntered = resolve; });
    service.snapshot = async (token: string) => {
      entered += 1;
      if (entered === 2) readsEntered();
      await release;
      return originalSnapshot(token);
    };
    const app = createWorkroomApp(service);
    const headers = { Authorization: `Bearer ${hostAgentToken}` };
    const active = Array.from({ length: 2 }, () => app.request('/v1/snapshot', { headers }));
    await admitted;
    const rejected = await app.request('/v1/snapshot', { headers });
    expect(rejected.status).toBe(429);
    releaseReads();
    await expect(Promise.all(active)).resolves.toHaveLength(2);
  });

  it('bounds concurrent invalid credential checks before room state parsing', async () => {
    const { service } = await serviceFixture();
    let entered = 0;
    let releaseChecks!: () => void;
    let twoChecksEntered!: () => void;
    const release = new Promise<void>((resolve) => { releaseChecks = resolve; });
    const admitted = new Promise<void>((resolve) => { twoChecksEntered = resolve; });
    service.authorizeRead = async () => {
      entered += 1;
      if (entered === 2) twoChecksEntered();
      await release;
      throw new WorkroomAuthorizationError();
    };
    const app = createWorkroomApp(service);
    const active = ['x'.repeat(43), 'y'.repeat(43)].map((token) => app.request('/v1/snapshot', {
      headers: { Authorization: `Bearer ${token}` },
    }));
    await admitted;
    const rejected = await app.request('/v1/snapshot', {
      headers: { Authorization: `Bearer ${'z'.repeat(43)}` },
    });
    expect(rejected.status).toBe(429);
    expect(entered).toBe(2);
    releaseChecks();
    expect((await Promise.all(active)).map((response) => response.status)).toEqual([401, 401]);
  });

  it('rejects oversized unauthenticated join bodies before parsing or password hashing', async () => {
    const { service } = await serviceFixture();
    const response = await createWorkroomApp(service).request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(20 * 1024) }),
    });
    expect(response.status).toBe(413);
  });

  it('authenticates protected routes before parsing their request bodies', async () => {
    const { service, hostToken, hostAgentToken } = await serviceFixture();
    for (const [pathname, method] of [
      ['/v1/documents/plan', 'PUT'],
      ['/v1/handoff', 'POST'],
      ['/v1/resources', 'POST'],
      ['/v1/workflow/select', 'POST'],
      ['/v1/workflow/steps/verify/transition', 'POST'],
      ['/v1/workflow/steps/verify/propose', 'POST'],
    ] as const) {
      const response = await createWorkroomApp(service).request(pathname, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      });
      expect(response.status, pathname).toBe(401);
    }
    for (const [pathname, method] of [
      ['/v1/documents/plan', 'PUT'],
      ['/v1/handoff', 'POST'],
      ['/v1/resources', 'POST'],
      ['/v1/workflow/select', 'POST'],
      ['/v1/workflow/steps/verify/transition', 'POST'],
    ] as const) {
      const response = await createWorkroomApp(service).request(pathname, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostAgentToken}` },
        body: '{not-json',
      });
      expect(response.status, `${pathname} must reject agent authority`).toBe(401);
    }
    const oversizedDocument = await createWorkroomApp(service).request('/v1/documents/plan', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hostToken}` },
      body: JSON.stringify({ content: 'x'.repeat(600 * 1024), expectedRevision: 0 }),
    });
    expect(oversizedDocument.status).toBe(413);
  });
});

describe('resource review and apply', () => {
  it('installs only the reviewed definition.json and requires digest-bound approval', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-resource-'));
    cleanupPaths.push(root);
    const previous = process.env.NEXUSFLOW_HOME;
    process.env.NEXUSFLOW_HOME = root;
    try {
      const definition = {
        id: 'review-agent',
        name: 'review-agent',
        category: 'general',
        description: 'Reviewed agent',
        developerInstructions: 'Use only the exact reviewed instructions.',
      };
      const draft: WorkroomResourcePackageV1 = {
        manifest: {
          schemaVersion: 1,
          kind: 'agent',
          id: 'review-agent',
          version: '0.1.0',
          digest: '0'.repeat(64),
          ownerMemberId: 'pending-owner',
          maintainerMemberIds: [],
          createdAt: new Date().toISOString(),
          dependencies: [],
        },
        files: [makeResourceFile('definition.json', JSON.stringify(definition, null, 2))],
      };
      const pkg = { ...draft, manifest: { ...draft.manifest, digest: digestResourcePackage(draft) } };
      const cachePath = await cacheResourcePackage('room-review', pkg);
      const missingLocalDigest = digestLocalResourceDefinition(undefined);
      await expect(applyCachedResource('room-review', pkg.manifest.digest, '0'.repeat(64), missingLocalDigest)).rejects.toThrow(/approval/i);
      const applied = await applyCachedResource('room-review', pkg.manifest.digest, pkg.manifest.digest, missingLocalDigest);
      if (applied.kind !== 'agent') throw new Error('Expected an agent resource.');
      expect(applied.resource.developerInstructions).toBe(definition.developerInstructions);
      const changedDefinition = { ...definition, developerInstructions: 'Changed after review.' };
      const changedDraft = { ...pkg, manifest: { ...pkg.manifest, digest: '0'.repeat(64) }, files: [makeResourceFile('definition.json', JSON.stringify(changedDefinition, null, 2))] };
      const changed = { ...changedDraft, manifest: { ...changedDraft.manifest, digest: digestResourcePackage(changedDraft) } };
      await fs.writeFile(cachePath, JSON.stringify(changed), 'utf8');
      const currentLocalDigest = digestLocalResourceDefinition(await getLocalResourceDefinition('agent', 'review-agent'));
      await expect(applyCachedResource('room-review', pkg.manifest.digest, pkg.manifest.digest, currentLocalDigest)).rejects.toThrow(/changed after review/i);
    } finally {
      if (previous === undefined) delete process.env.NEXUSFLOW_HOME;
      else process.env.NEXUSFLOW_HOME = previous;
    }
  });

  it('round-trips a custom skill with hydrated reference and script files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-skill-'));
    cleanupPaths.push(root);
    const previous = process.env.NEXUSFLOW_HOME;
    process.env.NEXUSFLOW_HOME = root;
    try {
      await saveSkill({
        id: 'support-skill',
        name: 'support-skill',
        description: 'Skill with supporting files.',
        content: '# Support skill\n\nUse the files.',
        references: [{ name: 'guide.md', relativePath: 'references/guide.md', content: '# Guide' }],
        scripts: [{ name: 'check.sh', relativePath: 'scripts/check.sh', content: '#!/bin/sh\necho checked\n' }],
      });
      const pkg = await packageLocalResource('skill', 'support-skill', '0.1.0');
      expect(pkg.files.map((file) => file.path)).toEqual(expect.arrayContaining(['definition.json', 'SKILL.md', 'references/guide.md', 'scripts/check.sh']));
      await cacheResourcePackage('support-room', pkg);
      const skillDir = path.resolve(root, 'skills', 'support-skill');
      expect(skillDir.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
      await fs.rm(skillDir, { recursive: true, force: true });
      await applyCachedResource('support-room', pkg.manifest.digest, pkg.manifest.digest, digestLocalResourceDefinition(undefined));
      expect(await fs.readFile(path.join(skillDir, 'references', 'guide.md'), 'utf8')).toBe('# Guide');
      expect(await fs.readFile(path.join(skillDir, 'scripts', 'check.sh'), 'utf8')).toBe('#!/bin/sh\necho checked\n');
    } finally {
      if (previous === undefined) delete process.env.NEXUSFLOW_HOME;
      else process.env.NEXUSFLOW_HOME = previous;
    }
  });

  it('refuses to overwrite a local resource changed after package review', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-local-revision-'));
    cleanupPaths.push(root);
    const previous = process.env.NEXUSFLOW_HOME;
    process.env.NEXUSFLOW_HOME = root;
    try {
      await saveSkill({
        id: 'revision-skill', name: 'revision-skill', description: 'Revision-bound skill.', content: '# Reviewed local version',
      });
      const incoming = await packageLocalResource('skill', 'revision-skill', '0.1.0');
      await cacheResourcePackage('revision-room', incoming);
      const reviewedLocalDigest = digestLocalResourceDefinition(await getLocalResourceDefinition('skill', 'revision-skill'));

      await saveSkill({
        id: 'revision-skill', name: 'revision-skill', description: 'Revision-bound skill.', content: '# Newer local edit',
      });
      await expect(applyCachedResource(
        'revision-room', incoming.manifest.digest, incoming.manifest.digest, reviewedLocalDigest,
      )).rejects.toThrow(/local resource changed after review/i);
      expect((await getLocalResourceDefinition('skill', 'revision-skill'))?.content).toBe('# Newer local edit');
    } finally {
      if (previous === undefined) delete process.env.NEXUSFLOW_HOME;
      else process.env.NEXUSFLOW_HOME = previous;
    }
  });

  it('rejects native skill trees that Workrooms cannot transfer without loss', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-skill-tree-'));
    cleanupPaths.push(root);
    const previous = process.env.NEXUSFLOW_HOME;
    process.env.NEXUSFLOW_HOME = root;
    try {
      const skill = await saveSkill({
        id: 'asset-skill',
        name: 'asset-skill',
        description: 'Skill with a native asset.',
        content: '# Asset skill',
      });
      await fs.mkdir(path.join(skill.sourcePath!, 'assets'));
      await fs.writeFile(path.join(skill.sourcePath!, 'assets', 'diagram.png'), Buffer.from([1, 2, 3]));
      await expect(packageLocalResource('skill', 'asset-skill', '0.1.0')).rejects.toThrow(/avoid dropping files/i);
    } finally {
      if (previous === undefined) delete process.env.NEXUSFLOW_HOME;
      else process.env.NEXUSFLOW_HOME = previous;
    }
  });
});

describe('encrypted export admission', () => {
  it('validates the complete payload before import can start a listener', async () => {
    const { service } = await serviceFixture();
    const payload = await service.store.createExportPayload();
    expect(validateWorkroomExportPayload(payload).packages).toEqual([]);

    const invalidDocument = structuredClone(payload);
    invalidDocument.room.documents.plan.name = 'handoff';
    expect(() => validateWorkroomExportPayload(invalidDocument)).toThrow(/plan document/i);

    const invalidPackage = structuredClone(payload);
    invalidPackage.packages.push(resourcePackage());
    expect(() => validateWorkroomExportPayload(invalidPackage)).toThrow(/catalog/i);
  });

  it('keeps generated encryption envelopes inside the importer limit', async () => {
    assertExportPlaintextSize(WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES);
    expect(() => assertExportPlaintextSize(WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES + 1)).toThrow(/96 MiB/);
    assertResourceCatalogStorageSize(WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES - 1, 1);
    expect(() => assertResourceCatalogStorageSize(WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES, 1)).toThrow(/40 MiB/);
    expect(Math.ceil(WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES * 4 / 3)).toBeLessThan(144 * 1024 * 1024);
    const envelope = await encryptExport({ schemaVersion: 1, room: 'round-trip' }, 'correct horse battery staple');
    expect(encryptedExportSchema.safeParse(envelope).success).toBe(true);
    await expect(decryptExport(envelope, 'correct horse battery staple')).resolves.toEqual({ schemaVersion: 1, room: 'round-trip' });

    const tampered = { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -4)}AAAA` };
    await expect(decryptExport(tampered, 'correct horse battery staple')).rejects.toThrow();
    expect(encryptedExportSchema.safeParse({ ...envelope, ciphertext: '!' }).success).toBe(false);
  });

  it('imports a validated export through the runtime manager and can stop it cleanly', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-import-success-'));
    cleanupPaths.push(root);
    const { service } = await serviceFixture();
    const envelope = await encryptExport(await service.store.createExportPayload(), 'portable export passphrase');
    const manager = new WorkroomManager(root);
    const status = await manager.importRoom(envelope, 'portable export passphrase', {
      address: '127.0.0.1', port: await freePort(), password: 'replacement room password', hostDisplayName: 'Import host',
    });
    expect(status).toMatchObject({ mode: 'host', name: 'Test room', localWorkspaceId: 'feature-one' });
    await manager.stopOrLeave();
    await expect(manager.status()).resolves.toEqual({ mode: 'idle' });
  });

  it('quarantines an import when credential persistence fails after listener creation', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-import-failure-'));
    cleanupPaths.push(root);
    await fs.mkdir(path.join(root, 'workrooms'), { recursive: true });
    await fs.writeFile(path.join(root, 'workrooms', 'active'), 'blocks the credential directory');
    const { service } = await serviceFixture();
    const envelope = await encryptExport(await service.store.createExportPayload(), 'portable export passphrase');
    const manager = new WorkroomManager(root);
    await expect(manager.importRoom(envelope, 'portable export passphrase', {
      address: '127.0.0.1', port: await freePort(), password: 'replacement room password', hostDisplayName: 'Import host',
    })).rejects.toThrow();
    await expect(manager.status()).resolves.toEqual({ mode: 'idle' });
    const quarantined = await manager.listQuarantined();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ status: 'failed', workspaceId: 'feature-one' });
  });
});

describe('pinned HTTPS host/client', () => {
  it('keeps one live dashboard owner for each workspace credential and conditionally removes it', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-active-owner-'));
    cleanupPaths.push(root);
    const first = new WorkroomManager(root);
    const second = new WorkroomManager(root);
    await first.startHost({
      name: 'First owner', workspaceId: 'feature-one', address: '127.0.0.1', port: await freePort(),
      password: 'correct horse battery staple', hostDisplayName: 'Host', bundle: bundle(), documents: { plan: '', decisions: '', handoff: '' },
    });
    try {
      await expect(second.startHost({
        name: 'Second owner', workspaceId: 'feature-one', address: '127.0.0.1', port: await freePort(),
        password: 'correct horse battery staple', hostDisplayName: 'Host', bundle: bundle(), documents: { plan: '', decisions: '', handoff: '' },
      })).rejects.toThrow(/already owns/i);
      const activeDir = path.join(root, 'workrooms', 'active');
      const activeFiles = (await fs.readdir(activeDir)).filter((file) => file.endsWith('.json'));
      expect(activeFiles).toHaveLength(1);
      const credential = JSON.parse(await fs.readFile(path.join(activeDir, activeFiles[0]!), 'utf8'));
      expect(credential).toMatchObject({ workspaceId: 'feature-one', ownerPid: process.pid });
      await second.stopOrLeave();
      expect((await fs.readdir(activeDir)).filter((file) => file.endsWith('.json'))).toHaveLength(1);
    } finally {
      await first.stopOrLeave();
    }
    expect((await fs.readdir(path.join(root, 'workrooms', 'active'))).filter((file) => file.endsWith('.json'))).toEqual([]);
  }, 30_000);

  it('does not persist a remote workspace identity without an explicit local mapping', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-unmapped-guest-'));
    cleanupPaths.push(root);
    const manager = new WorkroomManager(root) as any;
    const snapshot = {
      schemaVersion: 1,
      roomId: 'room-one',
      name: 'Remote room',
      bundle: { feature: { id: 'remote-feature-id' } },
    };
    manager.guest = {
      status: 'pending', requestId: 'join-one', deviceToken: 'd'.repeat(43), agentToken: 'a'.repeat(43),
      displayName: 'Guest', localWorkspaceId: undefined,
      client: { joinStatus: async () => ({ status: 'accepted' as const, memberId: 'member-one' }) },
      agentClient: { snapshot: async () => snapshot },
      invite: { roomId: 'room-one', url: 'https://127.0.0.1:4242', fingerprint: 'AA' },
    };
    manager.activeRoomChanged();
    await expect(manager.pollJoin()).resolves.toMatchObject({
      mode: 'guest', status: 'accepted', localWorkspaceId: undefined,
    });
    expect(await fs.readdir(path.join(root, 'workrooms', 'active')).catch(() => [])).toEqual([]);
    await manager.stopOrLeave();
  });

  it('waits for an in-flight lifecycle change before terminal shutdown and coalesces stop calls', async () => {
    const manager = new WorkroomManager() as any;
    manager.lifecycleState = 'joining';
    const firstStop = manager.stopOrLeave();
    expect(manager.stopOrLeave()).toBe(firstStop);
    let stopped = false;
    void firstStop.then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    expect(() => manager.beginLifecycle('starting')).toThrow(/shutting down/i);

    manager.endLifecycle('joining');
    await firstStop;
    expect(stopped).toBe(true);
    await expect(manager.status()).resolves.toEqual({ mode: 'idle' });
  });

  it('binds human authority to one active generation and waits for authorized operations on stop', async () => {
    const manager = new WorkroomManager() as any;
    manager.guest = { status: 'pending' };
    manager.activeRoomChanged();
    const token = manager.beginHumanSession();
    const authority = manager.assertHumanSession(token);
    let releaseOperation!: () => void;
    const operationRelease = new Promise<void>((resolve) => { releaseOperation = resolve; });
    const operation = manager.runWithHumanAuthority(authority, () => operationRelease);
    const stopping = manager.stopOrLeave(authority);
    await Promise.resolve();
    expect(manager.guest).toBeDefined();
    releaseOperation();
    await Promise.all([operation, stopping]);

    manager.guest = { status: 'pending' };
    manager.activeRoomChanged();
    const nextToken = manager.beginHumanSession();
    await expect(manager.runWithHumanAuthority(authority, async () => undefined)).rejects.toThrow(/changed|human session/i);
    await manager.stopOrLeave(manager.assertHumanSession(nextToken));
  });

  it('serializes delayed join polling with Leave', async () => {
    const manager = new WorkroomManager() as any;
    let releasePoll!: () => void;
    const pollRelease = new Promise<void>((resolve) => { releasePoll = resolve; });
    manager.guest = {
      status: 'pending', requestId: 'join-one', deviceToken: 'd'.repeat(43),
      client: { joinStatus: async () => { await pollRelease; return { status: 'rejected' as const }; } },
      agentClient: {}, invite: { roomId: 'room-one', url: 'https://127.0.0.1:4242', fingerprint: 'AA' },
    };
    manager.activeRoomChanged();
    const polling = manager.pollJoin();
    await Promise.resolve();
    const leaving = manager.stopOrLeave();
    await Promise.resolve();
    expect(manager.guest).toBeDefined();
    releasePoll();
    await Promise.all([polling, leaving]);
    expect(manager.guest).toBeUndefined();
    await expect(manager.status()).resolves.toEqual({ mode: 'idle' });
  });

  it('leaves an accepted offline guest without making a remote snapshot request', async () => {
    const manager = new WorkroomManager() as any;
    let remoteSnapshots = 0;
    manager.guest = {
      status: 'accepted', client: { snapshot: async () => { remoteSnapshots += 1; throw new Error('offline'); } },
      agentClient: {}, invite: { roomId: 'room-one', url: 'https://127.0.0.1:4242', fingerprint: 'AA' },
    };
    manager.activeRoomChanged();
    await manager.stopOrLeave();
    expect(remoteSnapshots).toBe(0);
  });

  it('joins end-to-end and hard-fails a fingerprint mismatch', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-host-'));
    cleanupPaths.push(root);
    const port = await freePort();
    const host = await startHostedWorkroom({
      homeDir: root,
      name: 'Pinned room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port,
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: { plan: '# Plan' },
    });
    hosted.push(host);
    const publicClient = new PinnedWorkroomClient(host.url, host.certificateFingerprint);
    expect(host.server.maxConnections).toBe(64);
    expect((await publicClient.health()).roomId).toBe(host.roomId);
    await expect(new PinnedWorkroomClient(host.url, '00'.repeat(32)).health()).rejects.toThrow(/fingerprint mismatch/i);

    const deviceToken = 'z'.repeat(43);
    const agentToken = 'y'.repeat(43);
    const invitation = await host.service.createInvite(host.hostToken);
    const requested = await publicClient.requestJoin({
      roomId: host.roomId,
      inviteToken: invitation.token,
      password: 'correct horse battery staple',
      displayName: 'Linux guest',
      deviceToken,
      agentToken,
    });
    await host.service.decideJoin(host.hostToken, requested.requestId, true);
    const memberClient = new PinnedWorkroomClient(host.url, host.certificateFingerprint, deviceToken);
    expect((await memberClient.snapshot()).participants.map((item) => item.displayName)).toContain('Linux guest');
    await host.service.selectWorkflow(host.hostToken, {
      schemaVersion: 1,
      id: 'remote-review',
      version: '0.1.0',
      name: 'Remote Review',
      description: 'Verify remote credential scopes.',
      markdown: '# Remote Review',
      steps: [{ id: 'verify', title: 'Verify', requiresEvidence: true }],
      dependencies: [],
    }, 0);
    const agentClient = new PinnedWorkroomClient(host.url, host.certificateFingerprint, agentToken);
    const proposed = await agentClient.proposeWorkflowStep('verify', 0, 'Remote tests passed.');
    await expect(agentClient.transitionWorkflowStep('verify', 'completed', proposed.step.revision)).rejects.toBeInstanceOf(WorkroomAuthorizationError);
    await expect(memberClient.transitionWorkflowStep('verify', 'completed', proposed.step.revision)).resolves.toMatchObject({ step: { status: 'completed' } });

    const serializedManager = new WorkroomManager();
    const serializedInvitation = await host.service.createInvite(host.hostToken);
    const serializedInviteText = formatWorkroomInvite({
      schemaVersion: 1,
      url: host.url,
      roomId: host.roomId,
      token: serializedInvitation.token,
      fingerprint: host.certificateFingerprint,
    });
    const joining = serializedManager.join(serializedInviteText, 'correct horse battery staple', 'Serialized guest');
    await expect(serializedManager.join(serializedInviteText, 'correct horse battery staple', 'Duplicate guest'))
      .rejects.toThrow(/already joining/i);
    await expect(joining).resolves.toMatchObject({ mode: 'guest', status: 'pending' });
    await serializedManager.stopOrLeave();
  }, 30_000);

  it('pauses and resumes from host-local state without changing its identity', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-resume-'));
    cleanupPaths.push(root);
    const port = await freePort();
    const first = await startHostedWorkroom({
      homeDir: root,
      name: 'Resumable room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port,
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: { plan: '# Plan' },
    });
    const originalRoomId = first.roomId;
    const originalFingerprint = first.certificateFingerprint;
    const persistedCredential = await fs.readFile(path.join(first.roomDir, 'host-credential.json'), 'utf8');
    expect(persistedCredential).not.toContain(first.hostToken);
    expect(persistedCredential).toContain(first.hostAgentToken);
    await prepareHostedWorkroomCredentialRotation(first.roomDir, first.hostToken, first.hostAgentToken, 'unused replacement password');
    await first.stop();
    expect((await listPausedWorkrooms(root)).map((room) => room.roomId)).toContain(originalRoomId);
    await expect(resumeHostedWorkroom(root, originalRoomId, 'incorrect password')).rejects.toThrow(/password/i);
    const resumed = await resumeHostedWorkroom(root, originalRoomId, 'correct horse battery staple');
    hosted.push(resumed);
    expect(resumed.roomId).toBe(originalRoomId);
    expect(resumed.certificateFingerprint).toBe(originalFingerprint);
    expect(await fs.readFile(path.join(first.roomDir, 'host-credential.pending.json'), 'utf8').catch(() => undefined)).toBeUndefined();
    expect((await new PinnedWorkroomClient(resumed.url, originalFingerprint).health()).roomId).toBe(originalRoomId);
  }, 30_000);

  it('migrates legacy JSON only after the host password is verified', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-legacy-resume-'));
    cleanupPaths.push(root);
    const room = await startHostedWorkroom({
      homeDir: root,
      name: 'Legacy resumable room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port: await freePort(),
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: { plan: '# Legacy plan' },
    });
    const state = await room.service.store.read();
    await room.stop();
    await fs.writeFile(path.join(room.roomDir, 'room.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.unlink(path.join(room.roomDir, 'workroom.sqlite'));

    await expect(resumeHostedWorkroom(root, room.roomId, 'incorrect password')).rejects.toThrow(/password/i);
    await expect(fs.access(path.join(room.roomDir, 'room.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(room.roomDir, 'workroom.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });

    const resumed = await resumeHostedWorkroom(root, room.roomId, 'correct horse battery staple');
    hosted.push(resumed);
    await expect(fs.access(path.join(room.roomDir, 'workroom.sqlite'))).resolves.toBeUndefined();
    await expect(fs.readFile(path.join(room.roomDir, 'room.v1.json.backup'), 'utf8')).resolves.toContain('# Legacy plan');
    expect((await resumed.service.snapshot(resumed.hostToken)).documents.plan.content).toBe('# Legacy plan');
  }, 30_000);

  it('recovers an interrupted two-phase password credential promotion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-resume-password-drift-'));
    cleanupPaths.push(root);
    const room = await startHostedWorkroom({
      homeDir: root,
      name: 'Password drift room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port: await freePort(),
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: {},
    });
    await prepareHostedWorkroomCredentialRotation(
      room.roomDir,
      room.hostToken,
      room.hostAgentToken,
      'replacement horse battery staple',
    );
    await room.service.rotatePassword(room.hostToken, 'replacement horse battery staple', false);
    await room.stop();

    await expect(resumeHostedWorkroom(root, room.roomId, 'correct horse battery staple')).rejects.toThrow(/password/i);
    const recovered = await resumeHostedWorkroom(root, room.roomId, 'replacement horse battery staple');
    hosted.push(recovered);
    expect(await fs.readFile(path.join(room.roomDir, 'host-credential.pending.json'), 'utf8').catch(() => undefined)).toBeUndefined();
    expect((await recovered.service.snapshot(recovered.hostToken)).roomId).toBe(room.roomId);
  }, 30_000);

  it('refuses direct resume of a room quarantined after a failed import', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-failed-import-'));
    cleanupPaths.push(root);
    const port = await freePort();
    const room = await startHostedWorkroom({
      homeDir: root,
      name: 'Failed import room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port,
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: {},
    });
    await room.stop();
    await expect(discardQuarantinedWorkroom(root, room.roomId)).rejects.toThrow(/Only a quarantined/);
    await fs.writeFile(path.join(room.roomDir, 'import-failed.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
    expect((await listPausedWorkrooms(root)).map((candidate) => candidate.roomId)).not.toContain(room.roomId);
    expect(await listQuarantinedWorkrooms(root)).toContainEqual(expect.objectContaining({ roomId: room.roomId, status: 'failed' }));
    await expect(resumeHostedWorkroom(root, room.roomId, 'correct horse battery staple')).rejects.toThrow(/quarantined/i);
    await fs.unlink(path.join(room.roomDir, 'import-failed.json'));
    await fs.writeFile(path.join(room.roomDir, 'import-in-progress.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
    expect((await listPausedWorkrooms(root)).map((candidate) => candidate.roomId)).not.toContain(room.roomId);
    expect(await listQuarantinedWorkrooms(root)).toContainEqual(expect.objectContaining({ roomId: room.roomId, status: 'in-progress' }));
    await expect(resumeHostedWorkroom(root, room.roomId, 'correct horse battery staple')).rejects.toThrow(/quarantined/i);
    await discardQuarantinedWorkroom(root, room.roomId);
    await expect(fs.access(room.roomDir)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('stops promptly even while an authenticated event stream is open', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-workroom-stream-'));
    cleanupPaths.push(root);
    const port = await freePort();
    const host = await startHostedWorkroom({
      homeDir: root,
      name: 'Streaming room',
      workspaceId: 'feature-one',
      address: '127.0.0.1',
      port,
      password: 'correct horse battery staple',
      hostDisplayName: 'Host',
      bundle: bundle(),
      documents: {},
    });
    hosted.push(host);
    const request = https.request(`${host.url}/v1/events`, {
      rejectUnauthorized: false,
      headers: { Authorization: `Bearer ${host.hostAgentToken}` },
    });
    await new Promise<void>((resolve, reject) => {
      request.once('response', () => resolve());
      request.once('error', reject);
      request.end();
    });
    const startedAt = Date.now();
    const stopPromise = host.stop();
    expect(host.stop()).toBe(stopPromise);
    await stopPromise;
    expect(Date.now() - startedAt).toBeLessThan(2_500);
    request.destroy();
  }, 30_000);
});
