/**
 * @module tests/e2e/m1-adversarial-challenger.test
 * Adversarial Challenger Suite for Milestone M1 (Skills Core & Catalog Cleanup).
 *
 * Stress tests:
 * 1. Rapid sequential and high-concurrency skill saves (same skill, distinct skills, workspace vs global).
 * 2. BOM variations (UTF-8 BOM, CRLF, leading whitespace, double BOM).
 * 3. Deeply nested frontmatter, complex YAML, large payloads, boundary values.
 * 4. Invalid formats, malformed YAML, missing fields, schema rejections, prototype pollution, path traversal.
 * 5. Full Shadowing Lifecycle: Global skill -> Workspace override -> Materializer reconciliation ->
 *    Local deletion -> Global resurfacing -> Re-materialization.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import fse from 'fs-extra';

import {
  getAllSkills,
  saveSkill,
  deleteSkill,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  getSkillCategories,
  DEFAULT_SKILLS,
  DEFAULT_CATEGORIES,
} from '../../src/utils/skills-catalog.js';

import {
  reconcileWorkspaceResources,
  isWorkspaceLocalSkill,
} from '../../src/resources/materializer.js';

import { resourceIdSchema, skillFrontmatterSchema } from '../../src/resources/contracts.js';

describe('M1 Adversarial Challenge & Stress Tests', () => {
  let tempHome: string;
  let tempWorkspace: string;
  const originalEnv = process.env.NEXUSFLOW_HOME;

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-challenger-home-'));
    tempWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-challenger-ws-'));
    process.env.NEXUSFLOW_HOME = tempHome;
  });

  afterEach(async () => {
    if (originalEnv !== undefined) {
      process.env.NEXUSFLOW_HOME = originalEnv;
    } else {
      delete process.env.NEXUSFLOW_HOME;
    }
    await fse.remove(tempHome).catch(() => {});
    await fse.remove(tempWorkspace).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 1: Rapid Sequential and Concurrent Skill Saves
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group 1: Concurrency & Stress Testing', () => {
    it('handles 25 concurrent saves of distinct workspace skills without file loss or corruption', async () => {
      const count = 25;
      const promises = Array.from({ length: count }, (_, i) => {
        const id = `stress-skill-${i}`;
        return saveSkill(
          {
            name: id,
            title: `Stress Skill ${i}`,
            description: `Description for stress skill ${i}`,
            content: `# Content for ${id}\n\nIteration ${i} body.`,
            tags: [`tag-${i}`, 'concurrent'],
          },
          { scope: 'workspace', workspacePath: tempWorkspace },
        );
      });

      const results = await Promise.all(promises);
      expect(results).toHaveLength(count);

      // Verify all 25 files exist on disk
      const wsSkillsDir = path.join(tempWorkspace, '.agents', 'skills');
      const entries = await fs.readdir(wsSkillsDir);
      expect(entries.filter((e) => e.startsWith('stress-skill-'))).toHaveLength(count);

      // Verify getAllSkills in workspace finds all 25
      const all = await getAllSkills(tempWorkspace);
      for (let i = 0; i < count; i++) {
        const found = all.find((s) => s.id === `stress-skill-${i}`);
        expect(found).toBeDefined();
        expect(found?.scope).toBe('workspace');
        expect(found?.description).toBe(`Description for stress skill ${i}`);
        expect(found?.content).toContain(`Iteration ${i} body.`);
      }

      // Verify none leaked into global home
      const globalSkills = await getAllSkills();
      expect(globalSkills.filter((s) => s.id.startsWith('stress-skill-'))).toHaveLength(0);
    });

    it('handles 15 concurrent saves targeting the SAME workspace skill ID safely without leaving corrupt or orphaned files', async () => {
      const id = 'hot-contested-skill';
      const concurrency = 15;

      const promises = Array.from({ length: concurrency }, (_, i) => {
        return saveSkill(
          {
            name: id,
            title: `Contested Skill Version ${i}`,
            description: `Contested description update ${i}`,
            content: `# Contested\n\nPayload from writer ${i}.`,
          },
          { scope: 'workspace', workspacePath: tempWorkspace },
        );
      });

      const results = await Promise.allSettled(promises);
      // All saves should succeed because mutations are serialized
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(concurrency);

      // Verify disk state: no orphaned .staging or .backup directories left behind
      const wsSkillsDir = path.join(tempWorkspace, '.agents', 'skills');
      const dirContents = await fs.readdir(wsSkillsDir);
      const stagingOrBackups = dirContents.filter((e) => e.includes('.staging-') || e.includes('.backup-'));
      expect(stagingOrBackups).toEqual([]);

      // Verify the final skill on disk is valid and parseable
      const finalSkillPath = path.join(wsSkillsDir, id, 'SKILL.md');
      expect(await fse.pathExists(finalSkillPath)).toBe(true);
      const raw = await fs.readFile(finalSkillPath, 'utf-8');
      const { metadata, content } = parseSkillMarkdown(raw);
      expect(metadata.name).toBe(id);
      expect(content).toContain('Payload from writer');

      const loaded = await getAllSkills(tempWorkspace);
      const skill = loaded.find((s) => s.id === id);
      expect(skill).toBeDefined();
      expect(skill?.scope).toBe('workspace');
    });

    it('handles rapid sequential updates (20 overwrites of the same skill) verifying state monotonicity', async () => {
      const id = 'sequential-update-target';
      for (let i = 0; i < 20; i++) {
        await saveSkill(
          {
            name: id,
            title: `Title V${i}`,
            description: `Description V${i}`,
            content: `# Version ${i}\n\nBody content at step ${i}.`,
            tags: [`v${i}`],
          },
          { scope: 'workspace', workspacePath: tempWorkspace },
        );
      }

      const all = await getAllSkills(tempWorkspace);
      const skill = all.find((s) => s.id === id);
      expect(skill).toBeDefined();
      expect(skill?.title).toBe('Title V19');
      expect(skill?.description).toBe('Description V19');
      expect(skill?.tags).toEqual(['v19']);
      expect(skill?.content).toContain('Body content at step 19.');

      // Check no leftover artifacts
      const wsSkillsDir = path.join(tempWorkspace, '.agents', 'skills');
      const items = await fs.readdir(wsSkillsDir);
      expect(items).toEqual([id]);
    });

    it('handles mixed concurrent saves: global vs workspace with intersecting and distinct IDs', async () => {
      const promises = [
        saveSkill(
          { name: 'shared-poly', description: 'Global Poly', content: '# Global Poly' },
          { scope: 'global' },
        ),
        saveSkill(
          { name: 'shared-poly', description: 'Local Poly', content: '# Local Poly' },
          { scope: 'workspace', workspacePath: tempWorkspace },
        ),
        saveSkill(
          { name: 'global-only', description: 'Global Only', content: '# Global Only' },
          { scope: 'global' },
        ),
        saveSkill(
          { name: 'local-only', description: 'Local Only', content: '# Local Only' },
          { scope: 'workspace', workspacePath: tempWorkspace },
        ),
      ];

      const results = await Promise.allSettled(promises);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const wsSkills = await getAllSkills(tempWorkspace);
      const globalSkills = await getAllSkills();

      // Workspace query should see Local Poly shadowing Global Poly, plus global-only and local-only
      const wsShared = wsSkills.find((s) => s.id === 'shared-poly');
      expect(wsShared?.scope).toBe('workspace');
      expect(wsShared?.description).toBe('Local Poly');

      expect(wsSkills.find((s) => s.id === 'global-only')?.scope).toBe('global');
      expect(wsSkills.find((s) => s.id === 'local-only')?.scope).toBe('workspace');

      // Global query should see Global Poly and global-only, but NEVER local-only
      const gShared = globalSkills.find((s) => s.id === 'shared-poly');
      expect(gShared?.scope).toBe('global');
      expect(gShared?.description).toBe('Global Poly');
      expect(globalSkills.some((s) => s.id === 'local-only')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 2: Deeply Nested Frontmatter, BOM Variations, Invalid Formats
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group 2: Frontmatter, BOM Variations & Input Adversity', () => {
    it('parses UTF-8 BOM (\uFEFF) at beginning of file with standard LF and CRLF', () => {
      const rawLF = '\uFEFF---\nname: bom-lf\ndescription: BOM test LF\n---\n\n# Header\n';
      const parsedLF = parseSkillMarkdown(rawLF);
      expect(parsedLF.metadata.name).toBe('bom-lf');
      expect(parsedLF.metadata.description).toBe('BOM test LF');
      expect(parsedLF.content).toContain('# Header');

      const rawCRLF = '\uFEFF---\r\nname: bom-crlf\r\ndescription: BOM test CRLF\r\n---\r\n\r\n# CRLF Header\r\n';
      const parsedCRLF = parseSkillMarkdown(rawCRLF);
      expect(parsedCRLF.metadata.name).toBe('bom-crlf');
      expect(parsedCRLF.metadata.description).toBe('BOM test CRLF');
      expect(parsedCRLF.content).toContain('# CRLF Header');
    });

    it('parses UTF-8 BOM with leading whitespace or newlines before delimiter', () => {
      const rawWithWs = '\uFEFF  \n\r\n---\nname: bom-whitespace\ndescription: Leading space test\n---\n\n# Body\n';
      const parsed = parseSkillMarkdown(rawWithWs);
      expect(parsed.metadata.name).toBe('bom-whitespace');
      expect(parsed.metadata.description).toBe('Leading space test');
      expect(parsed.content).toContain('# Body');
    });

    it('handles markdown containing inner horizontal rules (---) in body without corrupting body', () => {
      const rawWithRules = `---
name: rule-skill
description: Skill with hr in body
---

# Section 1

Some text here.

---

# Section 2

More text here.

---
Final footer.`;

      const parsed = parseSkillMarkdown(rawWithRules);
      expect(parsed.metadata.name).toBe('rule-skill');
      expect(parsed.metadata.description).toBe('Skill with hr in body');
      expect(parsed.content).toContain('# Section 1');
      expect(parsed.content).toContain('---');
      expect(parsed.content).toContain('# Section 2');
      expect(parsed.content).toContain('Final footer.');
    });

    it('handles 25 levels of deeply nested frontmatter metadata without stack overflow', async () => {
      let nested: Record<string, unknown> = { leafValue: 'deep-secret' };
      for (let i = 25; i >= 1; i--) {
        nested = { [`level_${i}`]: nested };
      }

      const saved = await saveSkill(
        {
          name: 'deeply-nested-skill',
          description: 'Deeply nested metadata',
          content: '# Deep Skill\n\nRuns with deep config.',
          metadata: nested,
        },
        { scope: 'workspace', workspacePath: tempWorkspace },
      );

      expect(saved.id).toBe('deeply-nested-skill');

      const loaded = (await getAllSkills(tempWorkspace)).find((s) => s.id === 'deeply-nested-skill');
      expect(loaded).toBeDefined();

      const skillPath = path.join(tempWorkspace, '.agents', 'skills', 'deeply-nested-skill', 'SKILL.md');
      const raw = await fs.readFile(skillPath, 'utf-8');
      const { metadata } = parseSkillMarkdown(raw);
      expect(metadata.name).toBe('deeply-nested-skill');

      // Verify nesting survived roundtrip
      let cursor = metadata.metadata as Record<string, unknown>;
      for (let i = 1; i <= 25; i++) {
        expect(cursor).toHaveProperty(`level_${i}`);
        cursor = cursor[`level_${i}`] as Record<string, unknown>;
      }
      expect(cursor.leafValue).toBe('deep-secret');
    });

    it('gracefully handles markdown with unclosed frontmatter (returns empty metadata)', () => {
      const unclosed = '---\nname: unclosed\ndescription: missing end delimiter\n# No closing dashes';
      const parsed = parseSkillMarkdown(unclosed);
      expect(parsed.metadata).toEqual({});
      expect(parsed.content).toBe(unclosed);
    });

    it('gracefully handles markdown with invalid YAML indentation or tab characters', () => {
      const invalidYaml = '---\nname: broken-yaml\n\tdescription: tab not allowed\n  nested:\n [unclosed array\n---\n\n# Body';
      const parsed = parseSkillMarkdown(invalidYaml);
      expect(parsed.metadata).toEqual({});
      expect(parsed.content).toContain('# Body');
    });

    it('rejects saving skills with invalid IDs or path traversal attempts', async () => {
      const invalidIds = [
        'UPPERCASE',
        'spaces in name',
        'special!@#',
        '../traversal',
        'a/b',
        '-leading-hyphen',
        'trailing-hyphen-',
        'double--hyphen',
        '',
      ];

      for (const badId of invalidIds) {
        await expect(
          saveSkill(
            {
              name: badId,
              description: 'Valid description',
              content: '# Content',
            },
            { scope: 'workspace', workspacePath: tempWorkspace },
          ),
        ).rejects.toThrow();
      }
    });

    it('rejects saving skills with missing or empty description or content', async () => {
      await expect(
        saveSkill(
          { name: 'no-desc', description: '', content: '# Valid Content' },
          { scope: 'workspace', workspacePath: tempWorkspace },
        ),
      ).rejects.toThrow(/description is required/i);

      await expect(
        saveSkill(
          { name: 'no-content', description: 'Valid Description', content: '   \n  \t  ' },
          { scope: 'workspace', workspacePath: tempWorkspace },
        ),
      ).rejects.toThrow(/content is required/i);
    });

    it('protects against prototype pollution in frontmatter', async () => {
      const maliciousYaml = `---
name: proto-test
description: Proto pollution attempt
__proto__:
  polluted: true
constructor:
  prototype:
    admin: true
---

# Proto Test Content`;

      const parsed = parseSkillMarkdown(maliciousYaml);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).admin).toBeUndefined();
    });

    it('skips invalid/corrupted skills in workspace directory during getAllSkills without throwing', async () => {
      const wsSkillsDir = path.join(tempWorkspace, '.agents', 'skills');
      await fse.ensureDir(wsSkillsDir);

      // 1. Directory with name mismatch
      const mismatchDir = path.join(wsSkillsDir, 'folder-name');
      await fse.ensureDir(mismatchDir);
      await fs.writeFile(
        path.join(mismatchDir, 'SKILL.md'),
        '---\nname: different-name\ndescription: Mismatch\n---\n# Mismatch',
        'utf-8',
      );

      // 2. Directory with corrupt non-YAML frontmatter
      const corruptDir = path.join(wsSkillsDir, 'corrupt-yaml');
      await fse.ensureDir(corruptDir);
      await fs.writeFile(
        path.join(corruptDir, 'SKILL.md'),
        '---\n{\ninvalid json/yaml\n---\n# Broken',
        'utf-8',
      );

      // 3. Directory with missing SKILL.md
      const emptyDir = path.join(wsSkillsDir, 'empty-dir');
      await fse.ensureDir(emptyDir);

      // 4. A normal file placed directly in .agents/skills/
      await fs.writeFile(path.join(wsSkillsDir, 'README.txt'), 'Not a skill directory');

      // 5. One valid skill
      await saveSkill(
        { name: 'valid-survivor', description: 'Survivor', content: '# Survivor' },
        { scope: 'workspace', workspacePath: tempWorkspace },
      );

      // getAllSkills must not crash, and must return the valid skill
      const skills = await getAllSkills(tempWorkspace);
      expect(skills.some((s) => s.id === 'valid-survivor')).toBe(true);
      expect(skills.some((s) => s.id === 'folder-name')).toBe(false);
      expect(skills.some((s) => s.id === 'corrupt-yaml')).toBe(false);
      expect(skills.some((s) => s.id === 'empty-dir')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUP 3: Skill Shadowing, Materialization, and Deletion Lifecycle
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Group 3: Full Shadowing & Materialization Lifecycle', () => {
    it('executes full lifecycle: global creation -> materialization -> local shadow -> re-reconcile -> local deletion -> global resurfacing -> re-materialization', async () => {
      const skillId = 'enterprise-linter';

      // Step 1: Create global skill
      await saveSkill(
        {
          name: skillId,
          title: 'Global Enterprise Linter',
          description: 'Global standard linting instructions',
          content: '# Global Linter\n\nRun global eslint check.',
          tags: ['lint', 'company-standard'],
        },
        { scope: 'global' },
      );

      // Verify global skill presence
      const initialGlobal = await getAllSkills();
      expect(initialGlobal.some((s) => s.id === skillId)).toBe(true);

      const initialWsQuery = await getAllSkills(tempWorkspace);
      const wsSeenGlobal = initialWsQuery.find((s) => s.id === skillId);
      expect(wsSeenGlobal).toBeDefined();
      expect(wsSeenGlobal?.scope).toBe('global');
      expect(wsSeenGlobal?.content).toContain('Run global eslint check.');

      // Step 2: Materialize into workspace for Claude and Cursor assistants
      const initialReconcile = await reconcileWorkspaceResources(
        tempWorkspace,
        ['claude', 'cursor'],
        [wsSeenGlobal!],
        [],
      );
      expect(initialReconcile.installed.length).toBeGreaterThan(0);

      // Check materialized locations
      const agentTarget = path.join(tempWorkspace, '.agents', 'skills', skillId, 'SKILL.md');
      const claudeTarget = path.join(tempWorkspace, '.claude', 'skills', skillId, 'SKILL.md');
      const cursorTarget = path.join(tempWorkspace, '.cursor', 'skills', skillId, 'SKILL.md');

      expect(await fse.pathExists(agentTarget)).toBe(true);
      expect(await fse.pathExists(claudeTarget)).toBe(true);
      expect(await fse.pathExists(cursorTarget)).toBe(true);
      expect(await fs.readFile(agentTarget, 'utf-8')).toContain('Run global eslint check.');

      // Check resources.lock.json has ownership of .agents/skills/enterprise-linter
      const lockPath = path.join(tempWorkspace, '.contextspace', 'resources.lock.json');
      const lockData1 = await fse.readJson(lockPath);
      expect(lockData1.outputs.some((o: { path: string }) => o.path === `.agents/skills/${skillId}/SKILL.md`)).toBe(true);

      // Step 3: Author a LOCAL workspace override (shadowing the global skill)
      const savedLocal = await saveSkill(
        {
          name: skillId,
          title: 'Workspace Project Linter Override',
          description: 'Project-specific lint override',
          content: '# Workspace Linter Override\n\nRun custom project biome check.',
          tags: ['lint', 'custom-biome'],
        },
        { scope: 'workspace', workspacePath: tempWorkspace },
      );

      expect(savedLocal.scope).toBe('workspace');
      expect(savedLocal.content).toContain('Run custom project biome check.');

      // Step 4: Verify getAllSkills(tempWorkspace) returns the local override, while getAllSkills() returns global
      const skillsAfterShadow = await getAllSkills(tempWorkspace);
      const activeSkill = skillsAfterShadow.find((s) => s.id === skillId);
      expect(activeSkill).toBeDefined();
      expect(activeSkill?.scope).toBe('workspace');
      expect(activeSkill?.content).toContain('Run custom project biome check.');

      const globalAfterShadow = await getAllSkills();
      const globalStillIntact = globalAfterShadow.find((s) => s.id === skillId);
      expect(globalStillIntact?.scope).toBe('global');
      expect(globalStillIntact?.content).toContain('Run global eslint check.');

      // Step 5: Re-reconcile with the workspace-local skill
      // Materializer should NOT collide with .agents/skills/<id>, must NOT delete it,
      // and should update .claude and .cursor with local content.
      expect(isWorkspaceLocalSkill(activeSkill!, tempWorkspace)).toBe(true);

      const secondReconcile = await reconcileWorkspaceResources(
        tempWorkspace,
        ['claude', 'cursor'],
        [activeSkill!],
        [],
      );

      // Local source must remain untouched and containing custom content
      expect(await fs.readFile(agentTarget, 'utf-8')).toContain('Run custom project biome check.');
      // Claude & Cursor must receive the updated workspace content
      expect(await fs.readFile(claudeTarget, 'utf-8')).toContain('Run custom project biome check.');
      expect(await fs.readFile(cursorTarget, 'utf-8')).toContain('Run custom project biome check.');

      // Check resources.lock.json does NOT manage .agents/skills/enterprise-linter anymore
      const lockData2 = await fse.readJson(lockPath);
      expect(lockData2.outputs.some((o: { path: string }) => o.path.startsWith(`.agents/skills/${skillId}`))).toBe(false);

      // Step 6: Delete the local workspace skill
      await deleteSkill(skillId, { scope: 'workspace', workspacePath: tempWorkspace });
      expect(await fse.pathExists(path.join(tempWorkspace, '.agents', 'skills', skillId))).toBe(false);

      // Step 7: Verify global skill resurfaces cleanly in workspace query
      const skillsAfterLocalDelete = await getAllSkills(tempWorkspace);
      const resurfaced = skillsAfterLocalDelete.find((s) => s.id === skillId);
      expect(resurfaced).toBeDefined();
      expect(resurfaced?.scope).toBe('global');
      expect(resurfaced?.content).toContain('Run global eslint check.');

      // Step 8: Re-materialize with resurfaced global skill
      const thirdReconcile = await reconcileWorkspaceResources(
        tempWorkspace,
        ['claude', 'cursor'],
        [resurfaced!],
        [],
      );
      expect(thirdReconcile).toBeDefined();

      // .agents/skills/enterprise-linter should now be regenerated with global content
      expect(await fse.pathExists(agentTarget)).toBe(true);
      expect(await fs.readFile(agentTarget, 'utf-8')).toContain('Run global eslint check.');
      expect(await fs.readFile(claudeTarget, 'utf-8')).toContain('Run global eslint check.');

      // Lock should manage it again
      const lockData3 = await fse.readJson(lockPath);
      expect(lockData3.outputs.some((o: { path: string }) => o.path === `.agents/skills/${skillId}/SKILL.md`)).toBe(true);

      // Step 9: Delete global skill cleanly
      await deleteSkill(skillId, { scope: 'global' });
      expect((await getAllSkills()).some((s) => s.id === skillId)).toBe(false);
      expect((await getAllSkills(tempWorkspace)).some((s) => s.id === skillId)).toBe(false);
    });

    it('rejects deleteSkill when scope is workspace but workspacePath is omitted', async () => {
      await expect(
        deleteSkill('some-skill', { scope: 'workspace' }),
      ).rejects.toThrow(/workspacePath is required/i);
    });

    it('throws "Skill not found." when deleting a non-existent workspace skill', async () => {
      await expect(
        deleteSkill('non-existent-skill', { scope: 'workspace', workspacePath: tempWorkspace }),
      ).rejects.toThrow(/skill not found/i);
    });
  });
});
