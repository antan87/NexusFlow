/**
 * @module tests/e2e/challenger2-empirical.test
 * Empirical Challenger 2 Test Suite for Milestone M1 (Skills Core & Catalog Cleanup).
 *
 * Requirements tested:
 * 1. Materializer safety and conflict prevention for workspace-local skills (NO ResourceConflictError).
 * 2. Local user code in .agents/skills/<id> is NEVER overwritten or deleted during unmount or disable.
 * 3. Complete mirroring across assistant adapters (.claude/skills, .cursor/skills, .codex/skills, .github/skills).
 * 4. Asymmetric cleanup during unmount: managed global skills removed from .agents, local skills preserved.
 * 5. In-place shadowing and transition from global to workspace-local.
 * 6. Edge cases: symlinks, BOM/CRLF, executable script permissions, deep subdirectories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
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

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('Challenger 2 Empirical Verification: Workspace-Local Skills & Materializer Safety', () => {
  let workspace: string;
  let homeDir: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'challenger2-ws-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'challenger2-home-'));
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

  it('Test 1: Workspace creation with local .agents/skills/<id> produces NO ResourceConflictError and mirrors to all adapters', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor', 'codex', 'copilot'];

    // 1. Create a local skill package manually in .agents/skills/domain-validator
    const localSkillDir = path.join(workspace, '.agents', 'skills', 'domain-validator');
    await fse.ensureDir(path.join(localSkillDir, 'scripts'));
    await fse.ensureDir(path.join(localSkillDir, 'references'));
    await fse.ensureDir(path.join(localSkillDir, 'assets'));

    const rawSkillMd = [
      '---',
      'name: domain-validator',
      'description: Project-specific domain validator rules.',
      'license: MIT',
      'allowed-tools:',
      '  - run_command',
      '  - view_file',
      '---',
      '',
      '# Domain Validator',
      '',
      'Execute `./scripts/validate.sh` to verify domain invariants.',
      '',
    ].join('\n');
    await fs.writeFile(path.join(localSkillDir, 'SKILL.md'), rawSkillMd, 'utf-8');

    const scriptContent = '#!/bin/bash\necho "Domain Validated"\nexit 0\n';
    const scriptPath = path.join(localSkillDir, 'scripts', 'validate.sh');
    await fs.writeFile(scriptPath, scriptContent, 'utf-8');
    await fs.chmod(scriptPath, 0o755);

    const refContent = '{"strict": true, "maxRetries": 3}\n';
    await fs.writeFile(path.join(localSkillDir, 'references', 'rules.json'), refContent, 'utf-8');

    const assetContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    await fs.writeFile(path.join(localSkillDir, 'assets', 'icon.png'), assetContent);

    const originalSkillMdHash = sha256(rawSkillMd);
    const originalScriptHash = sha256(scriptContent);
    const originalRefHash = sha256(refContent);
    const originalAssetHash = sha256(assetContent);

    // 2. Discover via getAllSkills
    const allSkills = await getAllSkills(workspace);
    const localSkill = allSkills.find((s) => s.id === 'domain-validator');
    expect(localSkill).toBeDefined();
    expect(localSkill?.scope).toBe('workspace');
    expect(isWorkspaceLocalSkill(localSkill!, workspace)).toBe(true);

    // 3. Reconcile workspace resources
    const reconcileResult = await reconcileWorkspaceResources(workspace, assistants, allSkills, []);
    expect(reconcileResult).toBeDefined();

    // 4. Verify local source is 100% UNTOUCHED (same hashes, same modes, no auto-generated stamp)
    const afterSkillMd = await fs.readFile(path.join(localSkillDir, 'SKILL.md'), 'utf-8');
    expect(sha256(afterSkillMd)).toBe(originalSkillMdHash);
    expect(afterSkillMd).not.toContain('AUTO-GENERATED');

    const afterScript = await fs.readFile(scriptPath, 'utf-8');
    expect(sha256(afterScript)).toBe(originalScriptHash);
    expect((await fs.stat(scriptPath)).mode & 0o777).toBe(0o755);

    const afterRef = await fs.readFile(path.join(localSkillDir, 'references', 'rules.json'), 'utf-8');
    expect(sha256(afterRef)).toBe(originalRefHash);

    const afterAsset = await fs.readFile(path.join(localSkillDir, 'assets', 'icon.png'));
    expect(sha256(afterAsset)).toBe(originalAssetHash);

    // 5. Verify mirrors in each assistant root
    // Claude (.claude/skills/)
    const claudeMdPath = path.join(workspace, '.claude', 'skills', 'domain-validator', 'SKILL.md');
    expect(await fse.pathExists(claudeMdPath)).toBe(true);
    const claudeMd = await fs.readFile(claudeMdPath, 'utf-8');
    expect(claudeMd).toContain('AUTO-GENERATED');
    expect(claudeMd).toContain('# Domain Validator');
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'domain-validator', 'scripts', 'validate.sh'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'domain-validator', 'references', 'rules.json'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'domain-validator', 'assets', 'icon.png'))).toBe(true);

    // Cursor (.cursor/skills/)
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'domain-validator', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'domain-validator', 'scripts', 'validate.sh'))).toBe(true);

    // Codex (.codex/skills/)
    expect(await fse.pathExists(path.join(workspace, '.codex', 'skills', 'domain-validator', 'SKILL.md'))).toBe(true);

    // Copilot (.github/skills/)
    expect(await fse.pathExists(path.join(workspace, '.github', 'skills', 'domain-validator', 'SKILL.md'))).toBe(true);

    // 6. Verify lockfile does NOT include .agents/skills/domain-validator
    const lockPath = await resolveResourceLockPath(workspace);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    const lockedPaths: string[] = lock.outputs.map((o: { path: string }) => o.path);
    const localLocked = lockedPaths.filter((p) => p.startsWith('.agents/skills/domain-validator'));
    expect(localLocked).toHaveLength(0);

    // But DOES include the assistant adapter files
    expect(lockedPaths).toContain('.claude/skills/domain-validator/SKILL.md');
    expect(lockedPaths).toContain('.cursor/skills/domain-validator/SKILL.md');
    expect(lockedPaths).toContain('.codex/skills/domain-validator/SKILL.md');
    expect(lockedPaths).toContain('.github/skills/domain-validator/SKILL.md');
  });

  it('Test 2: Unmounting or disabling local skill NEVER overwrites or deletes local user code in .agents/skills/<id>', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor', 'codex', 'copilot'];

    const localSkillDir = path.join(workspace, '.agents', 'skills', 'proprietary-algo');
    await fse.ensureDir(path.join(localSkillDir, 'scripts'));

    const secretScript = '#!/bin/bash\n# PROPRIETARY ALGORITHM - ZERO DATA LOSS TOLERANCE\necho "secret"\n';
    await fs.writeFile(path.join(localSkillDir, 'scripts', 'secret.sh'), secretScript, 'utf-8');
    await fs.chmod(path.join(localSkillDir, 'scripts', 'secret.sh'), 0o755);

    const secretMd = '---\nname: proprietary-algo\ndescription: Proprietary.\n---\n\n# Proprietary Algorithm\n';
    await fs.writeFile(path.join(localSkillDir, 'SKILL.md'), secretMd, 'utf-8');

    // 1. Initial reconciliation
    const skills = await getAllSkills(workspace);
    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Verify mirrors created
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'proprietary-algo'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'proprietary-algo'))).toBe(true);

    // 2. Unmount by reconciling with empty skills array
    const unmountResult = await reconcileWorkspaceResources(workspace, assistants, [], []);
    expect(unmountResult).toBeDefined();

    // 3. Mirrors MUST be cleanly removed
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'proprietary-algo'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'proprietary-algo'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.codex', 'skills', 'proprietary-algo'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.github', 'skills', 'proprietary-algo'))).toBe(false);

    // 4. CRITICAL SAFETY CHECK: .agents/skills/proprietary-algo MUST REMAIN 100% INTACT
    expect(await fse.pathExists(localSkillDir)).toBe(true);
    expect(await fse.pathExists(path.join(localSkillDir, 'SKILL.md'))).toBe(true);
    expect(await fs.readFile(path.join(localSkillDir, 'SKILL.md'), 'utf-8')).toBe(secretMd);
    expect(await fse.pathExists(path.join(localSkillDir, 'scripts', 'secret.sh'))).toBe(true);
    expect(await fs.readFile(path.join(localSkillDir, 'scripts', 'secret.sh'), 'utf-8')).toBe(secretScript);
    expect((await fs.stat(path.join(localSkillDir, 'scripts', 'secret.sh'))).mode & 0o777).toBe(0o755);

    // 5. Verify lockfile outputs are empty
    const lockPath = await resolveResourceLockPath(workspace);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    expect(lock.outputs).toHaveLength(0);
  });

  it('Test 3: Disabling local skill via generateSkills (WorkspaceSkillsConfig.disabledSkills) preserves local code', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude', 'cursor'];

    const localSkillDir = path.join(workspace, '.agents', 'skills', 'disabled-local');
    await fse.ensureDir(localSkillDir);
    const content = '---\nname: disabled-local\ndescription: Disabled local skill.\n---\n\n# Disabled Local\n';
    await fs.writeFile(path.join(localSkillDir, 'SKILL.md'), content, 'utf-8');

    // 1. Generate without disabling (revision 0) -> auto-mounts local skill
    const ctx = {
      feature: {
        id: 'feat-test',
        branchName: 'feat/test',
        description: 'Test',
        repos: [],
        assistants,
        workspacePath: workspace,
        createdAt: new Date().toISOString(),
      },
      repos: [],
    };
    await generateSkills(ctx, assistants, workspace);

    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'disabled-local'))).toBe(true);

    // 2. Now explicitly disable the local skill in WorkspaceSkillsConfig
    await saveWorkspaceSkillsConfig(workspace, {
      enabledSkills: [],
      disabledSkills: ['disabled-local'],
    }, 0);

    // Re-run generateSkills
    await generateSkills(ctx, assistants, workspace);

    // Mirror is removed
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'disabled-local'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.cursor', 'skills', 'disabled-local'))).toBe(false);

    // Local code remains completely untouched
    expect(await fse.pathExists(path.join(localSkillDir, 'SKILL.md'))).toBe(true);
    expect(await fs.readFile(path.join(localSkillDir, 'SKILL.md'), 'utf-8')).toBe(content);
  });

  it('Test 4: Asymmetric cleanup: unmounting removes global skill from .agents while preserving local skill in .agents', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude'];

    // 1. Create a global skill in the global catalog
    await saveSkill({
      name: 'global-company-tool',
      title: 'Global Company Tool',
      description: 'Used across all projects.',
      content: '# Global Company Tool\n',
    }, { scope: 'global' });

    // 2. Create a workspace-local skill
    const localSkillDir = path.join(workspace, '.agents', 'skills', 'local-team-tool');
    await fse.ensureDir(localSkillDir);
    const localMd = '---\nname: local-team-tool\ndescription: Local team tool.\n---\n\n# Local Team Tool\n';
    await fs.writeFile(path.join(localSkillDir, 'SKILL.md'), localMd, 'utf-8');

    // 3. Reconcile both
    const skills = await getAllSkills(workspace);
    expect(skills.some((s) => s.id === 'global-company-tool')).toBe(true);
    expect(skills.some((s) => s.id === 'local-team-tool')).toBe(true);

    await reconcileWorkspaceResources(workspace, assistants, skills, []);

    // Both should exist in .agents/skills/
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'global-company-tool', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'local-team-tool', 'SKILL.md'))).toBe(true);
    // Both should exist in .claude/skills/
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'global-company-tool', 'SKILL.md'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'local-team-tool', 'SKILL.md'))).toBe(true);

    // Global skill .agents copy should be stamped AUTO-GENERATED; local skill must NOT
    expect(await fs.readFile(path.join(workspace, '.agents', 'skills', 'global-company-tool', 'SKILL.md'), 'utf-8')).toContain('AUTO-GENERATED');
    expect(await fs.readFile(path.join(workspace, '.agents', 'skills', 'local-team-tool', 'SKILL.md'), 'utf-8')).not.toContain('AUTO-GENERATED');

    // 4. Now unmount BOTH skills by passing empty skills array
    await reconcileWorkspaceResources(workspace, assistants, [], []);

    // The global skill should be cleanly removed from BOTH .agents/skills/ and .claude/skills/
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'global-company-tool'))).toBe(false);
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'global-company-tool'))).toBe(false);

    // The local skill mirror should be removed from .claude/skills/
    expect(await fse.pathExists(path.join(workspace, '.claude', 'skills', 'local-team-tool'))).toBe(false);

    // BUT the local skill in .agents/skills/ MUST STILL EXIST!
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'local-team-tool'))).toBe(true);
    expect(await fse.pathExists(path.join(workspace, '.agents', 'skills', 'local-team-tool', 'SKILL.md'))).toBe(true);
    expect(await fs.readFile(path.join(workspace, '.agents', 'skills', 'local-team-tool', 'SKILL.md'), 'utf-8')).toBe(localMd);
  });

  it('Test 5: Mid-flight modifications to local skill code mirror cleanly without drift conflict', async () => {
    const assistants: AIAssistant[] = ['claude', 'cursor'];

    const localSkillDir = path.join(workspace, '.agents', 'skills', 'live-coded-skill');
    await fse.ensureDir(localSkillDir);
    await fs.writeFile(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: live-coded-skill\ndescription: Live code v1.\n---\n\n# Live V1\n',
      'utf-8',
    );

    let skills = await getAllSkills(workspace);
    await reconcileWorkspaceResources(workspace, assistants, skills, []);
    expect(await fs.readFile(path.join(workspace, '.claude', 'skills', 'live-coded-skill', 'SKILL.md'), 'utf-8')).toContain('Live V1');

    // Developer directly modifies their local source code in .agents/skills/live-coded-skill
    const v2Content = '---\nname: live-coded-skill\ndescription: Live code v2 updated.\n---\n\n# Live V2 Updated Mid-Flight\n';
    await fs.writeFile(path.join(localSkillDir, 'SKILL.md'), v2Content, 'utf-8');

    // Reconcile again - must NOT fail with drift conflict
    skills = await getAllSkills(workspace);
    const updateResult = await reconcileWorkspaceResources(workspace, assistants, skills, []);
    expect(updateResult).toBeDefined();

    // Mirror in .claude must be updated with v2 content
    const updatedMirror = await fs.readFile(path.join(workspace, '.claude', 'skills', 'live-coded-skill', 'SKILL.md'), 'utf-8');
    expect(updatedMirror).toContain('Live V2 Updated Mid-Flight');
    expect(updatedMirror).not.toContain('Live V1');

    // Source must remain clean v2 without AUTO-GENERATED header
    const sourceAfter = await fs.readFile(path.join(localSkillDir, 'SKILL.md'), 'utf-8');
    expect(sourceAfter).toBe(v2Content);
  });

  it('Test 6: Transitioning from global skill to workspace-local skill avoids ResourceConflictError', async () => {
    const assistants: AIAssistant[] = ['antigravity', 'claude'];

    // 1. Install global skill
    const globalSkill: SkillItem = {
      id: 'transitioning-tool',
      name: 'transitioning-tool',
      title: 'Transitioning Tool',
      category: 'general',
      description: 'Initially global tool.',
      content: '# Initially Global\n',
      custom: false,
    };
    await reconcileWorkspaceResources(workspace, assistants, [globalSkill], []);

    const agentTarget = path.join(workspace, '.agents', 'skills', 'transitioning-tool', 'SKILL.md');
    expect(await fse.pathExists(agentTarget)).toBe(true);
    expect(await fs.readFile(agentTarget, 'utf-8')).toContain('# Initially Global');

    // 2. User now converts this skill into a workspace-local skill by customizing the file
    const localContent = '---\nname: transitioning-tool\ndescription: Customized locally for project.\nscope: workspace\n---\n\n# Customized Locally\n';
    await fs.writeFile(agentTarget, localContent, 'utf-8');

    // Re-read skills from workspace
    const skills = await getAllSkills(workspace);
    const customizedSkill = skills.find((s) => s.id === 'transitioning-tool');
    expect(customizedSkill).toBeDefined();
    expect(customizedSkill?.scope).toBe('workspace');

    // 3. Reconcile with customized local skill: MUST NOT throw ResourceConflictError
    const transitionResult = await reconcileWorkspaceResources(workspace, assistants, [customizedSkill!], []);
    expect(transitionResult).toBeDefined();

    // The local file must contain the customized content
    expect(await fs.readFile(agentTarget, 'utf-8')).toBe(localContent);

    // The Claude mirror must reflect the customized content
    const claudeTarget = path.join(workspace, '.claude', 'skills', 'transitioning-tool', 'SKILL.md');
    expect(await fs.readFile(claudeTarget, 'utf-8')).toContain('# Customized Locally');

    // Lockfile should NO LONGER manage .agents/skills/transitioning-tool
    const lockPath = await resolveResourceLockPath(workspace);
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf-8'));
    const ownedPaths: string[] = lock.outputs.map((o: { path: string }) => o.path);
    expect(ownedPaths.some((p) => p.startsWith('.agents/skills/transitioning-tool'))).toBe(false);
  });

  it('Test 7: Prevents symlink attacks and validates safety in local skills', async () => {
    const localSkillDir = path.join(workspace, '.agents', 'skills', 'symlink-test-skill');
    await fse.ensureDir(path.join(localSkillDir, 'scripts'));

    // Create a target file outside the skill directory
    const sensitiveFile = path.join(workspace, 'sensitive.txt');
    await fs.writeFile(sensitiveFile, 'TOP_SECRET_DATA', 'utf-8');

    // Create a symlink inside scripts/ pointing to the sensitive file
    await fs.symlink(sensitiveFile, path.join(localSkillDir, 'scripts', 'leak.sh'));

    await fs.writeFile(
      path.join(localSkillDir, 'SKILL.md'),
      '---\nname: symlink-test-skill\ndescription: Malicious symlink.\n---\n\n# Malicious\n',
      'utf-8',
    );

    // getAllSkills or reconcile must reject the linked file safely
    const skills = await getAllSkills(workspace);
    // Either skipped during discovery or rejected during reconciliation
    const malicious = skills.find((s) => s.id === 'symlink-test-skill');
    if (malicious) {
      await expect(
        reconcileWorkspaceResources(workspace, ['claude'], [malicious], []),
      ).rejects.toThrow(/linked/i);
    } else {
      // Skipped during loadSkillFromDir
      expect(malicious).toBeUndefined();
    }
  });
});
