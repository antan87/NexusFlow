import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import fse from 'fs-extra';
import { execa } from 'execa';

import { generateContextFiles } from '../generators/index.js';
import {
  saveSkill,
  saveWorkspaceSkillsConfig,
  getWorkspaceSkillsConfig,
  getAllSkills,
  DEFAULT_SKILLS,
} from '../utils/skills-catalog.js';
import type { WorkspaceContext, AIAssistant, ProjectAnalysis } from '../types.js';

describe('End-to-End Skills & Tooling Workflow Integration', () => {
  let tempWorkspace: string;
  let tempHome: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-e2e-ws-'));
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-e2e-home-'));
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


  it('generates complete multi-harness tooling and skills when a workspace is created', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor', 'copilot', 'codex'];

    const mockAnalysis = new Map<string, ProjectAnalysis>();
    mockAnalysis.set('core-service', {
      name: 'core-service',
      path: path.join(tempWorkspace, 'core-service'),
      techStack: {
        languages: ['typescript'],
        frameworks: [],
        buildTools: ['tsc'],
        projectType: 'backend',
      },
      dependencies: [{ name: '@acme/shared-lib', type: 'npm', version: '^1.0.0' }],
      ports: [{ port: 3000, protocol: 'http', source: 'src/server.ts' }],
      readmeSummary: 'Core backend service',
      existingAIConfigs: [],
      runConfig: {
        entryPoints: [{ projectPath: 'core-service', type: 'npm', command: 'npm run start', port: 3000 }],
        databases: [],
        sharedInfraWarnings: [],
        committedSecrets: [],
        externalDependencies: [],
      },

    });
    mockAnalysis.set('shared-lib', {
      name: 'shared-lib',
      path: path.join(tempWorkspace, 'shared-lib'),
      techStack: {
        languages: ['typescript'],
        frameworks: [],
        buildTools: ['tsc'],
        projectType: 'library',
      },
      dependencies: [],
      ports: [],
      readmeSummary: 'Shared core utility library',
      existingAIConfigs: [],
      produces: [{ name: '@acme/shared-lib', type: 'npm', version: '1.0.0' }],
    });



    const ctx: WorkspaceContext = {
      feature: {
        id: 'feature-order-flow',
        branchName: 'feat/order-flow',
        description: 'Implement multi-repo order flow with database migrations and PR checks',
        repos: [path.join(tempWorkspace, 'core-service'), path.join(tempWorkspace, 'shared-lib')],
        assistants,
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [
        { name: 'core-service', path: path.join(tempWorkspace, 'core-service'), defaultBranch: 'main' },
        { name: 'shared-lib', path: path.join(tempWorkspace, 'shared-lib'), defaultBranch: 'main' },
      ],
      analysis: mockAnalysis,
    };

    for (const repo of ctx.repos) {
      await fs.mkdir(repo.path, { recursive: true });
      await execa('git', ['init'], { cwd: repo.path });
      await execa('git', ['config', 'user.name', 'NexusFlow Test'], { cwd: repo.path });
      await execa('git', ['config', 'user.email', 'nexusflow-test@local'], { cwd: repo.path });
      await fs.writeFile(path.join(repo.path, 'README.md'), `# ${repo.name}\n`, 'utf-8');
      await execa('git', ['add', 'README.md'], { cwd: repo.path });
      await execa('git', ['commit', '-m', 'test fixture'], { cwd: repo.path });
    }

    await saveWorkspaceSkillsConfig(tempWorkspace, {
      enabledSkills: DEFAULT_SKILLS.map((skill) => skill.id),
    });

    // 1. Run the workspace generation pipeline
    await generateContextFiles(ctx, assistants, tempWorkspace);
    const artifactCommit = await execa('git', ['log', '-1', '--format=%s'], { cwd: tempWorkspace });
    expect(artifactCommit.stdout).toBe('chore(nexusflow): refresh workspace artifacts');
    const generationLock = JSON.parse(await fs.readFile(path.join(tempWorkspace, 'nexusflow.lock'), 'utf-8'));
    expect(generationLock.outputs).toHaveProperty('AGENTS.md');
    expect(Object.keys(generationLock.outputs)).toContain('.agents/skills/pr-review-toolkit/SKILL.md');

    // 2. Verify Google Antigravity tooling (.agents/skills/)
    const agyPrSkill = path.join(tempWorkspace, '.agents', 'skills', 'pr-review-toolkit', 'SKILL.md');
    expect(await fse.pathExists(agyPrSkill)).toBe(true);
    const agyContent = await fs.readFile(agyPrSkill, 'utf-8');
    expect(agyContent).toContain('name: pr-review-toolkit');
    expect(agyContent).not.toContain('allowed-tools:');
    expect(agyContent).toContain('# Pull Request Review Toolkit');

    // Dynamic cross-repo skills for Antigravity
    const agyPkgLoop = path.join(tempWorkspace, '.agents', 'skills', 'nexusflow-local-package-loop', 'SKILL.md');
    expect(await fse.pathExists(agyPkgLoop)).toBe(true);
    const agyVerifier = path.join(tempWorkspace, '.agents', 'skills', 'verifier-workspace', 'SKILL.md');
    expect(await fse.pathExists(agyVerifier)).toBe(true);

    // 3. Verify Claude Code tooling (.claude/skills/ and CLAUDE.md)
    const claudeSkill = path.join(tempWorkspace, '.claude', 'skills', 'pr-review-toolkit', 'SKILL.md');
    expect(await fse.pathExists(claudeSkill)).toBe(true);
    expect(await fse.pathExists(path.join(tempWorkspace, 'CLAUDE.md'))).toBe(true);

    // 4. Verify harness-native skill packages for Codex, Copilot, and Cursor
    const codexSkill = path.join(tempWorkspace, '.codex', 'skills', 'pr-review-toolkit', 'SKILL.md');
    expect(await fse.pathExists(codexSkill)).toBe(true);

    const copilotSkill = path.join(tempWorkspace, '.github', 'skills', 'pr-review-toolkit', 'SKILL.md');
    expect(await fse.pathExists(copilotSkill)).toBe(true);

    const cursorSkill = path.join(tempWorkspace, '.cursor', 'skills', 'pr-review-toolkit', 'SKILL.md');
    expect(await fse.pathExists(cursorSkill)).toBe(true);

    // Verify lossy rules or instruction-file conversions are not generated
    expect(await fse.pathExists(path.join(tempWorkspace, '.cursor', 'rules', 'pr-review-toolkit.mdc'))).toBe(false);
    expect(await fse.pathExists(path.join(tempWorkspace, '.github', 'instructions', 'pr-review-toolkit.instructions.md'))).toBe(false);
  });

  it('supports custom user skills with auxiliary references/scripts and workspace assignment filtering', async () => {
    // 1. Author a custom skill in the catalog
    await saveSkill({
      name: 'k8s-deployer',
      title: 'Kubernetes Deployer',
      category: 'testing-qa',
      description: 'Deploys microservices to local Minikube / Kind cluster',
      tags: ['k8s', 'minikube', 'devops'],
      allowedTools: ['run_command', 'view_file'],
      content: '# Kubernetes Deployer\n\nRun helm upgrade --install.',
      references: [{ name: 'values-local.yaml', relativePath: 'references/values-local.yaml', content: 'replicas: 1\n' }],
      scripts: [{ name: 'deploy.sh', relativePath: 'scripts/deploy.sh', content: '#!/bin/bash\nhelm install app .\n' }],
    });

    // Verify catalog discovery
    const catalog = await getAllSkills();
    expect(catalog.some((s) => s.id === 'k8s-deployer')).toBe(true);

    // 2. Selectively enable ONLY the custom skill in the workspace
    await saveWorkspaceSkillsConfig(tempWorkspace, {
      enabledSkills: ['k8s-deployer'],
    });

    const assistants: AIAssistant[] = ['antigravity', 'claude', 'codex'];
    const ctx: WorkspaceContext = {
      feature: {
        id: 'k8s-feature',
        branchName: 'feat/k8s',
        description: 'Deploy to K8s',
        repos: [],
        assistants,
        workspacePath: tempWorkspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };

    // 3. Generate workspace files
    await generateContextFiles(ctx, assistants, tempWorkspace);

    // 4. Verify custom skill and supporting references/scripts are deployed
    // Antigravity
    const agyK8sSkill = path.join(tempWorkspace, '.agents', 'skills', 'k8s-deployer', 'SKILL.md');
    const agyK8sRef = path.join(tempWorkspace, '.agents', 'skills', 'k8s-deployer', 'references', 'values-local.yaml');
    const agyK8sScript = path.join(tempWorkspace, '.agents', 'skills', 'k8s-deployer', 'scripts', 'deploy.sh');

    expect(await fse.pathExists(agyK8sSkill)).toBe(true);
    expect(await fse.pathExists(agyK8sRef)).toBe(true);
    expect(await fse.pathExists(agyK8sScript)).toBe(true);
    expect(await fs.readFile(agyK8sRef, 'utf-8')).toBe('replicas: 1\n');

    // Claude
    const claudeK8sRef = path.join(tempWorkspace, '.claude', 'skills', 'k8s-deployer', 'references', 'values-local.yaml');
    expect(await fse.pathExists(claudeK8sRef)).toBe(true);

    // Codex
    const codexK8sRef = path.join(tempWorkspace, '.codex', 'skills', 'k8s-deployer', 'references', 'values-local.yaml');
    expect(await fse.pathExists(codexK8sRef)).toBe(true);

    // Verify un-enabled template skill was NOT deployed
    const unEnabledSkill = path.join(tempWorkspace, '.agents', 'skills', 'pr-review-toolkit');
    expect(await fse.pathExists(unEnabledSkill)).toBe(false);
  });
});

