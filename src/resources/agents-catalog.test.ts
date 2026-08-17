import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import fse from 'fs-extra';

import { deleteAgent, getAllAgents, importAgentToml, saveAgent } from './agents-catalog.js';

describe('Codex agent catalog', () => {
  let tempHome: string;
  const originalHome = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-agents-'));
    process.env.NEXUSFLOW_HOME = tempHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.NEXUSFLOW_HOME;
    else process.env.NEXUSFLOW_HOME = originalHome;
    await fse.remove(tempHome);
  });

  it('creates, updates, lists, imports, and deletes native agents', async () => {
    await saveAgent({
      name: 'reviewer',
      category: 'testing-qa',
      description: 'Review a fixed diff.',
      developerInstructions: 'Find correctness defects.',
      sandboxMode: 'read-only',
    });
    await saveAgent({
      id: 'reviewer',
      name: 'reviewer',
      category: 'testing-qa',
      description: 'Review a fixed diff independently.',
      developerInstructions: 'Find correctness and security defects.',
      sandboxMode: 'read-only',
    });
    await importAgentToml(
      'name = "docs_researcher"\ndescription = "Explore code."\ndeveloper_instructions = "Read code and report evidence."\n',
    );

    const agents = await getAllAgents();
    expect(agents.map((agent) => agent.id)).toEqual(['docs_researcher', 'reviewer']);
    expect(agents.find((agent) => agent.id === 'reviewer')?.description).toContain('independently');
    expect(await fse.pathExists(path.join(tempHome, 'agents', 'reviewer', 'agent.toml'))).toBe(true);

    await deleteAgent('reviewer');
    expect((await getAllAgents()).map((agent) => agent.id)).toEqual(['docs_researcher']);
  });

  it('rejects unsupported native configuration without changing the catalog', async () => {
    await expect(importAgentToml(
      'name = "unsafe"\ndescription = "Unsafe."\ndeveloper_instructions = "Unsafe."\nmcp_servers = {}\n',
    )).rejects.toThrow(/unrecognized key/i);
    expect(await getAllAgents()).toEqual([]);
  });
});
