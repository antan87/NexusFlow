import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import fse from 'fs-extra';

import { generateSkills } from './skills-generator.js';
import { saveWorkspaceSkillsConfig } from '../utils/skills-catalog.js';
import type { WorkspaceContext, ProjectAnalysis, AIAssistant } from '../types.js';

describe('skills-generator', () => {
  let tempWorkspace: string;
  let tempHome: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-gen-skills-ws-'));
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-gen-skills-home-'));
    process.env.NEXUSFLOW_HOME = tempHome;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.NEXUSFLOW_HOME = originalEnv;
    } else {
      delete process.env.NEXUSFLOW_HOME;
    }
    await fse.remove(tempWorkspace);
    await fse.remove(tempHome);
  });



  it('deploys enabled skills across claude, antigravity, cursor, copilot, and codex', async () => {
    // Enable 2 specific skills
    await saveWorkspaceSkillsConfig(tempWorkspace, {
      enabledSkills: ['pr-review-toolkit', 'verifier-workspace'],
    });

    const ctx: WorkspaceContext = {
      feature: {
        id: 'test-feature',
        branchName: 'feature-test',
        description: 'Testing skills generation',
        repos: [],
        assistants: ['claude', 'antigravity', 'cursor', 'copilot', 'codex'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };

    const assistants: AIAssistant[] = ['claude', 'antigravity', 'cursor', 'copilot', 'codex'];
    await generateSkills(ctx, assistants, tempWorkspace);

    // 1. Claude: .claude/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'verifier-workspace', 'SKILL.md'))).toBe(true);

    // 2. Antigravity: .agents/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);

    // 3. Codex: .codex/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.codex', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);

    // 4. Copilot: .github/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.github', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);

    // 5. Cursor: .cursor/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.cursor', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);

    // No lossy rules/instructions copies
    expect(await fse.pathExists(path.join(tempWorkspace, '.cursor', 'rules', 'pr-review-toolkit.mdc'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.github', 'instructions', 'pr-review-toolkit.instructions.md'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.nexusflow', 'resources.lock.json'))).toBe(true);
  });

  it('respects empty enabledSkills array and deploys nothing when all are disabled', async () => {
    await saveWorkspaceSkillsConfig(tempWorkspace, {
      enabledSkills: [],
    });

    const ctx: WorkspaceContext = {
      feature: {
        id: 'test-feature',
        branchName: 'feature-test',
        description: 'Testing empty skills generation',
        repos: [],
        assistants: ['claude', 'antigravity'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };

    await generateSkills(ctx, ['claude', 'antigravity'], tempWorkspace);

    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'pr-review-toolkit'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'pr-review-toolkit'))).toBe(false);
  });

  it('auto-deploys dynamically inferred skills in default workspace', async () => {
    // Fresh workspace without custom config
    const mockAnalysis = new Map<string, ProjectAnalysis>();
    mockAnalysis.set('service-a', {
      name: 'service-a',
      path: path.join(tempWorkspace, 'service-a'),
      techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'backend' },
      dependencies: [{ name: 'shared-pkg', type: 'npm', version: '^1.0.0' }],
      ports: [],
      readmeSummary: 'Service A',
      existingAIConfigs: [],
      runConfig: {
        entryPoints: [{ projectPath: 'service-a', type: 'npm', command: 'npm start', port: 8080 }],
        databases: [],
        sharedInfraWarnings: [],
        committedSecrets: [],
        externalDependencies: [],
      },
    });
    mockAnalysis.set('lib-pkg', {
      name: 'lib-pkg',
      path: path.join(tempWorkspace, 'lib-pkg'),
      techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'library' },
      dependencies: [],
      ports: [],
      readmeSummary: 'Library',
      existingAIConfigs: [],
      produces: [{ name: 'shared-pkg', type: 'npm', version: '1.0.0' }],
    });

    const ctx: WorkspaceContext = {
      feature: {
        id: 'test-dynamic-skills',
        branchName: 'feature-test',
        description: 'Testing dynamic skills generation',
        repos: [],
        assistants: ['antigravity', 'claude'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [
        { name: 'service-a', path: path.join(tempWorkspace, 'service-a'), defaultBranch: 'main' },
        { name: 'lib-pkg', path: path.join(tempWorkspace, 'lib-pkg'), defaultBranch: 'main' },
      ],
      analysis: mockAnalysis,
    };

    await generateSkills(ctx, ['antigravity', 'claude'], tempWorkspace);

    // Both package loop and verifier should be deployed automatically in fresh workspace
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'nexusflow-local-package-loop', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'verifier-workspace', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'nexusflow-local-package-loop', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'verifier-workspace', 'SKILL.md'))).toBe(true);
  });

  it('respects explicit opt-out / disable: disable -> save -> refresh does not redeploy', async () => {
    // User explicitly disabled verifier-workspace and package loop
    await saveWorkspaceSkillsConfig(tempWorkspace, {
      enabledSkills: [],
      disabledSkills: ['verifier-workspace', 'nexusflow-local-package-loop'],
    });

    const mockAnalysis = new Map<string, ProjectAnalysis>();
    mockAnalysis.set('service-a', {
      name: 'service-a',
      path: path.join(tempWorkspace, 'service-a'),
      techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'backend' },
      dependencies: [{ name: 'shared-pkg', type: 'npm', version: '^1.0.0' }],
      ports: [],
      readmeSummary: 'Service A',
      existingAIConfigs: [],
      runConfig: {
        entryPoints: [{ projectPath: 'service-a', type: 'npm', command: 'npm start', port: 8080 }],
        databases: [],
        sharedInfraWarnings: [],
        committedSecrets: [],
        externalDependencies: [],
      },
    });

    const ctx: WorkspaceContext = {
      feature: {
        id: 'test-disabled-skills',
        branchName: 'feature-test',
        description: 'Testing disabled skills',
        repos: [],
        assistants: ['antigravity', 'claude'],
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [
        { name: 'service-a', path: path.join(tempWorkspace, 'service-a'), defaultBranch: 'main' },
      ],
      analysis: mockAnalysis,
    };

    // Run skill generation (refresh)
    await generateSkills(ctx, ['antigravity', 'claude'], tempWorkspace);

    // Disabled skills must NOT be deployed
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'verifier-workspace'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.claude', 'skills', 'verifier-workspace'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', 'nexusflow-local-package-loop'))).toBe(false);
  });
});
