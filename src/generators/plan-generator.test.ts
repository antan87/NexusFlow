import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { generateImplementationPlan } from './plan-generator.js';
import type { Feature, ProjectAnalysis, RepoInfo, WorkspaceContext } from '../types.js';

type Produced = NonNullable<ProjectAnalysis['produces']>[number];
type Consumed = ProjectAnalysis['dependencies'][number];

function analysisFor(
  name: string,
  repoPath: string,
  opts: { produces?: Produced[]; dependencies?: Consumed[]; languages?: string[] } = {},
): ProjectAnalysis {
  return {
    name,
    path: repoPath,
    techStack: {
      languages: opts.languages ?? ['typescript'],
      frameworks: [],
      buildTools: [],
      projectType: 'backend',
    },
    ports: [],
    existingAIConfigs: [],
    readmeSummary: '',
    produces: opts.produces,
    dependencies: opts.dependencies ?? [],
  } as unknown as ProjectAnalysis;
}

describe('generateImplementationPlan', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-plan-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  /** Builds a context over the given repos and returns the written plan. */
  async function planFor(
    repos: RepoInfo[],
    analysis: Map<string, ProjectAnalysis>,
  ): Promise<string> {
    const feature: Feature = {
      id: 'feat',
      branchName: 'feat',
      description: 'add a discount code to checkout',
      repos: repos.map((r) => r.path),
      assistants: ['claude'],
      workspacePath: dir,
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    const ctx: WorkspaceContext = { feature, repos, analysis };

    await generateImplementationPlan(ctx, dir);
    return fs.readFile(path.join(dir, 'nexusflow-plan.md'), 'utf-8');
  }

  /** Two repos with no package relationship between them. */
  function unrelated(): [RepoInfo[], Map<string, ProjectAnalysis>] {
    const a = path.join(dir, 'web');
    const b = path.join(dir, 'tool');
    return [
      [
        { name: 'web', path: a, defaultBranch: 'main' },
        { name: 'tool', path: b, defaultBranch: 'main' },
      ],
      new Map([
        [a, analysisFor('web', a)],
        [b, analysisFor('tool', b)],
      ]),
    ];
  }

  /** `core` publishes a package `web` depends on. */
  function related(): [RepoInfo[], Map<string, ProjectAnalysis>] {
    const core = path.join(dir, 'core');
    const web = path.join(dir, 'web');
    return [
      [
        { name: 'core', path: core, defaultBranch: 'main' },
        { name: 'web', path: web, defaultBranch: 'main' },
      ],
      new Map([
        [core, analysisFor('core', core, { produces: [{ name: '@acme/core', type: 'npm' }] })],
        [web, analysisFor('web', web, { dependencies: [{ name: '@acme/core', type: 'npm', version: '^1.0.0' }] })],
      ]),
    ];
  }

  describe('when no repo depends on another', () => {
    it('says so once instead of five times', async () => {
      const content = await planFor(...unrelated());

      expect(content).toContain('No package dependencies were detected');
      // Every section below existed only to describe cross-repo structure.
      expect(content).not.toContain('```mermaid');
      expect(content).not.toContain('Suggested Implementation Order');
      expect(content).not.toContain('Dependency Table');
      expect(content).not.toContain('Contracts & Clients');
      expect(content).not.toContain('Local Package Development Loop');
    });

    it('never claims other repos depend on them, because none do', async () => {
      const content = await planFor(...unrelated());

      expect(content).not.toContain('Other repos depend on them');
      expect(content).not.toContain('depended on by');
    });

    it('counts the repos correctly for one and for several', async () => {
      const [repos, analysis] = unrelated();
      expect(await planFor(repos, analysis)).toContain('the 2 repos');

      const [single] = repos;
      expect(await planFor([single!], new Map([[single!.path, analysis.get(single!.path)!]])))
        .toContain('the single repo');
    });

    it('stays short, since it has one fact to convey', async () => {
      const content = await planFor(...unrelated());

      expect(content.length).toBeLessThan(600);
    });

    it('says how to get a real plan', async () => {
      const content = await planFor(...unrelated());

      expect(content).toContain('nexusflow refresh');
    });
  });

  describe('when one repo depends on another', () => {
    it('emits the order, the diagram and the table', async () => {
      const content = await planFor(...related());

      expect(content).toContain('```mermaid');
      expect(content).toContain('Suggested Implementation Order');
      expect(content).toContain('Dependency Table');
      expect(content.indexOf('**Repos:** core')).toBeLessThan(content.indexOf('**Repos:** web'));
    });

    it('names the actual downstream consumer rather than asserting one exists', async () => {
      const content = await planFor(...related());

      expect(content).toContain('core is depended on by a later phase');
    });

    it('lists the shared package with its real consumer', async () => {
      const content = await planFor(...related());

      expect(content).toContain('Contracts & Clients');
      expect(content).toContain('`@acme/core`');
      expect(content).toContain('`web` (^1.0.0)');
      expect(content).not.toContain('_None_');
    });

    it('gives the npm dev loop and not the NuGet one', async () => {
      const content = await planFor(...related());

      expect(content).toContain('Local Package Development Loop');
      expect(content).toContain('npm link');
      expect(content).not.toContain('dotnet pack');
    });

    it('omits the Contributing Projects column when nothing has one', async () => {
      // It is a .csproj-only concept; an npm workspace rendered it as a dash.
      const content = await planFor(...related());

      expect(content).not.toContain('Contributing Projects');
    });
  });

  describe('a published package nobody in the workspace consumes', () => {
    it('is not reported as a cross-repo contract', async () => {
      // This is the single-repo case that produced a three-row table of
      // packages with "_None_" consumers and a dev loop that could not apply.
      const repo = path.join(dir, 'lib');
      const content = await planFor(
        [{ name: 'lib', path: repo, defaultBranch: 'main' }],
        new Map([[
          repo,
          analysisFor('lib', repo, {
            produces: [
              { name: '@acme/lib', type: 'npm' },
              { name: '@acme/lib-cli', type: 'npm' },
            ],
          }),
        ]]),
      );

      expect(content).not.toContain('@acme/lib');
      expect(content).not.toContain('Local Package Development Loop');
      expect(content).toContain('No package dependencies were detected');
    });
  });

  describe('robustness', () => {
    it('falls back to an alphabetical list when there is no analysis', async () => {
      const [repos] = unrelated();
      const content = await planFor(repos, new Map());

      expect(content).toContain('- tool');
      expect(content).toContain('- web');
      expect(content.indexOf('- tool')).toBeLessThan(content.indexOf('- web'));
    });

    it('survives an analysis carrying no dependency array', async () => {
      const repo = path.join(dir, 'solo');
      const analysis = analysisFor('solo', repo);
      delete (analysis as { dependencies?: unknown }).dependencies;

      const content = await planFor(
        [{ name: 'solo', path: repo, defaultBranch: 'main' }],
        new Map([[repo, analysis]]),
      );

      expect(content).toContain('No package dependencies were detected');
    });
  });
});
