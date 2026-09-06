import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import fse from 'fs-extra';

import type { CodexAgentItem } from '../types.js';
import { acquireLock, createMutationQueue } from '../core/locks.js';
import {
  resolveBrandHomeDir,
  RESOURCE_AGENTS_DIR,
  RESOURCE_LOCKS_DIR,
  RESOURCE_CATALOG_LOCK_FILE,
} from '../core/constants.js';
import { parseCodexAgentToml, serializeCodexAgentToml, validateCodexAgentInput } from './codex-agent.js';
import { codexAgentNameSchema, resourceIdSchema, formatValidationError } from './contracts.js';
import { assertNoLinkedPathComponents, assertPathIsNotLink, assertPathWithin, atomicWriteJson } from './fs-safety.js';

const runCatalogMutation = createMutationQueue();

interface AgentMetadataFile {
  schemaVersion: 1;
  category: string;
}

export function getUserAgentsDir(): string {
  return path.join(resolveBrandHomeDir(), RESOURCE_AGENTS_DIR);
}

async function withCatalogLock<T>(operation: () => Promise<T>): Promise<T> {
  return runCatalogMutation(async () => {
    const release = await acquireLock(path.join(resolveBrandHomeDir(), RESOURCE_LOCKS_DIR, RESOURCE_CATALOG_LOCK_FILE), {
      staleMs: 60_000,
      timeoutMs: 10_000,
      timeoutMessage: 'Timed out waiting for the resource catalog lock.',
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  });
}

async function loadAgentFromDir(agentDir: string): Promise<CodexAgentItem> {
  const id = path.basename(agentDir);
  const idResult = codexAgentNameSchema.safeParse(id);
  if (!idResult.success) {
    throw new Error(`Invalid agent directory: ${formatValidationError(idResult.error)}`);
  }

  const root = getUserAgentsDir();
  await assertNoLinkedPathComponents(root, agentDir);
  const raw = await fs.readFile(path.join(agentDir, 'agent.toml'), 'utf-8');
  const parsed = parseCodexAgentToml(raw, id);

  let category = 'general';
  const metadataPath = path.join(agentDir, 'resource.json');
  if (await fse.pathExists(metadataPath)) {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as unknown;
    if (
      typeof metadata === 'object' &&
      metadata !== null &&
      'schemaVersion' in metadata &&
      metadata.schemaVersion === 1 &&
      'category' in metadata
    ) {
      const categoryResult = resourceIdSchema.safeParse(metadata.category);
      if (categoryResult.success) category = categoryResult.data;
    }
  }

  return {
    id,
    name: parsed.name,
    category,
    description: parsed.description,
    developerInstructions: parsed.developerInstructions,
    model: parsed.model,
    modelReasoningEffort: parsed.modelReasoningEffort,
    sandboxMode: parsed.sandboxMode,
    custom: true,
    sourcePath: agentDir,
  };
}

export async function getAllAgents(): Promise<CodexAgentItem[]> {
  const root = getUserAgentsDir();
  if (!(await fse.pathExists(root))) return [];
  await assertPathIsNotLink(root);
  const agents: CodexAgentItem[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      agents.push(await loadAgentFromDir(path.join(root, entry.name)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Skipping invalid Codex agent "${entry.name}": ${message}`);
    }
  }
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

export async function saveAgent(
  input: unknown,
  options: { readonly beforeCommit?: () => Promise<void> } = {},
): Promise<CodexAgentItem> {
  const agent = validateCodexAgentInput(input);
  const id = agent.id ?? agent.name;

  return withCatalogLock(async () => {
    const root = path.resolve(getUserAgentsDir());
    await fse.ensureDir(root);
    await assertPathIsNotLink(root);
    const target = assertPathWithin(root, path.join(root, id));
    await assertNoLinkedPathComponents(root, target);

    const staging = await fs.mkdtemp(path.join(root, `.staging-${id}-`));
    const backup = path.join(root, `.backup-${id}-${randomUUID()}`);
    let movedExisting = false;
    let installedStaging = false;
    try {
      await fs.writeFile(path.join(staging, 'agent.toml'), serializeCodexAgentToml(agent), 'utf-8');
      const metadata: AgentMetadataFile = { schemaVersion: 1, category: agent.category };
      await atomicWriteJson(path.join(staging, 'resource.json'), metadata);
      await options.beforeCommit?.();

      if (await fse.pathExists(target)) {
        await assertNoLinkedPathComponents(root, target);
        await fs.rename(target, backup);
        movedExisting = true;
      }
      await fs.rename(staging, target);
      installedStaging = true;
      const loaded = await loadAgentFromDir(target);
      if (movedExisting) await fse.remove(backup).catch(() => {});
      return loaded;
    } catch (error) {
      await fse.remove(staging).catch(() => {});
      if (installedStaging) await fse.remove(target).catch(() => {});
      if (movedExisting && (await fse.pathExists(backup))) {
        await fs.rename(backup, target).catch(() => {});
      }
      throw error;
    }
  });
}

export async function importAgentToml(raw: string, category = 'general'): Promise<CodexAgentItem> {
  const parsed = parseCodexAgentToml(raw);
  return saveAgent({ ...parsed, category });
}

export async function deleteAgent(id: string): Promise<void> {
  const result = codexAgentNameSchema.safeParse(id);
  if (!result.success || result.data !== id) {
    throw new Error('Invalid agent ID.');
  }
  await withCatalogLock(async () => {
    const root = path.resolve(getUserAgentsDir());
    await fse.ensureDir(root);
    await assertPathIsNotLink(root);
    const target = assertPathWithin(root, path.join(root, id));
    if (!(await fse.pathExists(target))) throw new Error('Agent not found.');
    await assertNoLinkedPathComponents(root, target);
    await fse.remove(target);
  });
}
