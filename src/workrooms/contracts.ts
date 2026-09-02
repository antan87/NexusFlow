import { createHash } from 'node:crypto';

import { z } from 'zod';

export const WORKROOM_SCHEMA_VERSION = 1 as const;
export const WORKROOM_INVITE_TTL_MS = 30 * 60 * 1000;
export const WORKROOM_MAX_DOCUMENT_BYTES = 256 * 1024;
export const WORKROOM_DOCUMENT_HISTORY_LIMIT = 10;
export const WORKROOM_AUDIT_LIMIT = 1_000;
export const WORKROOM_MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const WORKROOM_MAX_PACKAGE_FILES = 2_000;
export const WORKROOM_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const WORKROOM_MAX_RESOURCE_UPLOAD_BYTES = 16 * 1024 * 1024;
export const WORKROOM_MAX_RESOURCE_CATALOG_JSON_BYTES = 40 * 1024 * 1024;
export const WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES = 96 * 1024 * 1024;
export const WORKROOM_MAX_WORKFLOW_EVIDENCE_BYTES = 512 * 1024;
export const WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES = 16 * 1024;
export const WORKROOM_MAX_RESOURCES = 500;
export const WORKROOM_MAX_PARTICIPANTS = 500;
export const WORKROOM_MAX_PENDING_JOINS = 100;
export const WORKROOM_MAX_RETAINED_INVITES = 500;
export const WORKROOM_MAX_RETAINED_JOIN_REQUESTS = 500;

const isoDateSchema = z.string().datetime({ offset: true });
const identifierSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const semanticVersionSchema = z.string().max(80).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

export const participantRoleSchema = z.enum(['host', 'publisher', 'member']);
export type WorkroomParticipantRole = z.infer<typeof participantRoleSchema>;

export const workroomParticipantSchema = z.object({
  id: identifierSchema,
  displayName: z.string().trim().min(1).max(80),
  role: participantRoleSchema,
  joinedAt: isoDateSchema,
  lastSeenAt: isoDateSchema,
  revokedAt: isoDateSchema.optional(),
});
export type WorkroomParticipantV1 = z.infer<typeof workroomParticipantSchema>;

export const documentNameSchema = z.enum(['plan', 'decisions', 'handoff']);
export type WorkroomDocumentName = z.infer<typeof documentNameSchema>;

export const workroomDocumentRevisionSchema = z.object({
  revision: z.number().int().nonnegative(),
  content: z.string().max(WORKROOM_MAX_DOCUMENT_BYTES),
  updatedAt: isoDateSchema,
  updatedBy: identifierSchema,
});
export type WorkroomDocumentRevisionV1 = z.infer<typeof workroomDocumentRevisionSchema>;

export const workroomDocumentSchema = workroomDocumentRevisionSchema.extend({
  name: documentNameSchema,
  history: z.array(workroomDocumentRevisionSchema).max(WORKROOM_DOCUMENT_HISTORY_LIMIT),
});
export type WorkroomDocumentV1 = z.infer<typeof workroomDocumentSchema>;

export const portableRepoSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(160),
  remoteUrl: z.string().trim().min(1).max(2_048),
  defaultBranch: z.string().trim().min(1).max(255),
  handoff: z.object({
    branch: z.string().max(255),
    commit: z.string().regex(/^[a-f0-9]{7,64}$/).or(z.literal('unknown')),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    dirty: z.boolean(),
    publishedAt: isoDateSchema,
    publishedBy: identifierSchema,
  }).optional(),
});
export type PortableRepoV1 = z.infer<typeof portableRepoSchema>;

export const immutableResourceRefSchema = z.object({
  kind: z.enum(['skill', 'agent', 'workflow']),
  id: identifierSchema,
  version: semanticVersionSchema,
  digest: digestSchema,
});
export type ImmutableResourceRefV1 = z.infer<typeof immutableResourceRefSchema>;

export const portableFeatureBundleSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  project: z.object({
    id: identifierSchema,
    name: z.string().trim().min(1).max(160),
  }),
  feature: z.object({
    id: identifierSchema,
    goal: z.string().trim().min(1).max(20_000),
    description: z.string().max(100_000),
  }),
  repos: z.array(portableRepoSchema).max(100),
  pinnedResources: z.array(immutableResourceRefSchema).max(1_000),
  workflowRef: immutableResourceRefSchema.optional(),
  createdAt: isoDateSchema,
});
export type PortableFeatureBundleV1 = z.infer<typeof portableFeatureBundleSchema>;

export const resourceFileSchema = z.object({
  path: z.string().min(1).max(1_024),
  contentBase64: z.string(),
  mode: z.number().int().min(0).max(0o777).optional(),
});
export type WorkroomResourceFileV1 = z.infer<typeof resourceFileSchema>;

export const workroomResourceManifestSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  kind: z.enum(['skill', 'agent', 'workflow']),
  id: identifierSchema,
  version: semanticVersionSchema,
  digest: digestSchema,
  ownerMemberId: identifierSchema,
  maintainerMemberIds: z.array(identifierSchema).max(100),
  createdAt: isoDateSchema,
  dependencies: z.array(immutableResourceRefSchema).max(100),
  compatibility: z.object({
    platforms: z.array(z.enum(['win32', 'linux', 'darwin'])).max(3).optional(),
    nexusflow: z.string().max(80).optional(),
  }).optional(),
  quarantinedAt: isoDateSchema.optional(),
});
export type WorkroomResourceManifestV1 = z.infer<typeof workroomResourceManifestSchema>;

export const workroomResourcePackageSchema = z.object({
  manifest: workroomResourceManifestSchema,
  files: z.array(resourceFileSchema).min(1).max(WORKROOM_MAX_PACKAGE_FILES),
});
export type WorkroomResourcePackageV1 = z.infer<typeof workroomResourcePackageSchema>;

export const workflowStepSchema = z.object({
  id: identifierSchema,
  title: z.string().trim().min(1).max(240),
  requiresEvidence: z.boolean(),
});
export type WorkflowStepV1 = z.infer<typeof workflowStepSchema>;

export const workflowPackageSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  id: identifierSchema,
  version: semanticVersionSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(2_000),
  markdown: z.string().max(2 * 1024 * 1024),
  steps: z.array(workflowStepSchema).max(500),
  dependencies: z.array(immutableResourceRefSchema).max(100),
}).superRefine((workflow, context) => {
  if (new Set(workflow.steps.map((step) => step.id)).size !== workflow.steps.length) {
    context.addIssue({ code: 'custom', message: 'Workflow step IDs must be unique.' });
  }
});
export type WorkflowPackageV1 = z.infer<typeof workflowPackageSchema>;

export function digestWorkflowPackage(workflow: WorkflowPackageV1): string {
  return createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
}

export const workflowStepProgressSchema = z.object({
  stepId: identifierSchema,
  status: z.enum(['pending', 'in_progress', 'completion_proposed', 'completed', 'skipped']),
  revision: z.number().int().nonnegative(),
  evidence: z.string()
    .max(WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= WORKROOM_MAX_WORKFLOW_STEP_EVIDENCE_BYTES,
      'Workflow step evidence is limited to 16 KiB of UTF-8 text.',
    )
    .optional(),
  proposedBy: identifierSchema.optional(),
  updatedBy: identifierSchema,
  updatedAt: isoDateSchema,
});
export type WorkflowStepProgressV1 = z.infer<typeof workflowStepProgressSchema>;

export const workflowProgressSchema = z.object({
  workflow: immutableResourceRefSchema,
  package: workflowPackageSchema,
  revision: z.number().int().nonnegative(),
  steps: z.array(workflowStepProgressSchema).max(500),
}).superRefine((progress, context) => {
  if (progress.workflow.kind !== 'workflow'
    || progress.workflow.id !== progress.package.id
    || progress.workflow.version !== progress.package.version
    || progress.workflow.digest !== digestWorkflowPackage(progress.package)) {
    context.addIssue({ code: 'custom', message: 'Workflow progress must match its exact digest-bound package.' });
  }
  const packageStepIds = progress.package.steps.map((step) => step.id);
  const progressStepIds = progress.steps.map((step) => step.stepId);
  if (packageStepIds.length !== progressStepIds.length
    || packageStepIds.some((stepId, index) => progressStepIds[index] !== stepId)) {
    context.addIssue({ code: 'custom', message: 'Workflow progress steps must exactly match the retained package.' });
  }
});
export type WorkflowProgressV1 = z.infer<typeof workflowProgressSchema>;

export const workroomEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.enum([
    'room.created',
    'invite.created',
    'join.requested',
    'member.joined',
    'member.rejected',
    'member.revoked',
    'member.role_changed',
    'document.updated',
    'handoff.published',
    'resource.published',
    'resource.quarantined',
    'resource.purged',
    'workflow.updated',
  ]),
  actorId: identifierSchema,
  createdAt: isoDateSchema,
  summary: z.string().max(500),
});
export type WorkroomEventV1 = z.infer<typeof workroomEventSchema>;

export const workroomSnapshotSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  roomId: identifierSchema,
  name: z.string().trim().min(1).max(160),
  address: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535),
  certificateFingerprint: z.string().min(32).max(128),
  revision: z.number().int().positive(),
  createdAt: isoDateSchema,
  bundle: portableFeatureBundleSchema,
  documents: z.record(documentNameSchema, workroomDocumentSchema),
  participants: z.array(workroomParticipantSchema).max(WORKROOM_MAX_PARTICIPANTS),
  pendingJoins: z.array(z.object({
    id: identifierSchema,
    displayName: z.string(),
    requestedAt: isoDateSchema,
  })).max(WORKROOM_MAX_PENDING_JOINS),
  resources: z.array(workroomResourceManifestSchema).max(WORKROOM_MAX_RESOURCES),
  workflowProgress: workflowProgressSchema.optional(),
  activity: z.array(workroomEventSchema),
});
export type WorkroomSnapshotV1 = z.infer<typeof workroomSnapshotSchema>;

export const workroomInviteSchema = z.object({
  schemaVersion: z.literal(WORKROOM_SCHEMA_VERSION),
  url: z.string().url().refine((value) => value.startsWith('https://'), 'Workroom URL must use HTTPS.'),
  roomId: identifierSchema,
  token: z.string().regex(/^[A-Za-z0-9_-]{40,}$/),
  fingerprint: z.string().min(32).max(128),
});
export type WorkroomInviteV1 = z.infer<typeof workroomInviteSchema>;

export interface WorkroomConfigV1 {
  readonly schemaVersion: 1;
  readonly roomId: string;
  readonly name: string;
  readonly workspaceId: string;
  readonly address: string;
  readonly port: number;
  readonly certificateFingerprint: string;
  readonly createdAt: string;
}

export class WorkroomRevisionError extends Error {
  public readonly expected: number;
  public readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`Workroom revision conflict: expected ${expected}, current revision is ${actual}.`);
    this.name = 'WorkroomRevisionError';
    this.expected = expected;
    this.actual = actual;
  }
}

export class WorkroomAuthorizationError extends Error {
  constructor(message = 'This Workroom action is not authorized.') {
    super(message);
    this.name = 'WorkroomAuthorizationError';
  }
}

export class WorkroomValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkroomValidationError';
  }
}
