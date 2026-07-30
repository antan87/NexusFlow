import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildContextContent } from './base.js';
import type { Feature, ProjectAnalysis, WorkspaceContext } from '../types.js';

/** Minimal ProjectAnalysis with the fields the context builder reads. */
function analysisFor(name: string, repoPath: string, languages: string[]): ProjectAnalysis {
  return {
    name,
    path: repoPath,
    techStack: { languages, frameworks: [], buildTools: [], projectType: 'backend' },
    ports: [],
    existingAIConfigs: [],
    readmeSummary: '',
  } as unknown as ProjectAnalysis;
}

describe('buildContextContent', () => {
  let dir: string;
  let nodeRepo: string;
  let pyRepo: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-base-test-'));
    nodeRepo = path.join(dir, 'my-web');
    await fs.mkdir(nodeRepo, { recursive: true });
    await fs.writeFile(
      path.join(nodeRepo, 'package.json'),
      JSON.stringify({ name: 'my-web', scripts: { dev: 'vite --port 5173' } }),
      'utf-8',
    );
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
      description: 'add a discount code to checkout',
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

  /** `my-tool` publishes a package `my-web` consumes. */
  function relatedCtx(): WorkspaceContext {
    const ctx = ctxFor({});
    const tool = ctx.analysis!.get(pyRepo)!;
    const web = ctx.analysis!.get(nodeRepo)!;
    (tool as { produces?: unknown }).produces = [{ name: 'shared-lib', type: 'npm' }];
    (web as { dependencies?: unknown }).dependencies = [
      { name: 'shared-lib', type: 'npm' },
      { name: 'react', type: 'npm' },
    ];
    return ctx;
  }

  describe('what it must say', () => {
    it('leads with the task, because that is what the work is', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content.startsWith('# feat')).toBe(true);
      expect(content).toContain('add a discount code to checkout');
    });

    it('gives every repo a location and a verify command in one row', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).toContain('| `my-web` | `my-web` | `npm test` |');
      expect(content).toContain('| `my-tool` | `my-tool` | `pytest` |');
    });

    it('states the cross-repo tie in both directions', async () => {
      // The one thing a single-repo view cannot show, and the reason a
      // multi-repo workspace is worth generating at all.
      const content = await buildContextContent(relatedCtx());

      expect(content).toContain('used by `my-web`');
      expect(content).toContain('needs `my-tool`');
    });

    it('names where to start, and orders the rows to match', async () => {
      const content = await buildContextContent(relatedCtx());

      expect(content).toContain('Start with `my-tool`');
      expect(content.indexOf('| `my-tool` |')).toBeLessThan(content.indexOf('| `my-web` |'));
    });

    it('keeps the worktree rule, which is not inferable', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).toContain('Do not edit the original repositories elsewhere on disk');
      expect(content).toContain('`feat`');
    });

    it('points at the other files rather than inlining them', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).toContain('nexusflow-knowledge.md');
      expect(content).toContain('nexusflow-plan.md');
      expect(content).toContain('nexusflow-map-<repo>.md');
    });

    it('tells the agent to search the knowledge file, not read it whole', async () => {
      // It reached 38 KB on a real workspace — about 9,500 tokens — while the
      // pointer said "skim the headings", which costs the entire file to do.
      const content = await buildContextContent(ctxFor({}));

      expect(content).toContain('`###` heading');
      expect(content).toContain('not the whole file');
    });

    it('points at the branch diff once the branch has one', async () => {
      const ctx = ctxFor({});
      ctx.hasBranchDiff = true;

      expect(await buildContextContent(ctx)).toContain('nexusflow-diff-context.md');
    });

    it('keeps the diff pointer when the diff state is unknown', async () => {
      // Undetermined is not the same as empty; a missing pointer costs more than
      // a redundant one.
      const content = await buildContextContent(ctxFor({}));

      expect(content).toContain('nexusflow-diff-context.md');
    });

    it('names repos that carry their own instructions, which override these', async () => {
      const ctx = ctxFor({});
      (ctx.analysis!.get(nodeRepo)! as { existingAIConfigs: unknown }).existingAIConfigs = [
        { relativePath: 'CLAUDE.md', assistant: 'claude' },
      ];

      const content = await buildContextContent(ctx);

      expect(content).toContain('take precedence');
      expect(content).toContain('`my-web` (CLAUDE.md)');
    });
  });

  describe('what it must NOT say', () => {
    // Two independent agents evaluating a generated workspace used none of this,
    // and it is where a wrong claim appeared: "Build tools: none detected" for a
    // repo whose package.json has "build": "tsc". Anything a manifest already
    // states is better read from the manifest, where it cannot go stale.
    it('omits per-repo tech-stack metadata, which is derivable and went stale', async () => {
      const content = await buildContextContent(ctxFor({}));

      for (const label of ['**Type**', '**Languages**', '**Frameworks**', '**Build tools**', '**Ports**']) {
        expect(content, label).not.toContain(label);
      }
    });

    it('omits First Steps, which told the agent to stop and ask for approval', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).not.toContain('First Steps');
      expect(content).not.toContain('Obtain Approval');
      expect(content).not.toContain('before writing any code');
    });

    it('omits absolute file:/// links, which were 24% of the old file', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).not.toContain('file:///');
    });

    it('omits the git and npm advice any assistant already follows', async () => {
      const content = await buildContextContent(ctxFor({}));

      expect(content).not.toContain('git status');
      expect(content).not.toContain('npm install');
      expect(content).not.toContain('**Instruction**');
    });

    it('omits the branch-diff pointer when the branch has no diff', async () => {
      // The file exists but says only "no changed files detected", so following
      // the pointer buys a read and no information.
      const ctx = ctxFor({});
      ctx.hasBranchDiff = false;

      expect(await buildContextContent(ctx)).not.toContain('nexusflow-diff-context.md');
    });

    it('says nothing about relationships or ordering when there are none', async () => {
      // An empty "needs: none" column and a start hint that asserts a
      // non-existent dependency would both be worse than silence.
      const content = await buildContextContent(ctxFor({}));

      expect(content).not.toContain('needs `');
      expect(content).not.toContain('used by `');
      expect(content).not.toContain('Start with');
    });
  });

  describe('size', () => {
    it('stays small enough not to crowd the context window', async () => {
      // The docs advise under 200 lines because longer files reduce adherence,
      // not merely cost tokens. Two repos should be nowhere near that.
      const content = await buildContextContent(relatedCtx());

      expect(content.split('\n').length).toBeLessThan(40);
      expect(content.length).toBeLessThan(1600);
    });
  });

  describe('in-place mode', () => {
    it('gives absolute paths and each repo branch, which vary per repo', async () => {
      const ctx = ctxFor({ mode: 'in-place' });
      ctx.feature.repoBranches = { 'my-web': 'existing-feature' };

      const content = await buildContextContent(ctx);

      expect(content).toContain(nodeRepo);
      expect(content).toContain('(on existing-feature)');
      expect(content).toContain('NexusFlow does not manage branches here');
      expect(content).not.toContain('Do not edit the original repositories');
    });
  });

  describe('robustness', () => {
    it('survives an analysis with no dependency list rather than throwing', async () => {
      await expect(buildContextContent(ctxFor({}))).resolves.toContain('## Repos');
    });

    it('still lists repos when there is no analysis at all', async () => {
      const ctx = ctxFor({});
      ctx.analysis = undefined;

      const content = await buildContextContent(ctx);

      expect(content).toContain('`my-web`');
      expect(content).toContain('`my-tool`');
    });

    it('carries the teamwork strategy when one was chosen', async () => {
      const content = await buildContextContent(
        ctxFor({ teamworkInstructions: '# Plan then implement' }),
      );

      expect(content).toContain('How to work together');
      expect(content).toContain('Plan then implement');
    });
  });
});
