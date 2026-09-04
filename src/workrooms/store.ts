import { z } from 'zod';

import type { PasswordDigest } from './crypto.js';
import type {
  PortableFeatureBundleV1,
  WorkflowProgressV1,
  WorkroomDocumentV1,
  WorkroomEventV1,
  WorkroomParticipantV1,
  WorkroomResourceManifestV1,
  WorkroomResourcePackageV1,
} from './contracts.js';
import {
  WORKROOM_AUDIT_LIMIT,
  WORKROOM_MAX_PARTICIPANTS,
  WORKROOM_MAX_RETAINED_INVITES,
  WORKROOM_MAX_RETAINED_JOIN_REQUESTS,
  WORKROOM_MAX_RESOURCES,
  WORKROOM_SCHEMA_VERSION,
  documentNameSchema,
  participantRoleSchema,
  portableFeatureBundleSchema,
  workflowProgressSchema,
  workroomDocumentSchema,
  workroomEventSchema,
  workroomParticipantSchema,
  workroomResourceManifestSchema,
  workroomResourcePackageSchema,
} from './contracts.js';

export interface StoredInviteV1 {
  readonly id: string;
  readonly tokenHash: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly createdBy: string;
  readonly usedAt?: string;
}

export interface StoredJoinRequestV1 {
  readonly id: string;
  readonly displayName: string;
  readonly deviceTokenHash: string;
  readonly agentTokenHash: string;
  readonly requestedAt: string;
  readonly sourceKey: string;
  readonly status: 'pending' | 'accepted' | 'rejected';
  readonly memberId?: string;
  readonly decidedAt?: string;
  readonly decidedBy?: string;
}

export interface StoredParticipantV1 extends WorkroomParticipantV1 {
  readonly deviceTokenHash: string;
  readonly agentTokenHash: string;
}

export interface StoredAttemptWindowV1 {
  readonly key: string;
  readonly failures: string[];
  readonly lockedUntil?: string;
}

export interface StoredWorkroomV1 {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly address: string;
  readonly port: number;
  readonly certificateFingerprint: string;
  readonly createdAt: string;
  readonly revision: number;
  readonly password: PasswordDigest;
  readonly hostMemberId: string;
  readonly bundle: PortableFeatureBundleV1;
  readonly documents: Record<'plan' | 'decisions' | 'handoff', WorkroomDocumentV1>;
  readonly participants: StoredParticipantV1[];
  readonly invites: StoredInviteV1[];
  readonly joinRequests: StoredJoinRequestV1[];
  readonly attemptWindows: StoredAttemptWindowV1[];
  readonly resources: WorkroomResourceManifestV1[];
  readonly workflowProgress?: WorkflowProgressV1;
  readonly activity: WorkroomEventV1[];
}

export interface WorkroomExportPayloadV1 {
  readonly schemaVersion: 1;
  readonly room: {
    readonly name: string;
    readonly workspaceId: string;
    readonly bundle: PortableFeatureBundleV1;
    readonly documents: StoredWorkroomV1['documents'];
    readonly resources: WorkroomResourceManifestV1[];
    readonly workflowProgress?: WorkflowProgressV1;
    readonly activity: WorkroomEventV1[];
  };
  readonly packages: WorkroomResourcePackageV1[];
  readonly exportedAt: string;
}

export const workroomExportPayloadSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  room: z.object({
    name: z.string().trim().min(1).max(160),
    workspaceId: z.string().min(1).max(255),
    bundle: portableFeatureBundleSchema,
    documents: z.record(documentNameSchema, workroomDocumentSchema),
    resources: z.array(workroomResourceManifestSchema).max(WORKROOM_MAX_RESOURCES),
    workflowProgress: workflowProgressSchema.optional(),
    activity: z.array(workroomEventSchema).max(WORKROOM_AUDIT_LIMIT),
  }),
  packages: z.array(workroomResourcePackageSchema).max(WORKROOM_MAX_RESOURCES),
  exportedAt: z.string().datetime({ offset: true }),
});

const storedIdentifierSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const storedDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const storedDateSchema = z.string().datetime({ offset: true });

export const storedWorkroomSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  roomId: storedIdentifierSchema,
  name: z.string().trim().min(1).max(160),
  workspaceId: z.string().min(1).max(255),
  address: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  certificateFingerprint: z.string().min(32).max(128),
  createdAt: storedDateSchema,
  revision: z.number().int().positive(),
  password: z.object({ salt: z.string().min(1).max(256), hash: z.string().min(1).max(256) }),
  hostMemberId: storedIdentifierSchema,
  bundle: portableFeatureBundleSchema,
  documents: z.record(documentNameSchema, workroomDocumentSchema),
  participants: z.array(workroomParticipantSchema.extend({
    role: participantRoleSchema,
    deviceTokenHash: storedDigestSchema,
    agentTokenHash: storedDigestSchema,
  })).max(WORKROOM_MAX_PARTICIPANTS),
  invites: z.array(z.object({
    id: storedIdentifierSchema,
    tokenHash: storedDigestSchema,
    createdAt: storedDateSchema,
    expiresAt: storedDateSchema,
    createdBy: storedIdentifierSchema,
    usedAt: storedDateSchema.optional(),
  })).max(WORKROOM_MAX_RETAINED_INVITES),
  joinRequests: z.array(z.object({
    id: storedIdentifierSchema,
    displayName: z.string().trim().min(1).max(80),
    deviceTokenHash: storedDigestSchema,
    agentTokenHash: storedDigestSchema,
    requestedAt: storedDateSchema,
    sourceKey: z.string().min(1).max(512),
    status: z.enum(['pending', 'accepted', 'rejected']),
    memberId: storedIdentifierSchema.optional(),
    decidedAt: storedDateSchema.optional(),
    decidedBy: storedIdentifierSchema.optional(),
  })).max(WORKROOM_MAX_RETAINED_JOIN_REQUESTS),
  attemptWindows: z.array(z.object({
    key: z.string().min(1).max(512),
    failures: z.array(storedDateSchema).max(1_000),
    lockedUntil: storedDateSchema.optional(),
  })).max(1_000),
  resources: z.array(workroomResourceManifestSchema).max(WORKROOM_MAX_RESOURCES),
  workflowProgress: workflowProgressSchema.optional(),
  activity: z.array(workroomEventSchema).max(WORKROOM_AUDIT_LIMIT),
}).strict();

export function parseStoredWorkroom(value: unknown): StoredWorkroomV1 {
  return storedWorkroomSchema.parse(value) as StoredWorkroomV1;
}

export interface WorkroomMutation<T> {
  readonly state: StoredWorkroomV1;
  readonly result: T;
  readonly afterCommit?: () => Promise<void>;
}

export interface WorkroomStore {
  readonly roomDir: string;
  initialize(state: StoredWorkroomV1): Promise<void>;
  read(): Promise<StoredWorkroomV1>;
  mutate<T>(operation: (current: StoredWorkroomV1) => WorkroomMutation<T> | Promise<WorkroomMutation<T>>): Promise<T>;
  writePackage(pkg: WorkroomResourcePackageV1): Promise<void>;
  removePackage(digest: string): Promise<void>;
  pruneUnreferencedPackages(): Promise<void>;
  readPackage(digest: string): Promise<WorkroomResourcePackageV1>;
  packageStorageBytes(digests: readonly string[]): Promise<number>;
  createExportPayload(): Promise<WorkroomExportPayloadV1>;
}
