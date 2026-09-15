import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { acquireLock, createMutationQueue } from './locks.js';
import { readWorkspaceFile, writeWorkspaceFile } from './storage.js';
import { loadFeatureConfig } from './workspace.js';
import { PRIMARY_PLAN_FILE } from './constants.js';
import { assertNoLinkedPathComponents } from '../resources/fs-safety.js';

export const PLANNING_NOTES_FILE = 'contextspace-milestones.md';
const template = `# Delivery plan and open questions

This is an authored planning document. Refresh preserves it. Use the lifecycle
editor for executable milestone gates; record the rationale and release sequence here.

## Outcomes and release order

| Milestone ID | Outcome / acceptance criteria | Repo / work item / PR | Depends on | Release / publish / consumer bump order |
| --- | --- | --- | --- | --- |

## Open questions

| ID | Question | Owner | Status (open / resolved) | Blocks | Resolution / evidence |
| --- | --- | --- | --- | --- | --- |

## Existing work — verify before replanning

| Outcome | Repo / branch / PR / commit | Status (merged / on branch / no change needed) | Evidence checked | Remaining work |
| --- | --- | --- | --- | --- |

## Flagged defects and deferred decisions

| Item | Decision (flag only / defer / implement) | Reason | Owner | Follow-up |
| --- | --- | --- | --- | --- |

## Draft work items

Use applicable enabled skill templates for the requested planning output. Store
each resulting PBI/spec as a draft source document and link it to its milestone.
Enabling a skill makes instructions available; it does not execute generation automatically.
`;
const revision = (content: string) => createHash('sha256').update(content).digest('hex');
const queue = createMutationQueue();

export async function readPlanningNotes(root: string) {
  const feature = await loadFeatureConfig(root);
  if (!feature) throw new Error('Workspace not found.');
  await assertNoLinkedPathComponents(root, path.join(root, PLANNING_NOTES_FILE));
  let content: string;
  try { content = await readWorkspaceFile(root, feature.id, PLANNING_NOTES_FILE); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; content = template; }
  return { content, revision: revision(content) };
}

export async function ensurePlanningNotes(root: string, featureId: string) {
  return mutate(root, async () => {
    try { await readWorkspaceFile(root, featureId, PLANNING_NOTES_FILE); return; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    let imported = '';
    try {
      const previous = await readWorkspaceFile(root, featureId, PRIMARY_PLAN_FILE);
      const start = previous.search(/^## Milestones\s*$/m);
      if (start >= 0) imported = '\n## Imported planning notes\n\n' + previous.slice(start);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await writeWorkspaceFile(root, featureId, PLANNING_NOTES_FILE, template + imported);
  });
}

async function mutate<T>(root: string, operation: () => Promise<T>) {
  return queue(async () => {
    root = await fs.realpath(root);
    await assertNoLinkedPathComponents(root, path.join(root, PLANNING_NOTES_FILE));
    const release = await acquireLock(path.join(root, '.contextspace-planning.lock'), { staleMs: 60_000, timeoutMs: 10_000, timeoutMessage: 'Planning notes are busy. Retry.' });
    try { return await operation(); } finally { await release(); }
  });
}

export async function savePlanningNotes(root: string, expectedRevision: string, content: string) {
  return mutate(root, async () => {
    const current = await readPlanningNotes(root);
    if (current.revision !== expectedRevision) throw new Error('Planning notes changed in another session. Reload before saving.');
    const feature = await loadFeatureConfig(root);
    if (!feature) throw new Error('Workspace not found.');
    await writeWorkspaceFile(root, feature.id, PLANNING_NOTES_FILE, content);
    return { content, revision: revision(content) };
  });
}
