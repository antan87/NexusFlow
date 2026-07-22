import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildContextContent } from './base.js';
import type { Feature, ProjectAnalysis, WorkspaceContext } from '../types.js';

/** Minimal ProjectAnalysis with the fields the section builder reads. */
function analysisFor(name: string, repoPath: string, languages: string[]): ProjectAnalysis {
  return {
    name,
    path: repoPath,
    techStack: { languages, frameworks: [], buildTools: [], projectType: 'backend' },
    endpoints: [],
    ports: [],
    existingAIConfigs: [],
    readmeSummary: '',
  } as unknown as ProjectAnalysis;
}

describe('buildContextContent — Verification & Services section', () => {
  let dir: string;
  let nodeRepo: string;
  let pyRepo: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-base-test-'));
    // A Node repo with a detectable dev script.
    nodeRepo = path.join(dir, 'my-web');
    await fs.mkdir(nodeRepo, { recursive: true });
    await fs.writeFile(
      path.join(nodeRepo, 'package.json'),
      JSON.stringify({ name: 'my-web', scripts: { dev: 'vite --port 5173' } }),
      'utf-8',
    );
    // A Python repo with no runnable service config.
    pyRepo = path.join(dir, 'my-tool');
    await fs.mkdir(pyRepo, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  function ctxFor(feature: Partial<Feature>): WorkspaceContext {
    const base: Feature = {
      id: 'feat',
      branchName: 'feat',
      description: 'test',
      repos: [nodeRepo, pyRepo],
      assistants: ['claude'],
      workspacePath: path.join(dir, 'ws'),
      createdAt: '2026-07-17T00:00:00.000Z',
      ...feature,
    };
    return {
      feature: base,
      repos: [
        { name: 'my-web', path: nodeRepo, defaultBranch: 'main' },
        { name: 'my-tool', path: pyRepo, defaultBranch: 'main' },
      ],
      analysis: new Map([
        [nodeRepo, analysisFor('my-web', nodeRepo, ['typescript'])],
        [pyRepo, analysisFor('my-tool', pyRepo, ['python'])],
      ]),
    };
  }

  it('derives per-repo test and run commands from analysis + service detection', async () => {
    const content = await buildContextContent(ctxFor({}));

    expect(content).toContain('## Verification & Services');
    // Conventional test commands per detected language.
    expect(content).toContain('| my-web | `npm test` | `npm run dev` |');
    // No runnable service detected → em dash.
    expect(content).toContain('| my-tool | `pytest` | — |');
    // The old hand-entered section heading is gone.
    expect(content).not.toContain('Workspace Resumption');
  });

  it('renders legacy custom resumption commands from old manifests', async () => {
    const content = await buildContextContent(
      ctxFor({ resumption: { testCommand: 'make integration-test', mockCommand: 'docker compose up mocks' } }),
    );

    expect(content).toContain('Custom workspace commands:');
    expect(content).toContain('`docker compose up mocks`');
    expect(content).toContain('`make integration-test`');
  });

  it('filters standard test commands out of the legacy path', async () => {
    const content = await buildContextContent(ctxFor({ resumption: { testCommand: 'npm run test' } }));

    // The stored standard command adds nothing beyond the derived table.
    expect(content).not.toContain('Custom workspace commands:');
  });
});
