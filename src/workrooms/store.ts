import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { z } from 'zod';

import { createMutationQueue } from '../core/locks.js';
import { atomicWriteJson } from '../resources/fs-safety.js';
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
  WORKROOM_MAX_EXPORT_PLAINTEXT_BYTES,
  WORKROOM_MAX_RESOURCES,
  WORKROOM_SCHEMA_VERSION,
  documentNameSchema,
  portableFeatureBundleSchema,
  workflowProgressSchema,
  workroomDocumentSchema,
  workroomEventSchema,
  workroomResourceManifestSchema,
  workroomResourcePackageSchema,
  WorkroomValidationError,
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

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class WorkroomFileStore {
  private readonly runMutation = createMutationQueue();
  private readonly statePath: string;
  private readonly blobsDir: string;

  constructor(public readonly roomDir: string) {
    this.statePath = path.join(roomDir, 'room.json');
    this.blobsDir = path.join(roomDir, 'blobs');
  }

  public async initialize(state: StoredWorkroomV1): Promise<void> {
    await fs.mkdir(this.blobsDir, { recursive: true });
    try {
      await fs.access(this.statePath);
      throw new Error(`Workroom already exists at ${this.roomDir}.`);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        await atomicWriteJson(this.statePath, state);
        return;
      }
      throw error;
    }
  }

  public async read(): Promise<StoredWorkroomV1> {
    return JSON.parse(await fs.readFile(this.statePath, 'utf8')) as StoredWorkroomV1;
  }

  public async mutate<T>(
    operation: (current: StoredWorkroomV1) => {
      readonly state: StoredWorkroomV1;
      readonly result: T;
      readonly afterCommit?: () => Promise<void>;
    } | Promise<{
      readonly state: StoredWorkroomV1;
      readonly result: T;
      readonly afterCommit?: () => Promise<void>;
    }>,
  ): Promise<T> {
    return this.runMutation(async () => {
      const current = await this.read();
      const outcome = await operation(clone(current));
      await atomicWriteJson(this.statePath, outcome.state);
      await outcome.afterCommit?.();
      return outcome.result;
    });
  }

  public async writePackage(pkg: WorkroomResourcePackageV1): Promise<void> {
    await fs.mkdir(this.blobsDir, { recursive: true });
    const destination = path.join(this.blobsDir, `${pkg.manifest.digest}.json`);
    try {
      await fs.access(destination);
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
        await atomicWriteJson(destination, pkg);
        return;
      }
      throw error;
    }
  }

  public async removePackage(digest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid Workroom package digest.');
    await fs.unlink(path.join(this.blobsDir, `${digest}.json`)).catch((error: unknown) => {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error;
    });
  }

  /**
   * Reconciles package bytes against the durable catalog. The room state is
   * the source of truth, so a transient Windows unlink failure after a purge
   * can be retried safely without retaining a separate tombstone.
   */
  public async pruneUnreferencedPackages(): Promise<void> {
    await this.runMutation(async () => {
      const state = await this.read();
      const referenced = new Set(state.resources.map((resource) => `${resource.digest}.json`));
      const entries = await fs.readdir(this.blobsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name) && !referenced.has(entry.name)) {
          await fs.unlink(path.join(this.blobsDir, entry.name)).catch(() => {});
        }
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
}
