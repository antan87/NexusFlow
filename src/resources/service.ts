import * as path from 'node:path';

import { acquireLock, createMutationQueue } from '../core/locks.js';
import {
  resolveBrandHomeDir,
  RESOURCE_LOCKS_DIR,
  RESOURCE_ADMIN_LOCK_FILE,
} from '../core/constants.js';
import { getAllSkills } from '../utils/skills-catalog.js';
import { getAllAgents } from './agents-catalog.js';

const runResourceAdministration = createMutationQueue();

export class ResourceSelectionError extends Error {
  public readonly missingSkills: string[];
  public readonly missingAgents: string[];

  constructor(missingSkills: string[], missingAgents: string[]) {
    const parts = [
      missingSkills.length ? `skills: ${missingSkills.join(', ')}` : '',
      missingAgents.length ? `agents: ${missingAgents.join(', ')}` : '',
    ].filter(Boolean);
    super(`Selected resources are not available (${parts.join('; ')}).`);
    this.name = 'ResourceSelectionError';
    this.missingSkills = missingSkills;
    this.missingAgents = missingAgents;
  }
}

export async function withResourceAdministrationLock<T>(operation: () => Promise<T>): Promise<T> {
  return runResourceAdministration(async () => {
    const release = await acquireLock(
      path.join(resolveBrandHomeDir(), RESOURCE_LOCKS_DIR, RESOURCE_ADMIN_LOCK_FILE),
      {
        staleMs: 60_000,
        timeoutMs: 15_000,
        timeoutMessage: 'Timed out waiting for resource administration.',
      },
    );
    try {
      return await operation();
    } finally {
      await release();
    }
  });
}

export async function validateResourceSelections(
  enabledSkills: string[],
  enabledAgents: string[],
): Promise<void> {
  const [skills, agents] = await Promise.all([getAllSkills(), getAllAgents()]);
  const skillIds = new Set(skills.map((skill) => skill.id));
  const agentIds = new Set(agents.map((agent) => agent.id));
  const missingSkills = [...new Set(enabledSkills)].filter((id) => !skillIds.has(id));
  const missingAgents = [...new Set(enabledAgents)].filter((id) => !agentIds.has(id));
  if (missingSkills.length || missingAgents.length) {
    throw new ResourceSelectionError(missingSkills, missingAgents);
  }
}
