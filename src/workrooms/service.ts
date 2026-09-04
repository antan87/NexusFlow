import { randomUUID } from 'node:crypto';

import {
  WORKROOM_AUDIT_LIMIT,
  WORKROOM_DOCUMENT_HISTORY_LIMIT,
  WORKROOM_INVITE_TTL_MS,
  WORKROOM_MAX_DOCUMENT_BYTES,
  WORKROOM_MAX_PARTICIPANTS,
  WORKROOM_MAX_PENDING_JOINS,
  WORKROOM_MAX_RETAINED_INVITES,
  WORKROOM_MAX_RETAINED_JOIN_REQUESTS,
  WORKROOM_MAX_RESOURCES,
  WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES,
  WORKROOM_MAX_WORKFLOW_EVIDENCE_BYTES,
  WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES,
  WORKROOM_SCHEMA_VERSION,
  WorkroomAuthorizationError,
  WorkroomRevisionError,
  WorkroomValidationError,
  digestWorkflowPackage,
  documentNameSchema,
  portableFeatureBundleSchema,
  portableRepoSchema,
  workflowPackageSchema,
  workflowProgressSchema,
  workflowStepProgressSchema,
  type ImmutableResourceRefV1,
  type PortableFeatureBundleV1,
  type PortableRepoV1,
  type WorkflowPackageV1,
  type WorkflowStepProgressV1,
  type WorkroomDocumentName,
  type WorkroomEventV1,
  type WorkroomParticipantRole,
  type WorkroomResourcePackageV1,
  type WorkroomSnapshotV1,
} from './contracts.js';
import { hashPassword, randomToken, tokenDigest, verifyPassword } from './crypto.js';
import { digestResourcePackage, validateResourcePackage } from './resource-package.js';
import {
  type StoredAttemptWindowV1,
  type StoredInviteV1,
  type StoredJoinRequestV1,
  type StoredParticipantV1,
  type StoredWorkroomV1,
  type WorkroomStore,
} from './store.js';

const FAILED_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const FAILED_ATTEMPT_LOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function nowIso(now = new Date()): string {
  return now.toISOString();
}

export function assertResourceCatalogStorageSize(currentBytes: number, addedBytes: number): void {
  if (!Number.isSafeInteger(currentBytes) || !Number.isSafeInteger(addedBytes) || currentBytes < 0 || addedBytes < 0
    || currentBytes + addedBytes > WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES) {
    throw new WorkroomValidationError('This Workroom has reached its 40 MiB shared resource storage limit.');
  }
}

function shortId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function appendEvent(
  state: StoredWorkroomV1,
  event: Omit<WorkroomEventV1, 'sequence' | 'createdAt'>,
  createdAt = nowIso(),
): StoredWorkroomV1 {
  const next: WorkroomEventV1 = {
    ...event,
    sequence: (state.activity.at(-1)?.sequence ?? 0) + 1,
    createdAt,
  };
  return {
    ...state,
    activity: [...state.activity, next].slice(-WORKROOM_AUDIT_LIMIT),
  };
}

function bump(state: StoredWorkroomV1): StoredWorkroomV1 {
  return { ...state, revision: state.revision + 1 };
}

function publicParticipant(participant: StoredParticipantV1) {
  const { deviceTokenHash: _deviceSecret, agentTokenHash: _agentSecret, ...safe } = participant;
  return safe;
}

function compactParticipants(participants: readonly StoredParticipantV1[]): StoredParticipantV1[] {
  const active = participants.filter((participant) => !participant.revokedAt);
  const revokedCapacity = WORKROOM_MAX_PARTICIPANTS - active.length;
  if (revokedCapacity <= 0) return active;
  const retainedRevoked = participants
    .filter((participant) => participant.revokedAt)
    .slice(-revokedCapacity);
  return [...active, ...retainedRevoked];
}

function compactJoinRequests(requests: readonly StoredJoinRequestV1[]): StoredJoinRequestV1[] {
  const pending = requests.filter((request) => request.status === 'pending');
  const retainedDecided = requests
    .filter((request) => request.status !== 'pending')
    .slice(-(WORKROOM_MAX_RETAINED_JOIN_REQUESTS - pending.length));
  return [...retainedDecided, ...pending];
}

function liveInvites(invites: readonly StoredInviteV1[], now = Date.now()): StoredInviteV1[] {
  return invites.filter((invite) => !invite.usedAt && Date.parse(invite.expiresAt) > now);
}

function rolePermits(actual: WorkroomParticipantRole, allowed: readonly WorkroomParticipantRole[]): boolean {
  return allowed.includes(actual);
}

type CredentialScope = 'human' | 'agent';

function findPrincipal(
  state: StoredWorkroomV1,
  rawToken: string,
  allowed: readonly WorkroomParticipantRole[] = ['host', 'publisher', 'member'],
  allowedScopes: readonly CredentialScope[] = ['human'],
): { readonly actor: StoredParticipantV1; readonly scope: CredentialScope } {
  const digest = tokenDigest(rawToken);
  const actor = state.participants.find((participant) => (
    participant.deviceTokenHash === digest || participant.agentTokenHash === digest
  ) && !participant.revokedAt);
  if (!actor || !rolePermits(actor.role, allowed)) throw new WorkroomAuthorizationError();
  const scope: CredentialScope = actor.deviceTokenHash === digest ? 'human' : 'agent';
  if (!allowedScopes.includes(scope)) throw new WorkroomAuthorizationError();
  return { actor, scope };
}

function findActor(
  state: StoredWorkroomV1,
  rawToken: string,
  allowed: readonly WorkroomParticipantRole[] = ['host', 'publisher', 'member'],
): StoredParticipantV1 {
  return findPrincipal(state, rawToken, allowed, ['human']).actor;
}

function sanitizeDocuments(
  documents: Partial<Record<WorkroomDocumentName, string>>,
  hostMemberId: string,
  createdAt: string,
): StoredWorkroomV1['documents'] {
  const makeDocument = (name: WorkroomDocumentName) => {
    const content = documents[name] ?? '';
    if (Buffer.byteLength(content, 'utf8') > WORKROOM_MAX_DOCUMENT_BYTES) {
      throw new WorkroomValidationError('Shared documents are limited to 256 KiB.');
    }
    return {
      name,
      revision: 0,
      content,
      updatedAt: createdAt,
      updatedBy: hostMemberId,
      history: [],
    };
  };
  return {
    plan: makeDocument('plan'),
    decisions: makeDocument('decisions'),
    handoff: makeDocument('handoff'),
  };
}

export interface CreateWorkroomStateInput {
  readonly roomId: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly address: string;
  readonly port: number;
  readonly certificateFingerprint: string;
  readonly password: string;
  readonly hostDisplayName: string;
  readonly bundle: PortableFeatureBundleV1;
  readonly documents: Partial<Record<WorkroomDocumentName, string>>;
}

export async function createInitialWorkroomState(input: CreateWorkroomStateInput): Promise<{
  readonly state: StoredWorkroomV1;
  readonly hostToken: string;
  readonly hostAgentToken: string;
}> {
  if (input.password.length < 12 || input.password.length > 128) {
    throw new WorkroomValidationError('Workroom passwords must contain 12–128 characters.');
  }
  const bundle = portableFeatureBundleSchema.parse(input.bundle);
  const createdAt = nowIso();
  const hostMemberId = shortId('member');
  const hostToken = randomToken();
  const hostAgentToken = randomToken();
  const host: StoredParticipantV1 = {
    id: hostMemberId,
    displayName: input.hostDisplayName.trim().slice(0, 80) || 'Host',
    role: 'host',
    joinedAt: createdAt,
    lastSeenAt: createdAt,
    deviceTokenHash: tokenDigest(hostToken),
    agentTokenHash: tokenDigest(hostAgentToken),
  };
  let state: StoredWorkroomV1 = {
    schemaVersion: WORKROOM_SCHEMA_VERSION,
    roomId: input.roomId,
    name: input.name.trim().slice(0, 160),
    workspaceId: input.workspaceId,
    address: input.address,
    port: input.port,
    certificateFingerprint: input.certificateFingerprint,
    createdAt,
    revision: 1,
    password: await hashPassword(input.password),
    hostMemberId,
    bundle,
    documents: sanitizeDocuments(input.documents, hostMemberId, createdAt),
    participants: [host],
    invites: [],
    joinRequests: [],
    attemptWindows: [],
    resources: [],
    activity: [],
  };
  state = appendEvent(state, {
    type: 'room.created',
    actorId: hostMemberId,
    summary: 'Workroom created.',
  }, createdAt);
  return { state, hostToken, hostAgentToken };
}

export class WorkroomService {
  private readonly passwordAttemptsByInvite = new Map<string, { readonly startedAt: number; readonly count: number }>();
  private readonly passwordVerificationsInProgress = new Set<string>();

  constructor(
    public readonly store: WorkroomStore,
    private readonly verifyRoomPassword: typeof verifyPassword = verifyPassword,
  ) {}

  private admitInvitePasswordAttempt(inviteHash: string, at: number): void {
    const current = this.passwordAttemptsByInvite.get(inviteHash);
    const live = current && at - current.startedAt < FAILED_ATTEMPT_WINDOW_MS
      ? current
      : { startedAt: at, count: 0 };
    if (live.count >= 20) {
      throw new WorkroomValidationError('This invitation is temporarily limiting password attempts. Ask the host for a new invitation.');
    }
    this.passwordAttemptsByInvite.set(inviteHash, { startedAt: live.startedAt, count: live.count + 1 });
  }

  public async authorizeHuman(
    rawToken: string,
    allowed: readonly WorkroomParticipantRole[] = ['host', 'publisher', 'member'],
  ): Promise<void> {
    findPrincipal(await this.store.read(), rawToken, allowed, ['human']);
  }

  public async authorizeAgent(rawToken: string): Promise<void> {
    findPrincipal(await this.store.read(), rawToken, undefined, ['agent']);
  }

  public async authorizeRead(rawToken: string): Promise<void> {
    findPrincipal(await this.store.read(), rawToken, undefined, ['human', 'agent']);
  }

  public async verifyHostRecoveryPassword(password: string): Promise<boolean> {
    if (password.length < 12 || password.length > 128) return false;
    return this.verifyRoomPassword(password, (await this.store.read()).password);
  }

  public async snapshot(rawToken: string): Promise<WorkroomSnapshotV1> {
    const state = await this.store.read();
    const { actor } = findPrincipal(state, rawToken, undefined, ['human', 'agent']);
    return {
      schemaVersion: WORKROOM_SCHEMA_VERSION,
      roomId: state.roomId,
      name: state.name,
      address: state.address,
      port: state.port,
      certificateFingerprint: state.certificateFingerprint,
      revision: state.revision,
      createdAt: state.createdAt,
      bundle: state.bundle,
      documents: {
        plan: { ...state.documents.plan, history: [] },
        decisions: { ...state.documents.decisions, history: [] },
        handoff: { ...state.documents.handoff, history: [] },
      },
      participants: state.participants.map(publicParticipant),
      pendingJoins: actor.role === 'host'
        ? state.joinRequests.filter((request) => request.status === 'pending').map((request) => ({
            id: request.id,
            displayName: request.displayName,
            requestedAt: request.requestedAt,
          }))
        : [],
      resources: state.resources,
      workflowProgress: state.workflowProgress ? workflowProgressSchema.parse(state.workflowProgress) : undefined,
      activity: state.activity.slice(-200),
    };
  }

  public async createInvite(actorToken: string): Promise<{ readonly token: string; readonly expiresAt: string }> {
    const token = randomToken();
    return this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + WORKROOM_INVITE_TTL_MS).toISOString();
      const invites = liveInvites(state.invites);
      if (invites.length >= WORKROOM_MAX_RETAINED_INVITES) {
        throw new WorkroomValidationError('This Workroom has reached its active invitation limit.');
      }
      let next: StoredWorkroomV1 = {
        ...state,
        invites: [...invites, {
          id: shortId('invite'),
          tokenHash: tokenDigest(token),
          createdAt,
          expiresAt,
          createdBy: actor.id,
        }],
      };
      next = bump(appendEvent(next, {
        type: 'invite.created',
        actorId: actor.id,
        summary: 'Created an expiring one-use invitation.',
      }, createdAt));
      return { state: next, result: { token, expiresAt } };
    });
  }

  public async requestJoin(input: {
    readonly roomId: string;
    readonly inviteToken: string;
    readonly password: string;
    readonly displayName: string;
    readonly deviceToken: string;
    readonly agentToken: string;
    readonly sourceKey: string;
  }): Promise<{ readonly requestId: string; readonly status: 'pending' }> {
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 80) throw new WorkroomValidationError('Display name must contain 1–80 characters.');
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.roomId)) throw new WorkroomValidationError('Invalid Workroom ID.');
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(input.inviteToken)) throw new WorkroomValidationError('Invalid invitation credential.');
    if (input.password.length < 12 || input.password.length > 128) throw new WorkroomValidationError('Invalid Workroom password.');
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(input.deviceToken)) throw new WorkroomValidationError('Invalid device credential.');
    if (!/^[A-Za-z0-9_-]{40,256}$/.test(input.agentToken) || input.agentToken === input.deviceToken) {
      throw new WorkroomValidationError('Invalid agent credential.');
    }
    if (!input.sourceKey || input.sourceKey.length > 200) throw new WorkroomValidationError('Invalid join source.');

    // Invitation identifiers are high-entropy capabilities. Reject unknown,
    // expired, consumed, or wrong-room capabilities before entering the
    // mutation queue or paying the password KDF cost. They also must not
    // contribute to a room-wide lock that arbitrary unauthenticated callers
    // could use to deny access to legitimate invitees.
    const initialState = await this.store.read();
    const initialInviteHash = tokenDigest(input.inviteToken);
    const initialInvite = initialState.invites.find((candidate) => candidate.tokenHash === initialInviteHash);
    if (input.roomId !== initialState.roomId || !initialInvite || initialInvite.usedAt
      || Date.parse(initialInvite.expiresAt) <= Date.now()) {
      throw new WorkroomValidationError('Invalid or expired invitation or password.');
    }
    if (initialState.joinRequests.filter((request) => request.status === 'pending').length >= WORKROOM_MAX_PENDING_JOINS) {
      throw new WorkroomValidationError('This Workroom has too many pending join requests.');
    }
    if (initialState.participants.filter((participant) => !participant.revokedAt).length >= WORKROOM_MAX_PARTICIPANTS) {
      throw new WorkroomValidationError('This Workroom has reached its member limit.');
    }
    const initialNow = Date.now();
    const initialCutoff = initialNow - FAILED_ATTEMPT_WINDOW_MS;
    const initialAttempt = initialState.attemptWindows.find((window) => window.key === input.sourceKey && (
      (window.lockedUntil && Date.parse(window.lockedUntil) > initialNow)
      || window.failures.some((value) => Date.parse(value) >= initialCutoff)
    ));
    if (initialAttempt?.lockedUntil && Date.parse(initialAttempt.lockedUntil) > initialNow) {
      throw new WorkroomValidationError('Too many failed join attempts. Try again later.');
    }
    if (this.passwordVerificationsInProgress.has(initialInviteHash)) {
      throw new WorkroomValidationError('This invitation already has a password verification in progress. Try again shortly.');
    }
    this.admitInvitePasswordAttempt(initialInviteHash, initialNow);
    this.passwordVerificationsInProgress.add(initialInviteHash);
    const initialPasswordRevision = JSON.stringify(initialState.password);

    type JoinOutcome =
      | { readonly ok: false }
      | { readonly ok: true; readonly requestId: string; readonly status: 'pending' };
    let outcome: JoinOutcome;
    try {
      const passwordMatches = await this.verifyRoomPassword(input.password, initialState.password);
      outcome = await this.store.mutate<JoinOutcome>((state) => {
        const at = new Date();
        const sourceKey = input.sourceKey;
        const invite = state.invites.find((candidate) => candidate.tokenHash === initialInviteHash);
        const inviteMatches = input.roomId === state.roomId
          && invite !== undefined
          && !invite.usedAt
          && Date.parse(invite.expiresAt) > at.getTime()
          && JSON.stringify(state.password) === initialPasswordRevision;
        if (!inviteMatches) return { state, result: { ok: false as const } };
        if (state.joinRequests.filter((request) => request.status === 'pending').length >= WORKROOM_MAX_PENDING_JOINS) {
          throw new WorkroomValidationError('This Workroom has too many pending join requests.');
        }
        if (state.participants.filter((participant) => !participant.revokedAt).length >= WORKROOM_MAX_PARTICIPANTS) {
          throw new WorkroomValidationError('This Workroom has reached its member limit.');
        }
        const cutoff = at.getTime() - FAILED_ATTEMPT_WINDOW_MS;
        const liveWindows = state.attemptWindows.filter((window) => (
          (window.lockedUntil && Date.parse(window.lockedUntil) > at.getTime())
          || window.failures.some((value) => Date.parse(value) >= cutoff)
        ));
        const attempt = liveWindows.find((window) => window.key === sourceKey);
        if (attempt?.lockedUntil && Date.parse(attempt.lockedUntil) > at.getTime()) {
          throw new WorkroomValidationError('Too many failed join attempts. Try again later.');
        }

        if (!passwordMatches) {
          const failures = [...(attempt?.failures ?? []).filter((value) => Date.parse(value) >= cutoff), at.toISOString()];
          const window: StoredAttemptWindowV1 = {
            key: sourceKey,
            failures,
            lockedUntil: failures.length >= MAX_FAILED_ATTEMPTS
              ? new Date(at.getTime() + FAILED_ATTEMPT_LOCK_MS).toISOString()
              : undefined,
          };
          const next: StoredWorkroomV1 = {
            ...state,
            attemptWindows: [
              ...liveWindows.filter((candidate) => candidate.key !== sourceKey).slice(-999),
              window,
            ],
          };
          return { state: next, result: { ok: false as const } };
        }

        const requestId = shortId('join');
        const requestedAt = at.toISOString();
        let next: StoredWorkroomV1 = {
          ...state,
          invites: liveInvites(state.invites, at.getTime()).filter((candidate) => candidate.id !== invite.id),
          joinRequests: compactJoinRequests([...state.joinRequests, {
            id: requestId,
            displayName,
            deviceTokenHash: tokenDigest(input.deviceToken),
            agentTokenHash: tokenDigest(input.agentToken),
            requestedAt,
            sourceKey,
            status: 'pending',
          }]),
          attemptWindows: liveWindows.filter((candidate) => candidate.key !== sourceKey),
        };
        next = bump(appendEvent(next, {
          type: 'join.requested',
          actorId: state.hostMemberId,
          summary: `${displayName} requested to join.`,
        }, requestedAt));
        return { state: next, result: { ok: true as const, requestId, status: 'pending' as const } };
      });
    } finally {
      this.passwordVerificationsInProgress.delete(initialInviteHash);
    }
    if (!outcome.ok) throw new WorkroomValidationError('Invalid or expired invitation or password.');
    this.passwordAttemptsByInvite.delete(initialInviteHash);
    return { requestId: outcome.requestId, status: outcome.status };
  }

  public async getJoinStatus(requestId: string, deviceToken: string): Promise<{
    readonly status: 'pending' | 'accepted' | 'rejected';
    readonly memberId?: string;
  }> {
    const state = await this.store.read();
    const request = state.joinRequests.find((candidate) => candidate.id === requestId);
    if (!request || request.deviceTokenHash !== tokenDigest(deviceToken)) throw new WorkroomAuthorizationError();
    return { status: request.status, memberId: request.memberId };
  }

  public async decideJoin(actorToken: string, requestId: string, accept: boolean): Promise<void> {
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const request = state.joinRequests.find((candidate) => candidate.id === requestId);
      if (!request || request.status !== 'pending') throw new WorkroomValidationError('Pending join request not found.');
      if (accept && state.participants.filter((participant) => !participant.revokedAt).length >= WORKROOM_MAX_PARTICIPANTS) {
        throw new WorkroomValidationError('This Workroom has reached its member limit.');
      }
      const decidedAt = nowIso();
      const memberId = accept ? shortId('member') : undefined;
      let next: StoredWorkroomV1 = {
        ...state,
        joinRequests: compactJoinRequests(state.joinRequests.map((candidate) => candidate.id === requestId ? {
          ...candidate,
          status: accept ? 'accepted' : 'rejected',
          memberId,
          decidedAt,
          decidedBy: actor.id,
        } : candidate)),
        participants: accept ? compactParticipants([...state.participants, {
          id: memberId!,
          displayName: request.displayName,
          role: 'member',
          joinedAt: decidedAt,
          lastSeenAt: decidedAt,
          deviceTokenHash: request.deviceTokenHash,
          agentTokenHash: request.agentTokenHash,
        }]) : compactParticipants(state.participants),
      };
      next = bump(appendEvent(next, {
        type: accept ? 'member.joined' : 'member.rejected',
        actorId: actor.id,
        summary: accept ? `${request.displayName} joined the Workroom.` : `${request.displayName}'s join request was rejected.`,
      }, decidedAt));
      return { state: next, result: undefined };
    });
  }

  public async setParticipantRole(actorToken: string, memberId: string, role: Exclude<WorkroomParticipantRole, 'host'>): Promise<void> {
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const target = state.participants.find((participant) => participant.id === memberId && !participant.revokedAt);
      if (!target || target.role === 'host') throw new WorkroomValidationError('Active member not found.');
      let next: StoredWorkroomV1 = {
        ...state,
        participants: state.participants.map((participant) => participant.id === memberId ? { ...participant, role } : participant),
      };
      next = bump(appendEvent(next, {
        type: 'member.role_changed',
        actorId: actor.id,
        summary: `${target.displayName} is now a ${role}.`,
      }));
      return { state: next, result: undefined };
    });
  }

  public async revokeParticipant(actorToken: string, memberId: string): Promise<void> {
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const target = state.participants.find((participant) => participant.id === memberId && !participant.revokedAt);
      if (!target || target.role === 'host') throw new WorkroomValidationError('Active member not found.');
      const revokedAt = nowIso();
      let next: StoredWorkroomV1 = {
        ...state,
        participants: compactParticipants(state.participants.map((participant) => participant.id === memberId ? { ...participant, revokedAt } : participant)),
      };
      next = bump(appendEvent(next, {
        type: 'member.revoked',
        actorId: actor.id,
        summary: `${target.displayName}'s device access was revoked.`,
      }, revokedAt));
      return { state: next, result: undefined };
    });
  }

  public async rotatePassword(actorToken: string, password: string, revokeDevices: boolean): Promise<void> {
    if (password.length < 12 || password.length > 128) throw new WorkroomValidationError('Workroom passwords must contain 12–128 characters.');
    const digest = await hashPassword(password);
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const rotatedAt = nowIso();
      const participants = revokeDevices
        ? state.participants.map((participant) => participant.id === actor.id ? participant : { ...participant, revokedAt: rotatedAt })
        : state.participants;
      const next = bump({
        ...state,
        password: digest,
        participants,
        invites: [],
        joinRequests: compactJoinRequests(state.joinRequests.filter((request) => request.status !== 'pending')),
      });
      return { state: next, result: undefined };
    });
  }

  public async updateDocument(
    actorToken: string,
    nameInput: string,
    content: string,
    expectedRevision: number,
  ) {
    const name = documentNameSchema.parse(nameInput);
    if (Buffer.byteLength(content, 'utf8') > WORKROOM_MAX_DOCUMENT_BYTES) throw new WorkroomValidationError('Shared documents are limited to 256 KiB.');
    return this.store.mutate((state) => {
      const actor = findActor(state, actorToken);
      const current = state.documents[name];
      if (current.revision !== expectedRevision) throw new WorkroomRevisionError(expectedRevision, current.revision);
      const updatedAt = nowIso();
      const updated = {
        ...current,
        revision: current.revision + 1,
        content,
        updatedAt,
        updatedBy: actor.id,
        history: [...current.history, {
          revision: current.revision,
          content: current.content,
          updatedAt: current.updatedAt,
          updatedBy: current.updatedBy,
        }].slice(-WORKROOM_DOCUMENT_HISTORY_LIMIT),
      };
      let next: StoredWorkroomV1 = { ...state, documents: { ...state.documents, [name]: updated } };
      next = bump(appendEvent(next, {
        type: name === 'handoff' ? 'handoff.published' : 'document.updated',
        actorId: actor.id,
        summary: `${name} updated to revision ${updated.revision}.`,
      }, updatedAt));
      return { state: next, result: updated };
    });
  }

  public async publishHandoff(
    actorToken: string,
    content: string,
    reposInput: PortableRepoV1[],
    expectedRevision: number,
  ) {
    const repos = reposInput.map((repo) => portableRepoSchema.parse(repo));
    if (Buffer.byteLength(content, 'utf8') > WORKROOM_MAX_DOCUMENT_BYTES) throw new WorkroomValidationError('Shared documents are limited to 256 KiB.');
    return this.store.mutate((state) => {
      const actor = findActor(state, actorToken);
      const current = state.documents.handoff;
      if (current.revision !== expectedRevision) throw new WorkroomRevisionError(expectedRevision, current.revision);
      const updatedAt = nowIso();
      const updated = {
        ...current,
        revision: current.revision + 1,
        content,
        updatedAt,
        updatedBy: actor.id,
        history: [...current.history, {
          revision: current.revision,
          content: current.content,
          updatedAt: current.updatedAt,
          updatedBy: current.updatedBy,
        }].slice(-WORKROOM_DOCUMENT_HISTORY_LIMIT),
      };
      const handoffs = new Map(repos.map((repo) => [repo.remoteUrl, repo.handoff]));
      const bundle = {
        ...state.bundle,
        repos: state.bundle.repos.map((repo) => {
          const handoff = handoffs.get(repo.remoteUrl);
          return handoff ? { ...repo, handoff } : repo;
        }),
      };
      let next: StoredWorkroomV1 = {
        ...state,
        bundle,
        documents: { ...state.documents, handoff: updated },
      };
      next = bump(appendEvent(next, {
        type: 'handoff.published',
        actorId: actor.id,
        summary: `Published a Git metadata handoff at revision ${updated.revision}.`,
      }, updatedAt));
      return { state: next, result: updated };
    });
  }

  public async publishResource(actorToken: string, input: unknown): Promise<WorkroomResourcePackageV1> {
    const parsed = validateResourcePackage(input);
    await this.store.pruneUnreferencedPackages();
    let writtenDigest: string | undefined;
    try {
      return await this.store.mutate(async (state) => {
      const actor = findActor(state, actorToken, ['host', 'publisher']);
      if (state.resources.length >= WORKROOM_MAX_RESOURCES) throw new WorkroomValidationError('This Workroom has reached its resource version limit.');
      if (state.resources.some((resource) => resource.kind === parsed.manifest.kind && resource.id === parsed.manifest.id && resource.version === parsed.manifest.version)) {
        throw new WorkroomValidationError('Published resource versions are immutable; choose a new version.');
      }
      const family = state.resources.filter((resource) => resource.kind === parsed.manifest.kind && resource.id === parsed.manifest.id);
      const ownerMemberId = family[0]?.ownerMemberId ?? actor.id;
      const maintainerMemberIds = family[0]?.maintainerMemberIds ?? [];
      if (family.length > 0 && actor.role !== 'host' && actor.id !== ownerMemberId && !maintainerMemberIds.includes(actor.id)) {
        throw new WorkroomAuthorizationError('Only the resource owner, a maintainer, or the host can publish a new version.');
      }
      const pkg: WorkroomResourcePackageV1 = {
        manifest: {
          ...parsed.manifest,
          digest: digestResourcePackage(parsed),
          ownerMemberId,
          maintainerMemberIds,
          createdAt: nowIso(),
          quarantinedAt: undefined,
        },
        files: parsed.files,
      };
      validateResourcePackage(pkg);
      const storedBytes = await this.store.packageStorageBytes(state.resources.map((resource) => resource.digest));
      const packageBytes = Buffer.byteLength(`${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
      assertResourceCatalogStorageSize(storedBytes, packageBytes);
      await this.store.writePackage(pkg);
      writtenDigest = pkg.manifest.digest;
      let next: StoredWorkroomV1 = { ...state, resources: [...state.resources, pkg.manifest] };
      next = bump(appendEvent(next, {
        type: 'resource.published',
        actorId: actor.id,
        summary: `Published ${pkg.manifest.kind} ${pkg.manifest.id}@${pkg.manifest.version}.`,
      }, pkg.manifest.createdAt));
      return { state: next, result: pkg };
      });
    } catch (error) {
      // The package blob is written before the SQLite state commit so readers can never see
      // a catalog entry without its content. If the atomic state commit fails,
      // remove that now-unreferenced blob before surfacing the failure.
      if (writtenDigest) await this.store.removePackage(writtenDigest).catch(() => {});
      throw error;
    }
  }

  public async getResource(actorToken: string, digest: string): Promise<WorkroomResourcePackageV1> {
    const state = await this.store.read();
    findActor(state, actorToken);
    const resource = state.resources.find((candidate) => candidate.digest === digest && !candidate.quarantinedAt);
    if (!resource) throw new WorkroomValidationError('Resource version not found or quarantined.');
    return validateResourcePackage(await this.store.readPackage(digest));
  }

  public async quarantineResource(actorToken: string, digest: string): Promise<void> {
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const target = state.resources.find((resource) => resource.digest === digest);
      if (!target) throw new WorkroomValidationError('Resource version not found.');
      const quarantinedAt = nowIso();
      let next: StoredWorkroomV1 = {
        ...state,
        resources: state.resources.map((resource) => resource.digest === digest ? { ...resource, quarantinedAt } : resource),
      };
      next = bump(appendEvent(next, {
        type: 'resource.quarantined',
        actorId: actor.id,
        summary: `Quarantined ${target.kind} ${target.id}@${target.version}.`,
      }, quarantinedAt));
      return { state: next, result: undefined };
    });
  }

  public async purgeResource(actorToken: string, digest: string): Promise<void> {
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const target = state.resources.find((resource) => resource.digest === digest);
      if (!target?.quarantinedAt) {
        throw new WorkroomValidationError('Only a quarantined resource version can be permanently purged.');
      }
      const purgedAt = nowIso();
      let next: StoredWorkroomV1 = {
        ...state,
        resources: state.resources.filter((resource) => resource.digest !== digest),
      };
      next = bump(appendEvent(next, {
        type: 'resource.purged',
        actorId: actor.id,
        summary: `Permanently purged ${target.kind} ${target.id}@${target.version}.`,
      }, purgedAt));
      return {
        state: next,
        result: undefined,
        // Keep deletion inside the store's serialized mutation. A new publish
        // cannot reuse this identity until the old blob has been removed.
        // Durable room state is the source of truth. A transient unlink
        // failure must not turn a committed purge into a false API failure;
        // publication retries orphan cleanup under the same store queue.
        afterCommit: () => this.store.removePackage(digest).catch(() => {}),
      };
    });
  }

  public async selectWorkflow(actorToken: string, workflowInput: unknown, expectedRevision: number): Promise<void> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new WorkroomValidationError('A nonnegative workflow expectedRevision is required.');
    }
    const workflow = workflowPackageSchema.parse(workflowInput) as WorkflowPackageV1;
    const ref: ImmutableResourceRefV1 = {
      kind: 'workflow',
      id: workflow.id,
      version: workflow.version,
      digest: digestWorkflowPackage(workflow),
    };
    await this.store.mutate((state) => {
      const actor = findActor(state, actorToken, ['host']);
      const currentRevision = state.workflowProgress?.revision ?? 0;
      if (currentRevision !== expectedRevision) throw new WorkroomRevisionError(expectedRevision, currentRevision);
      const updatedAt = nowIso();
      const steps: WorkflowStepProgressV1[] = workflow.steps.map((step) => ({
        stepId: step.id,
        status: 'pending',
        revision: 0,
        updatedBy: actor.id,
        updatedAt,
      }));
      let next: StoredWorkroomV1 = {
        ...state,
        workflowProgress: { workflow: ref, package: workflow, revision: currentRevision + 1, steps },
      };
      next = bump(appendEvent(next, {
        type: 'workflow.updated',
        actorId: actor.id,
        summary: `Selected workflow ${workflow.name}@${workflow.version}.`,
      }, updatedAt));
      return { state: next, result: undefined };
    });
  }

  public async transitionWorkflowStep(
    actorToken: string,
    stepId: string,
    status: WorkflowStepProgressV1['status'],
    expectedRevision: number,
    evidence?: string,
  ): Promise<WorkflowStepProgressV1> {
    const parsedStatus = workflowStepProgressSchema.shape.status.safeParse(status);
    if (!parsedStatus.success) throw new WorkroomValidationError('Invalid workflow step status.');
    return this.store.mutate((state) => {
      const actor = findActor(state, actorToken);
      const progress = state.workflowProgress;
      if (!progress) throw new WorkroomValidationError('No structured workflow is selected.');
      const current = progress.steps.find((step) => step.stepId === stepId);
      if (!current) throw new WorkroomValidationError('Workflow step not found.');
      const definition = progress.package.steps.find((step) => step.id === stepId);
      if (!definition) throw new WorkroomValidationError('Workflow progress does not match its retained package.');
      if (current.revision !== expectedRevision) throw new WorkroomRevisionError(expectedRevision, current.revision);
      if (parsedStatus.data === 'completion_proposed') throw new WorkroomValidationError('Completion proposals must use the scoped agent credential.');
      const nextEvidence = evidence === undefined ? current.evidence : evidence;
      if (parsedStatus.data === 'completed' && definition.requiresEvidence && !nextEvidence?.trim()) {
        throw new WorkroomValidationError('This workflow step requires evidence before completion.');
      }
      if (nextEvidence !== undefined && Buffer.byteLength(nextEvidence, 'utf8') > WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES) {
        throw new WorkroomValidationError('Workflow step evidence is limited to 16 KiB.');
      }
      const aggregateEvidenceBytes = progress.steps.reduce((total, step) => (
        total + Buffer.byteLength(step.stepId === stepId ? (nextEvidence ?? '') : (step.evidence ?? ''), 'utf8')
      ), 0);
      if (aggregateEvidenceBytes > WORKROOM_MAX_WORKFLOW_EVIDENCE_BYTES) {
        throw new WorkroomValidationError('Workflow evidence exceeds the 512 KiB room limit.');
      }
      const updatedAt = nowIso();
      const updated: WorkflowStepProgressV1 = {
        ...current,
        status: parsedStatus.data,
        revision: current.revision + 1,
        evidence: nextEvidence,
        proposedBy: undefined,
        updatedBy: actor.id,
        updatedAt,
      };
      let next: StoredWorkroomV1 = {
        ...state,
        workflowProgress: {
          ...progress,
          revision: progress.revision + 1,
          steps: progress.steps.map((step) => step.stepId === stepId ? updated : step),
        },
      };
      next = bump(appendEvent(next, {
        type: 'workflow.updated',
        actorId: actor.id,
        summary: `Workflow step ${stepId} moved to ${parsedStatus.data}.`,
      }, updatedAt));
      return { state: next, result: updated };
    });
  }

  public async proposeWorkflowStep(
    agentToken: string,
    stepId: string,
    expectedRevision: number,
    evidence: string,
  ): Promise<WorkflowStepProgressV1> {
    const trimmedEvidence = evidence.trim();
    if (!trimmedEvidence) throw new WorkroomValidationError('Completion proposals require evidence.');
    if (Buffer.byteLength(trimmedEvidence, 'utf8') > WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES) {
      throw new WorkroomValidationError('Workflow step evidence is limited to 16 KiB.');
    }
    return this.store.mutate((state) => {
      const { actor } = findPrincipal(state, agentToken, undefined, ['agent']);
      const progress = state.workflowProgress;
      if (!progress) throw new WorkroomValidationError('No structured workflow is selected.');
      const current = progress.steps.find((step) => step.stepId === stepId);
      if (!current) throw new WorkroomValidationError('Workflow step not found.');
      if (current.revision !== expectedRevision) throw new WorkroomRevisionError(expectedRevision, current.revision);
      if (current.status === 'completed' || current.status === 'skipped') {
        throw new WorkroomValidationError('Agents cannot replace a terminal human workflow decision. A developer must reopen the step first.');
      }
      const aggregateEvidenceBytes = progress.steps.reduce((total, step) => (
        total + Buffer.byteLength(step.stepId === stepId ? trimmedEvidence : (step.evidence ?? ''), 'utf8')
      ), 0);
      if (aggregateEvidenceBytes > WORKROOM_MAX_WORKFLOW_EVIDENCE_BYTES) {
        throw new WorkroomValidationError('Workflow evidence exceeds the 512 KiB room limit.');
      }
      const updatedAt = nowIso();
      const updated: WorkflowStepProgressV1 = {
        ...current,
        status: 'completion_proposed',
        revision: current.revision + 1,
        evidence: trimmedEvidence,
        proposedBy: actor.id,
        updatedBy: actor.id,
        updatedAt,
      };
      let next: StoredWorkroomV1 = {
        ...state,
        workflowProgress: {
          ...progress,
          revision: progress.revision + 1,
          steps: progress.steps.map((step) => step.stepId === stepId ? updated : step),
        },
      };
      next = bump(appendEvent(next, {
        type: 'workflow.updated',
        actorId: actor.id,
        summary: `Agent proposed completion of workflow step ${stepId}.`,
      }, updatedAt));
      return { state: next, result: updated };
    });
  }
}
