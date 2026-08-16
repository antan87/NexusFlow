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

    // 3. Cursor: .cursor/rules/<skillName>.mdc
    expect(await fse.pathExists(path.join(tempWorkspace, '.cursor', 'rules', 'pr-review-toolkit.mdc'))).toBe(true);
    const cursorContent = await fs.readFile(path.join(tempWorkspace, '.cursor', 'rules', 'pr-review-toolkit.mdc'), 'utf-8');
    expect(cursorContent).toContain('alwaysApply: false');

    // 4. Copilot: .github/instructions/<skillName>.instructions.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.github', 'instructions', 'pr-review-toolkit.instructions.md'))).toBe(true);

    // 5. Codex: .codex/skills/<skillName>/SKILL.md
    expect(await fse.pathExists(path.join(tempWorkspace, '.codex', 'skills', 'pr-review-toolkit', 'SKILL.md'))).toBe(true);
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
});
