import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { resolveGlobalDurablePath, resolveBrandHomeDir, RESOURCE_LOCKS_DIR, RESOURCE_CATALOG_LOCK_FILE } from './constants.js';
import { acquireLock, createMutationQueue } from './locks.js';
import { assertPathWithin, assertNoLinkedPathComponents, atomicWriteJson } from '../resources/fs-safety.js';
import type { DomainPack, OrganizationConventions } from '../types.js';

const namedEntry = z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) });
const catalogSchema = z.object({
  organizations: z.array(namedEntry.extend({ rules: z.array(z.string()) }).passthrough()),
  domainPacks: z.array(namedEntry.extend({ description: z.string().default(''), tags: z.array(z.string()) }).passthrough()),
});
export interface DomainCatalog {
  organizations: OrganizationConventions[];
  domainPacks: DomainPack[];
}
const runMutation = createMutationQueue();

/** Read on every lookup so CLI processes and an already-running GUI see the same catalog. */
export function readDomainCatalog(): DomainCatalog {
  const catalogPath = resolveGlobalDurablePath('domain-catalog.json');
  try {
    return catalogSchema.parse(JSON.parse(fs.readFileSync(catalogPath, 'utf8'))) as DomainCatalog;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { organizations: [], domainPacks: [] };
    throw error; // Never replace an unreadable or corrupt catalog with an empty one.
  }
}

export async function mutateDomainCatalog<T>(mutation: (catalog: DomainCatalog) => T): Promise<T> {
  return runMutation(async () => {
    const release = await acquireLock(path.join(resolveBrandHomeDir(), RESOURCE_LOCKS_DIR, RESOURCE_CATALOG_LOCK_FILE), {
      staleMs: 60_000,
      timeoutMs: 10_000,
      timeoutMessage: 'Timed out waiting for the resource catalog lock.',
    });
    try {
      const catalogPath = resolveGlobalDurablePath('domain-catalog.json');
      const base = path.dirname(catalogPath);
      assertPathWithin(base, catalogPath);
      await assertNoLinkedPathComponents(base, catalogPath);
      const catalog = readDomainCatalog();
      const result = mutation(catalog);
      await atomicWriteJson(catalogPath, catalogSchema.parse(catalog));
      return result;
    } finally {
      await release();
    }
  });
}
