import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import fse from 'fs-extra';

import {
  parseSkillMarkdown,
  serializeSkillMarkdown,
  getSkillCategories,
  saveSkillCategory,
  deleteSkillCategory,
  getAllSkills,
  saveSkill,
  deleteSkill,
  getWorkspaceSkillsConfig,
  saveWorkspaceSkillsConfig,
  DEFAULT_CATEGORIES,
  DEFAULT_SKILLS,
} from './skills-catalog.js';

describe('Skills Catalog & Frontmatter Utils', () => {
  let tempHome: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-skills-test-home-'));
    process.env.NEXUSFLOW_HOME = tempHome;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.NEXUSFLOW_HOME = originalEnv;
    } else {
      delete process.env.NEXUSFLOW_HOME;
    }
    await fse.remove(tempHome);
  });



  describe('parseSkillMarkdown & serializeSkillMarkdown', () => {
    it('should parse simple frontmatter, CRLF line endings, and markdown body', () => {
      const raw = `---\r\nname: test-skill\r\ntitle: Test Skill\r\ncategory: pull-requests\r\ndescription: "A test skill for testing."\r\ntags:\r\n  - git\r\n  - test\r\nallowed-tools:\r\n  - run_command\r\n  - view_file\r\n---\r\n\r\n# Test Playbook\r\n\r\nSome instructions here.`;

      const { metadata, content } = parseSkillMarkdown(raw);
      expect(metadata.name).toBe('test-skill');
      expect(metadata.title).toBe('Test Skill');
      expect(metadata.category).toBe('pull-requests');
      expect(metadata.description).toBe('A test skill for testing.');
      expect(metadata.tags).toEqual(['git', 'test']);
      expect(metadata['allowed-tools']).toEqual(['run_command', 'view_file']);
      expect(content).toContain('# Test Playbook');
      expect(content).toContain('Some instructions here.');
    });

    it('should serialize metadata with objects/parameters and markdown body into valid frontmatter markdown', () => {
      const metadata = {
        name: 'custom-skill',
        title: 'Custom Skill',
        category: 'custom-category',
        description: 'Testing multiline\ndescription with "quotes"',
        tags: ['alpha', 'beta'],
        parameters: [
          { name: 'target_env', type: 'string', default: 'staging' },
        ],
      };
      const content = '# Custom Playbook\n\nSteps to follow.';

      const output = serializeSkillMarkdown(metadata, content);
      expect(output).toContain('name: custom-skill');
      expect(output).toContain('title: Custom Skill');
      expect(output).toContain('category: custom-category');
      expect(output).toContain('# Custom Playbook');

      // Roundtrip verification
      const parsed = parseSkillMarkdown(output);
      expect(parsed.metadata.name).toBe('custom-skill');
      expect(parsed.metadata.title).toBe('Custom Skill');
      expect(parsed.metadata.category).toBe('custom-category');
      expect(parsed.metadata.tags).toEqual(['alpha', 'beta']);
      expect(parsed.metadata.parameters).toEqual([
        { name: 'target_env', type: 'string', default: 'staging' },
      ]);
      expect(parsed.content).toContain('# Custom Playbook');
    });
  });

  describe('Categories Management', () => {
    it('should start with an empty category list when no custom categories exist', async () => {
      const categories = await getSkillCategories();
      expect(categories).toEqual([]);
      expect(categories.length).toBe(0);
      expect(DEFAULT_CATEGORIES.length).toBe(0);
    });

    it('should create, save, and delete a new user custom category', async () => {
      const newCat = await saveSkillCategory({
        name: 'DevOps & Cloud',
        description: 'Kubernetes, Terraform, and Docker workflows',
        icon: 'zap',
        color: '#10b981',
      });

      expect(newCat.id).toBe('devops-cloud');
      expect(newCat.name).toBe('DevOps & Cloud');
      expect(newCat.custom).toBe(true);

      const all = await getSkillCategories();
      const found = all.find((c) => c.id === 'devops-cloud');
      expect(found).toBeDefined();
      expect(found?.description).toBe('Kubernetes, Terraform, and Docker workflows');

      // Clean up
      await deleteSkillCategory('devops-cloud');
      const afterDelete = await getSkillCategories();
      expect(afterDelete.find((c) => c.id === 'devops-cloud')).toBeUndefined();
    });

    it('should create a custom category and delete it completely', async () => {
      const created = await saveSkillCategory({
        id: 'team-workflows',
        name: 'Team Workflows',
        description: 'Company-specific team workflows',
      });
      expect(created.name).toBe('Team Workflows');

      let current = await getSkillCategories();
      expect(current.find((c) => c.id === 'team-workflows')?.name).toBe('Team Workflows');

      await deleteSkillCategory('team-workflows');
      current = await getSkillCategories();
      expect(current.find((c) => c.id === 'team-workflows')).toBeUndefined();
    });

    it('should reject deleting non-existent categories', async () => {
      await expect(deleteSkillCategory('non-existent-category')).rejects.toThrow(
        /Category not found/i,
      );
    });
  });

  describe('Skills Management', () => {
    it('should start with an empty skill catalog when no custom skills are saved', async () => {
      const skills = await getAllSkills();
      expect(skills).toEqual([]);
      expect(skills.length).toBe(0);
      expect(DEFAULT_SKILLS.length).toBe(0);
    });

    it('should save and delete a custom skill package with references and scripts', async () => {
      const customSkill = await saveSkill({
        name: 'unit-test-generator',
        title: 'Unit Test Generator',
        category: 'testing-qa',
        description: 'Auto-generates unit tests with mocks',
        tags: ['test', 'generator'],
        content: '# Unit Test Generator\n\nGenerate tests with Vitest.',
        references: [{ name: 'checklist.md', relativePath: 'references/checklist.md', content: '# Checklist' }],
        scripts: [{ name: 'gen.sh', relativePath: 'scripts/gen.sh', content: '#!/bin/bash\necho "generating"' }],
      });

      expect(customSkill.id).toBe('unit-test-generator');
      expect(customSkill.custom).toBe(true);

      const all = await getAllSkills();
      const found = all.find((s) => s.id === 'unit-test-generator');
      expect(found).toBeDefined();
      expect(found?.title).toBe('Unit Test Generator');
      expect(found?.references?.length).toBe(1);
      expect(found?.scripts?.length).toBe(1);

      // Clean up
      await deleteSkill('unit-test-generator');
      const afterDelete = await getAllSkills();
      expect(afterDelete.find((s) => s.id === 'unit-test-generator')).toBeUndefined();
    });

    it('should reject path traversal in skill ID and references', async () => {
      await expect(
        saveSkill({
          name: '../../evil-skill',
          content: 'evil',
        }),
      ).rejects.toThrow();

      await expect(deleteSkill('../../evil-skill')).rejects.toThrow();
    });

    it('saves and deletes a custom skill with standard identity', async () => {
      const saved = await saveSkill({
        name: 'pr-review-toolkit',
        description: 'Custom review toolkit.',
        content: '# Review Toolkit',
      });
      expect(saved.id).toBe('pr-review-toolkit');
      expect(saved.custom).toBe(true);
      expect(await fse.pathExists(path.join(tempHome, 'skills', 'pr-review-toolkit'))).toBe(true);

      await deleteSkill('pr-review-toolkit');
      expect(await fse.pathExists(path.join(tempHome, 'skills', 'pr-review-toolkit'))).toBe(false);
    });

    it('rejects mismatched skill identities', async () => {
      await expect(saveSkill({
        id: 'stable-id',
        name: 'different-name',
        description: 'Mismatched identity.',
        content: '# Mismatch',
      })).rejects.toThrow(/id and name must match/i);
      expect(await fse.pathExists(path.join(tempHome, 'skills', 'stable-id'))).toBe(false);
    });

    it('rejects persisted metadata identities that do not match their directory', async () => {
      const skillDir = path.join(tempHome, 'skills', 'safe-directory');
      await fse.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: ../../outside\ndescription: malicious\n---\n\nDo something.\n',
        'utf-8',
      );

      const skills = await getAllSkills();
      expect(skills.some((skill) => skill.sourcePath === skillDir)).toBe(false);
      expect(await fse.pathExists(path.join(tempHome, 'outside'))).toBe(false);
    });

    it('preserves support folders on metadata edits and removes them only when explicitly cleared', async () => {
      await saveSkill({
        name: 'snapshot-skill',
        description: 'Initial snapshot.',
        content: '# Initial',
        scripts: [{ name: 'old.sh', relativePath: 'scripts/old.sh', content: 'echo old' }],
      });
      await saveSkill({
        name: 'snapshot-skill',
        description: 'Updated snapshot.',
        content: '# Updated',
      });

      expect(await fs.readFile(path.join(tempHome, 'skills', 'snapshot-skill', 'scripts', 'old.sh'), 'utf-8')).toBe('echo old');

      await saveSkill({
        name: 'snapshot-skill',
        description: 'Updated snapshot.',
        content: '# Updated',
        scripts: [],
      });

      expect(await fse.pathExists(path.join(tempHome, 'skills', 'snapshot-skill', 'scripts', 'old.sh'))).toBe(false);
    });

    it('preserves portable frontmatter owned by other tools during edits', async () => {
      const skillDir = path.join(tempHome, 'skills', 'portable-metadata');
      await fse.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: portable-metadata\ndescription: Original trigger.\nlicense: Apache-2.0\ncompatibility: Requires git.\nmetadata:\n  owner: platform-team\n  nexusflow:\n    custom-field: keep\n---\n\n# Original\n',
        'utf-8',
      );
      const existing = (await getAllSkills()).find((item) => item.id === 'portable-metadata');
      expect(existing).toBeDefined();

      await saveSkill({
        id: existing!.id,
        name: existing!.name,
        title: 'Updated title',
        category: 'general',
        description: 'Updated trigger.',
        content: '# Updated',
      });

      const written = parseSkillMarkdown(await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf-8'));
      expect(written.metadata).toMatchObject({
        license: 'Apache-2.0',
        compatibility: 'Requires git.',
        metadata: {
          owner: 'platform-team',
          nexusflow: { 'custom-field': 'keep', title: 'Updated title' },
        },
      });
    });
  });

  describe('Workspace Skills Config', () => {
    it('should load an empty workspace configuration when file does not exist', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        const config = await getWorkspaceSkillsConfig(tempDir);
        expect(config.enabledSkills).toEqual([]);
        expect(config.enabledAgents).toEqual([]);
        expect(config.revision).toBe(0);
      } finally {
        await fse.remove(tempDir);
      }
    });

    it('should save and load workspace skill assignments', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        await saveWorkspaceSkillsConfig(tempDir, {
          enabledSkills: ['pr-review-toolkit', 'verifier-workspace'],
          enabledAgents: ['docs_researcher'],
          enabledCategories: ['pull-requests', 'testing-qa'],
        });

        const loaded = await getWorkspaceSkillsConfig(tempDir);
        expect(loaded.enabledSkills).toEqual(['pr-review-toolkit', 'verifier-workspace']);
        expect(loaded.enabledAgents).toEqual(['docs_researcher']);
        expect(loaded.enabledCategories).toEqual(['pull-requests', 'testing-qa']);
        expect(loaded.revision).toBe(1);
      } finally {
        await fse.remove(tempDir);
      }
    });

    it('rejects stale assignment revisions', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        await saveWorkspaceSkillsConfig(tempDir, { enabledSkills: ['pr-review-toolkit'] }, 0);
        await expect(
          saveWorkspaceSkillsConfig(tempDir, { enabledSkills: ['verifier-workspace'] }, 0),
        ).rejects.toThrow(/expected revision 0, current 1/i);
      } finally {
        await fse.remove(tempDir);
      }
    });

    it('serializes concurrent writes so only one request can claim a revision', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        const results = await Promise.allSettled([
          saveWorkspaceSkillsConfig(tempDir, { enabledSkills: ['pr-review-toolkit'] }, 0),
          saveWorkspaceSkillsConfig(tempDir, { enabledSkills: ['verifier-workspace'] }, 0),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
        expect((await getWorkspaceSkillsConfig(tempDir)).revision).toBe(1);
      } finally {
        await fse.remove(tempDir);
      }
    });
  });

  describe('Project-Specific (Workspace-Scoped) Skills', () => {
    it('saves a workspace-scoped skill into .agents/skills/ and does not expose it globally', async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-local-'));
      try {
        const saved = await saveSkill(
          {
            name: 'workspace-local-helper',
            title: 'Local Helper',
            category: 'testing',
            description: 'Only for this project',
            content: '# Local Helper\n\nRun workspace command.',
          },
          { scope: 'workspace', workspacePath: ws },
        );

        expect(saved.id).toBe('workspace-local-helper');
        expect(saved.custom).toBe(true);
        expect(saved.scope).toBe('workspace');
        expect(saved.path).toBe(path.join(ws, '.agents', 'skills', 'workspace-local-helper', 'SKILL.md'));
        expect(saved.skill.id).toBe('workspace-local-helper');

        // Verify file written to <ws>/.agents/skills/workspace-local-helper/SKILL.md
        const localSkillPath = path.join(ws, '.agents', 'skills', 'workspace-local-helper', 'SKILL.md');
        expect(await fse.pathExists(localSkillPath)).toBe(true);

        // Verify NOT present in global user home
        expect(await fse.pathExists(path.join(tempHome, 'skills', 'workspace-local-helper'))).toBe(false);

        // Global catalog is still empty
        const globalSkills = await getAllSkills();
        expect(globalSkills.some((s) => s.id === 'workspace-local-helper')).toBe(false);

        // Workspace-scoped query discovers it
        const wsSkills = await getAllSkills(ws);
        expect(wsSkills.some((s) => s.id === 'workspace-local-helper')).toBe(true);
        const wsFound = wsSkills.find((s) => s.id === 'workspace-local-helper');
        expect(wsFound?.scope).toBe('workspace');
      } finally {
        await fse.remove(ws);
      }
    });

    it('saves a global skill into user dir and exposes it across workspaces', async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-global-'));
      try {
        await saveSkill(
          {
            name: 'company-standard-skill',
            title: 'Company Standard',
            category: 'quality',
            description: 'Available in all workspaces',
            content: '# Company Standard\n\nGlobal instructions.',
          },
          { scope: 'global' },
        );

        // Present in global user dir
        expect(await fse.pathExists(path.join(tempHome, 'skills', 'company-standard-skill', 'SKILL.md'))).toBe(true);

        // Present in global query
        expect((await getAllSkills()).some((s) => s.id === 'company-standard-skill')).toBe(true);

        // Present in workspace query
        expect((await getAllSkills(ws)).some((s) => s.id === 'company-standard-skill')).toBe(true);
      } finally {
        await fse.remove(ws);
        await deleteSkill('company-standard-skill').catch(() => {});
      }
    });

    it('allows a workspace skill to shadow a global skill and deletes properly by scope', async () => {
      const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-shadow-'));
      try {
        await saveSkill(
          {
            name: 'shared-name-skill',
            description: 'Global definition',
            content: '# Global',
          },
          { scope: 'global' },
        );

        await saveSkill(
          {
            name: 'shared-name-skill',
            description: 'Workspace-specific override',
            content: '# Local Override',
          },
          { scope: 'workspace', workspacePath: ws },
        );

        const wsSkills = await getAllSkills(ws);
        const active = wsSkills.find((s) => s.id === 'shared-name-skill');
        expect(active?.content).toContain('# Local Override');
        expect(active?.scope).toBe('workspace');

        // Delete workspace skill
        await deleteSkill('shared-name-skill', { scope: 'workspace', workspacePath: ws });
        expect(await fse.pathExists(path.join(ws, '.agents', 'skills', 'shared-name-skill'))).toBe(false);

        // Global skill remains intact
        const afterLocalDelete = await getAllSkills(ws);
        const globalRemaining = afterLocalDelete.find((s) => s.id === 'shared-name-skill');
        expect(globalRemaining?.content).toContain('# Global');
        expect(globalRemaining?.scope).toBe('global');
      } finally {
        await fse.remove(ws);
        await deleteSkill('shared-name-skill').catch(() => {});
      }
    });

    it('rejects saving a workspace skill without workspacePath', async () => {
      await expect(
        saveSkill(
          {
            name: 'missing-path-skill',
            description: 'No ws path',
            content: '# Test',
          },
          { scope: 'workspace' },
        ),
      ).rejects.toThrow(/workspacePath is required/i);
    });

    it('rejects deleting a workspace skill without workspacePath', async () => {
      await expect(
        deleteSkill('any-skill', { scope: 'workspace' }),
      ).rejects.toThrow(/workspacePath is required/i);
    });
  });
});
