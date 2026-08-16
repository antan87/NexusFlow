import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    it('should return default template categories when no custom categories exist', async () => {
      const categories = await getSkillCategories();
      expect(categories.length).toBe(DEFAULT_CATEGORIES.length);
      const prCat = categories.find((c) => c.id === 'pull-requests');
      expect(prCat).toBeDefined();
      expect(prCat?.name).toBe('Pull Requests & Review');
      expect(prCat?.isTemplate).toBe(true);
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

    it('should allow customizing a template category and deleting the override to reset to defaults', async () => {
      // 1. Customize a template category
      const overridden = await saveSkillCategory({
        id: 'pull-requests',
        name: 'Customized PR Workflow',
        description: 'Company-specific PR flow',
      });
      expect(overridden.name).toBe('Customized PR Workflow');

      let current = await getSkillCategories();
      expect(current.find((c) => c.id === 'pull-requests')?.name).toBe('Customized PR Workflow');

      // 2. Delete override (resets back to default built-in template)
      await deleteSkillCategory('pull-requests');
      current = await getSkillCategories();
      expect(current.find((c) => c.id === 'pull-requests')?.name).toBe('Pull Requests & Review');
    });

    it('should reject deleting un-customized built-in template categories', async () => {
      await expect(deleteSkillCategory('database-migrations')).rejects.toThrow(
        /Cannot delete built-in/i,
      );
    });
  });

  describe('Skills Management', () => {
    it('should list all default built-in template skills', async () => {
      const skills = await getAllSkills();
      expect(skills.length).toBe(DEFAULT_SKILLS.length);
      const prSkill = skills.find((s) => s.id === 'pr-review-toolkit');
      expect(prSkill).toBeDefined();
      expect(prSkill?.category).toBe('pull-requests');
      expect(prSkill?.allowedTools).toContain('run_command');
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
  });

  describe('Workspace Skills Config', () => {
    it('should load default workspace configuration when file does not exist', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        const config = await getWorkspaceSkillsConfig(tempDir);
        expect(config.enabledSkills.length).toBeGreaterThan(0);
        expect(config.enabledSkills).toContain('pr-review-toolkit');
      } finally {
        await fse.remove(tempDir);
      }
    });

    it('should save and load workspace skill assignments', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-ws-skills-test-'));
      try {
        await saveWorkspaceSkillsConfig(tempDir, {
          enabledSkills: ['pr-review-toolkit', 'verifier-workspace'],
          enabledCategories: ['pull-requests', 'testing-qa'],
        });

        const loaded = await getWorkspaceSkillsConfig(tempDir);
        expect(loaded.enabledSkills).toEqual(['pr-review-toolkit', 'verifier-workspace']);
        expect(loaded.enabledCategories).toEqual(['pull-requests', 'testing-qa']);
      } finally {
        await fse.remove(tempDir);
      }
    });
  });
});
