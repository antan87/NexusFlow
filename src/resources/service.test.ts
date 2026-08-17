import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import fse from 'fs-extra';

import { saveAgent } from './agents-catalog.js';
import {
  ResourceSelectionError,
  validateResourceSelections,
  withResourceAdministrationLock,
} from './service.js';

describe('resource administration service', () => {
  let tempHome: string;
  const originalHome = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-resource-service-'));
    process.env.NEXUSFLOW_HOME = tempHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.NEXUSFLOW_HOME;
    else process.env.NEXUSFLOW_HOME = originalHome;
    await fse.remove(tempHome);
  });

  it('rejects missing selections and accepts existing underscore-style agents', async () => {
    await saveAgent({
      name: 'docs_researcher',
      category: 'general',
      description: 'Use when researching docs.',
      developerInstructions: 'Research official documentation.',
    });

    await expect(validateResourceSelections(['pr-review-toolkit'], ['docs_researcher'])).resolves.toBeUndefined();
    await expect(validateResourceSelections(['missing-skill'], ['missing_agent'])).rejects.toMatchObject({
      missingSkills: ['missing-skill'],
      missingAgents: ['missing_agent'],
    } satisfies Partial<ResourceSelectionError>);
  });

  it('serializes administration operations under one shared boundary', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });

    const first = withResourceAdministrationLock(async () => {
      events.push('first-start');
      firstStarted();
      await firstGate;
      events.push('first-end');
    });
    await started;
    const second = withResourceAdministrationLock(async () => {
      events.push('second-start');
      events.push('second-end');
    });

    expect(events).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });
});
