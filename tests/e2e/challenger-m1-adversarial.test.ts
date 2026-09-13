/**
 * @module tests/e2e/challenger-m1-adversarial.test
 * Empirical Challenger Test Suite for Milestone M1 (Skills Core & Catalog Cleanup).
 * Focuses on materializer safety, conflict prevention, preservation of local user code,
 * and multi-assistant adapter mirroring (.claude, .cursor, .codex, .github).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import fse from 'fs-extra';

import type { AIAssistant, SkillItem } from '../../src/types.js';
import {
  getAllSkills,
  saveSkill,
  getWorkspaceSkillsConfig,
  saveWorkspaceSkillsConfig,
} from '../../src/utils/skills-catalog.js';
import {
  reconcileWorkspaceResources,
  ResourceConflictError,
  isWorkspaceLocalSkill,
  resolveResourceLockPath,
} from '../../src/resources/materializer.js';
import { generateSkills } from '../../src/generators/skills-generator.js';

describe('Adversarial Challenger Suite: Workspace-Local Skills & Materializer Safety', () => {
  let workspace: string;
  let homeDir: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'challenger-m1-ws-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'challenger-m1-home-'));
    process.env.NEXUSFLOW_HOME = homeDir;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.NEXUSFLOW_HOME = originalEnv;
    } else {
      delete process.env.NEXUSFLOW_HOME;
    }
    await fse.remove(workspace);
    await fse.remove(homeDir);
  });

  it('empirically verifies workspace-local skill materialization: NO ResourceConflictError and complete mirroring', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor', 'codex', 'copilot'];

    // 1. Manually author a local skill in .agents/skills/local-analyzer
    const skillDir = path.join(workspace, '.agents', 'skills', 'local-analyzer');
    await fse.ensureDir(path.join(skillDir, 'scripts'));
    await fse.ensureDir(path.join(skillDir, 'references'));

    const originalSkillContent = '# Local Project Analyzer\n\nCustom workspace analysis rules for local repo.';
    const originalSkillMd = `---\nname: local-analyzer\ndescription: Custom workspace analysis rules.\n---\n\n${originalSkillContent}\n`;
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), originalSkillMd, 'utf-8');

    const originalScriptContent = '#!/bin/bash\necho "Running local analysis script"\nexit 0\n';
    const scriptPath = path.join(skillDir, 'scripts', 'analyze.sh');
    await fs.writeFile(scriptPath, originalScriptContent, 'utf-8');
    await fs.chmod(scriptPath, 0o755);

    const originalRefContent = '{"threshold": 95, "strictMode": true}\n';
    await fs.writeFile(path.join(skillDir, 'references', 'config.json'), originalRefContent, 'utf-8');

    // 2. Discover skills via catalog
    const skills = await getAllSkills(workspace);
    const localSkill = skills.find((s) => s.id === 'local-analyzer');
    expect(localSkill).toBeDefined();
    expect(localSkill?.scope).toBe('workspace');
    expect(isWorkspaceLocalSkill(localSkill!, workspace)).toBe(true);

    // 3. Run reconcileWorkspaceResources
    const result = await reconcileWorkspaceResources(workspace, assistants, skills, []);
    expect(result).toBeDefined();

    // 4. Assert NO modification to local source code in .agents/skills/local-analyzer
    const actualLocalSkillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    expect(actualLocalSkillMd).toBe(originalSkillMd);
    expect(actualLocalSkillMd).not.toContain('AUTO-GENERATED'); // Must NOT inject generated header into source

    const actualLocalScript = await fs.readFile(scriptPath, 'utf-8');
    expect(actualLocalScript).toBe(originalScriptContent);
    if (process.platform !== 'win32') {
      expect((await fs.stat(scriptPath)).mode & 0o777).toBe(0o755);
    }

    // 5. Assert mirroring across all target assistant adapter roots
    // Claude
    const claudeSkill = path.join(workspace, '.claude', 'skills', 'local-analyzer', 'SKILL.md');
    const claudeScript = path.join(workspace, '.claude', 'skills', 'local-analyzer', 'scripts', 'analyze.sh');
    const claudeRef = path.join(workspace, '.claude', 'skills', 'local-analyzer', 'references', 'config.json');
    expect(await fse.pathExists(claudeSkill)).toBe(true);
    expect(await fse.pathExists(claudeScript)).toBe(true);
    expect(await fse.pathExists(claudeRef)).toBe(true);
    expect(await fs.readFile(claudeSkill, 'utf-8')).toContain('AUTO-GENERATED');
    if (process.platform !== 'win32') {
      expect((await fs.stat(claudeScript)).mode & 0o777).toBe(0o755);
    }

    // Cursor, Codex, Copilot read .agents/skills/ natively; no redundant projections
    const cursorSkill = path.join(workspace, '.cursor', 'skills', 'local-analyzer', 'SKILL.md');
    expect(await fse.pathExists(cursorSkill)).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'local-analyzer', 'scripts', 'analyze.sh'))).toBe(false);

    // Codex
    const codexSkill = path.join(workspace, '.codex', 'skills', 'local-analyzer', 'SKILL.md');
    expect(await fse.pathExists(codexSkill)).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.codex', 'skills', 'local-analyzer', 'references', 'config.json'))).toBe(false);

    // Copilot (.github/skills/)
    const copilotSkill = path.join(workspace, '.github', 'skills', 'local-analyzer', 'SKILL.md');
    expect(await fse.pathExists(copilotSkill)).toBe(false);

    // Lock file check: Lock MUST NOT claim ownership of .agents/skills/local-analyzer
    const lockPath = await resolveResourceLockPath(workspace);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    const ownedPaths: string[] = lock.outputs.map((o: { path: string }) => o.path);
    expect(ownedPaths.some((p) => p.startsWith('.agents/skills/local-analyzer'))).toBe(false);
    expect(ownedPaths).toContain('.claude/skills/local-analyzer/SKILL.md');
    expect(ownedPaths).not.toContain('.cursor/skills/local-analyzer/SKILL.md');
    expect(ownedPaths).not.toContain('.codex/skills/local-analyzer/SKILL.md');
    expect(ownedPaths).not.toContain('.github/skills/local-analyzer/SKILL.md');
  });

  it('empirically guarantees that unmounting or disabling a local skill NEVER deletes or touches .agents/skills/<id>', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor', 'codex', 'copilot'];

    // 1. Author local skill
    const skillDir = path.join(workspace, '.agents', 'skills', 'critical-local-code');
    await fse.ensureDir(path.join(skillDir, 'scripts'));
    const originalCode = '#!/bin/bash\n# CRITICAL USER CODE - DO NOT LOSE\nrm -rf /tmp/test\n';
    await fs.writeFile(path.join(skillDir, 'scripts', 'critical.sh'), originalCode, 'utf-8');
    const originalMd = '---\nname: critical-local-code\ndescription: Must never be deleted.\n---\n\n# Critical\n';
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), originalMd, 'utf-8');

    // Mount / reconcile
    const skills = await getAllSkills(workspace);
    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'critical-local-code', 'SKILL.md'))).toBe(true);

    // 2. Unmount by calling reconcileWorkspaceResources with empty skills
    const unmountResult = await reconcileWorkspaceResources(workspace, assistants, [], []);
    expect(unmountResult).toBeDefined();

    // 3. Verify assistant mirrors WERE deleted
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'critical-local-code'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'critical-local-code'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.codex', 'skills', 'critical-local-code'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.github', 'skills', 'critical-local-code'))).toBe(false);

    // 4. CRITICAL CHECK: Local authoring directory in .agents/skills/ MUST BE 100% INTACT
    expect(await fse.pathExists(skillDir)).toBe(true);
    expect(await fse.pathExists(path.join(skillDir, 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(skillDir, 'scripts', 'critical.sh'))).toBe(true);
    expect(await fs.readFile(path.join(skillDir, 'scripts', 'critical.sh'), 'utf-8')).toBe(originalCode);
    expect(await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8')).toBe(originalMd);
  });

  it('empirically verifies mid-flight edits to local user code can be reconciled without drift conflicts', async () => {
    const assistants: AIAssistant[] = ['claude', 'cursor'];

    // 1. Initial skill version
    const skillDir = path.join(workspace, '.agents', 'skills', 'evolving-skill');
    await fse.ensureDir(skillDir);
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: evolving-skill\ndescription: Initial version.\n---\n\n# Version 1\n',
      'utf-8',
    );

    let skills = await getAllSkills(workspace);
    await reconcileWorkspaceResources(workspace, assistants, skills, []);
    expect(await fs.readFile(path.join(workspace, '.claude', 'skills', 'evolving-skill', 'SKILL.md'), 'utf-8')).toContain('Version 1');

    // 2. User edits the source skill directly mid-flight
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: evolving-skill\ndescription: Evolved version.\n---\n\n# Version 2 - Mid flight edit\n',
      'utf-8',
    );

    // 3. Re-reconcile without any manual lock resetting
    skills = await getAllSkills(workspace);
    const updateResult = await reconcileWorkspaceResources(workspace, assistants, skills, []);
    expect(updateResult).toBeDefined();

    // 4. Verify mirrored Claude skill was updated cleanly to Version 2
    const claudeContent = await fs.readFile(path.join(workspace, '.claude', 'skills', 'evolving-skill', 'SKILL.md'), 'utf-8');
    expect(claudeContent).toContain('Version 2 - Mid flight edit');
    expect(claudeContent).not.toContain('Version 1');

    // 5. Verify source in .agents/skills was not overwritten or reverted
    const sourceContent = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8');
    expect(sourceContent).toContain('Version 2 - Mid flight edit');
    expect(sourceContent).not.toContain('AUTO-GENERATED');
  });

  it('empirically verifies coexistence and asymmetric cleanup: global skill removed from .agents, local skill preserved', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude'];

    // 1. Save global skill to user catalog
    await saveSkill({
      name: 'global-shared-tool',
      title: 'Global Shared Tool',
      description: 'Shared company tool.',
      content: '# Global Shared Tool\n',
    });

    // 2. Create local skill in workspace
    const localDir = path.join(workspace, '.agents', 'skills', 'workspace-only-tool');
    await fse.ensureDir(localDir);
    await fs.writeFile(
      path.join(localDir, 'SKILL.md'),
      '---\nname: workspace-only-tool\ndescription: Workspace only.\n---\n\n# Workspace Only Tool\n',
      'utf-8',
    );

    // 3. Reconcile with both
    const skills = await getAllSkills(workspace);
    expect(skills.some((s) => s.id === 'global-shared-tool')).toBe(true);
    expect(skills.some((s) => s.id === 'workspace-only-tool')).toBe(true);

    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Both should be in .agents/skills/ and .claude/skills/
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'global-shared-tool', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'workspace-only-tool', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'global-shared-tool', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'workspace-only-tool', 'SKILL.md'))).toBe(true);

    // 4. Now disable both
    await reconcileWorkspaceResources(workspace, assistants, [], []);

    // The global skill should be removed from .agents/skills and .claude/skills
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'global-shared-tool'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'global-shared-tool'))).toBe(false);

    // The local skill should be removed from .claude/skills BUT KEPT in .agents/skills
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'workspace-only-tool'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'workspace-only-tool'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'workspace-only-tool', 'SKILL.md'))).toBe(true);
  });

  it('empirically verifies shadowing: workspace skill overrides global skill without collision', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude'];

    // 1. Create global skill
    await saveSkill({
      name: 'linter-rules',
      title: 'Company Standard Linter',
      description: 'Standard company lint rules.',
      content: '# Company Standard Linter\nStandard rules.\n',
    });

    // 2. Create workspace-local skill with the exact same name
    const localDir = path.join(workspace, '.agents', 'skills', 'linter-rules');
    await fse.ensureDir(localDir);
    await fs.writeFile(
      path.join(localDir, 'SKILL.md'),
      '---\nname: linter-rules\ndescription: Custom project-specific linter.\n---\n\n# Project Specific Linter Override\nCustom rules.\n',
      'utf-8',
    );

    // 3. getAllSkills(workspace) should shadow global with local
    const skills = await getAllSkills(workspace);
    const linter = skills.find((s) => s.id === 'linter-rules');
    expect(linter?.scope).toBe('workspace');
    expect(linter?.description).toBe('Custom project-specific linter.');

    // 4. Reconcile
    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Local source is unmodified
    const localContent = await fs.readFile(path.join(localDir, 'SKILL.md'), 'utf-8');
    expect(localContent).toContain('Project Specific Linter Override');
    expect(localContent).not.toContain('Company Standard Linter');

    // Mirrored copy receives the workspace override, not the global
    const claudeContent = await fs.readFile(path.join(workspace, '.claude', 'skills', 'linter-rules', 'SKILL.md'), 'utf-8');
    expect(claudeContent).toContain('Project Specific Linter Override');
    expect(claudeContent).not.toContain('Company Standard Linter');
  });

  it('empirically verifies skills-generator pipeline with disabledSkills unmounting local skills safely', async () => {
    const assistants: AIAssistant[] = ['claude', 'cursor', 'antigravity'];

    // 1. Create local skill
    const localDir = path.join(workspace, '.agents', 'skills', 'pipeline-tested-skill');
    await fse.ensureDir(localDir);
    await fs.writeFile(
      path.join(localDir, 'SKILL.md'),
      '---\nname: pipeline-tested-skill\ndescription: Generator test.\n---\n\n# Pipeline Tested Skill\n',
      'utf-8',
    );

    const mockCtx = {
      feature: {
        id: 'test-feat',
        branchName: 'feat/test',
        description: 'test feature',
        repos: [],
        assistants,
        workspacePath: workspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
      analysis: new Map(),
    };

    // 2. Run generateSkills with default config -> local skill is auto-mounted
    await generateSkills(mockCtx as any, assistants, workspace);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'pipeline-tested-skill', 'SKILL.md'))).toBe(true);

    // 3. Disable the skill in .nexusflow/skills.json
    await saveWorkspaceSkillsConfig(workspace, {
      enabledSkills: [],
      disabledSkills: ['pipeline-tested-skill'],
    });

    // 4. Re-run generateSkills
    await generateSkills(mockCtx as any, assistants, workspace);

    // Mirror removed
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'pipeline-tested-skill'))).toBe(false);

    // Local user source preserved
    expect(await fse.pathExists(localDir)).toBe(true);
    expect(await fse.pathExists(path.join(localDir, 'SKILL.md'))).toBe(true);
  });

  it('empirically verifies unmanaged collision protection: a global skill colliding with unmanaged directory throws ResourceConflictError', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude'];

    // Create an unmanaged directory on disk in .agents/skills/unmanaged-collision
    const unmanagedDir = path.join(workspace, '.agents', 'skills', 'unmanaged-collision');
    await fse.ensureDir(unmanagedDir);
    await fs.writeFile(path.join(unmanagedDir, 'random-note.txt'), 'Not a managed skill', 'utf-8');

    // Now try to deploy a GLOBAL skill with that same ID (scope: 'global')
    const globalSkill: SkillItem = {
      id: 'unmanaged-collision',
      name: 'unmanaged-collision',
      title: 'Unmanaged Collision',
      category: 'general',
      description: 'Collision test',
      content: '# Collision',
      scope: 'global',
      custom: false,
    };

    // Reconciling a global skill on top of an unowned directory MUST throw ResourceConflictError
    await expect(
      reconcileWorkspaceResources(workspace, assistants, [globalSkill], []),
    ).rejects.toBeInstanceOf(ResourceConflictError);

    // The unmanaged user file must NOT be destroyed
    expect(await fs.readFile(path.join(unmanagedDir, 'random-note.txt'), 'utf-8')).toBe('Not a managed skill');
  });

  it('empirically verifies nested directories and executable file modes in local skills', async () => {
    const assistants: AIAssistant[] = ['claude', 'cursor'];

    const localDir = path.join(workspace, '.agents', 'skills', 'nested-mode-skill');
    await fse.ensureDir(path.join(localDir, 'scripts', 'nested', 'deep'));
    await fse.ensureDir(path.join(localDir, 'references', 'docs'));

    await fs.writeFile(
      path.join(localDir, 'SKILL.md'),
      '---\nname: nested-mode-skill\ndescription: Deeply nested skill test.\n---\n\n# Deep Skill\n',
      'utf-8',
    );

    const scriptPath = path.join(localDir, 'scripts', 'nested', 'deep', 'runner.sh');
    await fs.writeFile(scriptPath, '#!/bin/sh\necho "deep runner"\n', 'utf-8');
    await fs.chmod(scriptPath, 0o755);

    const docPath = path.join(localDir, 'references', 'docs', 'spec.md');
    await fs.writeFile(docPath, '# Deep Spec\n', 'utf-8');

    const skills = await getAllSkills(workspace);
    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Verify deep mirrors
    const claudeScript = path.join(workspace, '.claude', 'skills', 'nested-mode-skill', 'scripts', 'nested', 'deep', 'runner.sh');
    const claudeDoc = path.join(workspace, '.claude', 'skills', 'nested-mode-skill', 'references', 'docs', 'spec.md');
    expect(await fse.pathExists(claudeScript)).toBe(true);
    expect(await fse.pathExists(claudeDoc)).toBe(true);
    if (process.platform !== 'win32') {
      expect((await fs.stat(claudeScript)).mode & 0o777).toBe(0o755);
    }

    // Unmount and verify deep directories are removed from mirror, but kept in local
    await reconcileWorkspaceResources(workspace, assistants, [], []);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'nested-mode-skill'))).toBe(false);
    expect(await fse.pathExists(scriptPath)).toBe(true);
    expect(await fse.pathExists(docPath)).toBe(true);
  });

  it('empirically verifies UTF-8 BOM and Windows CRLF frontmatter handling in local skills', async () => {
    const assistants: AIAssistant[] = ['claude'];

    const localDir = path.join(workspace, '.agents', 'skills', 'bom-crlf-skill');
    await fse.ensureDir(localDir);

    // Write with UTF-8 BOM and CRLF
    const bomCrlfContent = '\uFEFF---\r\nname: bom-crlf-skill\r\ndescription: Skill with BOM and CRLF.\r\n---\r\n\r\n# BOM & CRLF Title\r\nInstructions here.\r\n';
    await fs.writeFile(path.join(localDir, 'SKILL.md'), bomCrlfContent, 'utf-8');

    const skills = await getAllSkills(workspace);
    const skill = skills.find((s) => s.id === 'bom-crlf-skill');
    expect(skill).toBeDefined();
    expect(skill?.description).toBe('Skill with BOM and CRLF.');

    // Reconcile
    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Mirrored copy exists and has valid normalized frontmatter
    const claudeSkill = path.join(workspace, '.claude', 'skills', 'bom-crlf-skill', 'SKILL.md');
    expect(await fse.pathExists(claudeSkill)).toBe(true);
    const mirroredContent = await fs.readFile(claudeSkill, 'utf-8');
    expect(mirroredContent).toContain('name: bom-crlf-skill');
    expect(mirroredContent).toContain('# BOM & CRLF Title');
    expect(mirroredContent.startsWith('\uFEFF')).toBe(false); // BOM stripped in mirror
  });

  it('empirically rejects symlinks inside local skill directories for security', async () => {
    const assistants: AIAssistant[] = ['claude'];

    const localDir = path.join(workspace, '.agents', 'skills', 'symlink-exploit-skill');
    await fse.ensureDir(path.join(localDir, 'scripts'));
    await fs.writeFile(
      path.join(localDir, 'SKILL.md'),
      '---\nname: symlink-exploit-skill\ndescription: Exploit attempt.\n---\n\n# Exploit\n',
      'utf-8',
    );

    // Symlink inside scripts pointing to /etc/passwd or similar
    const linkTarget = path.join(workspace, 'secret.txt');
    await fs.writeFile(linkTarget, 'secret data', 'utf-8');
    await fs.symlink(linkTarget, path.join(localDir, 'scripts', 'link.sh'));

    // 1. Catalog discovery MUST reject the skill with symlink and log a warning
    const skills = await getAllSkills(workspace);
    expect(skills.some((s) => s.id === 'symlink-exploit-skill')).toBe(false);

    // 2. If a caller bypassed catalog loading and passed the skill directly to materializer:
    const rawSkill: SkillItem = {
      id: 'symlink-exploit-skill',
      name: 'symlink-exploit-skill',
      title: 'Symlink Exploit',
      description: 'Exploit attempt.',
      content: '# Exploit',
      scope: 'workspace',
      sourcePath: localDir,
      custom: false,
    };

    await expect(
      reconcileWorkspaceResources(workspace, assistants, [rawSkill], []),
    ).rejects.toThrow(/linked files are not allowed/i);
  });
});
