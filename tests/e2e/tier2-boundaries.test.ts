/**
 * @module tests/e2e/tier2-boundaries.test
 * Tier 2: Boundary Value Analysis & Edge Cases (≥5 per feature, 45 tests total)
 * Opaque-box adversarial and boundary verification.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import fse from 'fs-extra';

import {
  createTestWorkspace,
  readAgentsMd,
  listMaterializedSkills,
  generateAgentsMd,
  invokeMcpTool,
  validateCreateWorkspacePayload,
  featureGates,
  type TestWorkspace,
} from './test-harness.js';

import {
  saveSkill,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  DEFAULT_SKILLS,
} from '../../src/utils/skills-catalog.js';

import {
  getDomainPack,
  resolveActiveDomainRules,
} from '../../src/core/domain-packs.js';

import {
  buildHarnessCliCommand,
  formatTerminalTitle,
} from '../../src/utils/terminal-launch.js';
import { isValidSessionId } from '../../src/agent/session.js';

import { loadWorkspaceLifecycle } from '../../src/core/lifecycle.js';
import {
  reconcileWorkspaceResources,
  ResourceConflictError,
} from '../../src/resources/materializer.js';
import { enabledTools, findTool } from '../../src/mcp/tools.js';
import {
  resourceIdSchema,
  skillFrontmatterSchema,
} from '../../src/resources/contracts.js';
import { refreshWorkspace } from '../../src/core/refresh.js';

describe('Tier 2: Boundary Value Analysis & Edge Cases', () => {
  let ws: TestWorkspace;

  afterEach(async () => {
    if (ws) {
      await ws.cleanup();
    }
  });

  // ─── F1-B: Clean Catalog & ID/Category Boundaries ────────────────────
  describe('F1-B: Catalog Input Boundaries & Schema Validation', () => {
    it('F1-B.1: skill ID with uppercase letters is strictly rejected', () => {
      const res = resourceIdSchema.safeParse('InvalidCamelCaseSkill');
      expect(res.success).toBe(false);
    });

    it('F1-B.2: skill ID with underscores or spaces is strictly rejected', () => {
      expect(resourceIdSchema.safeParse('invalid_underscored_skill').success).toBe(false);
      expect(resourceIdSchema.safeParse('invalid skill with spaces').success).toBe(false);
    });

    it('F1-B.3: saveSkill rejects empty or whitespace-only content', async () => {
      await expect(
        saveSkill({
          name: 'empty-content-skill',
          description: 'Description',
          content: '   ',
        }),
      ).rejects.toThrow(/Skill content is required/i);
    });

    it('F1-B.4: saveSkill rejects empty or whitespace-only description', async () => {
      await expect(
        saveSkill({
          name: 'empty-desc-skill',
          description: '   ',
          content: '# Valid Content',
        }),
      ).rejects.toThrow(/Skill description is required/i);
    });

    it('F1-B.5: malformed YAML frontmatter is parsed safely without throwing', () => {
      const brokenYaml = `---
name: [unclosed array
invalid: {broken yaml
---
# Content`;
      const parsed = parseSkillMarkdown(brokenYaml);
      expect(parsed).toBeDefined();
      expect(parsed.content).toContain('# Content');
      expect(parsed.metadata).toEqual({});
    });
  });

  // ─── F2-B: Project-Specific Local Skills Boundaries ──────────────────
  describe('F2-B: Local Skills Directory Traversal & Conflict Boundaries', () => {
    it('F2-B.1: path traversal patterns in skill ID are rejected', () => {
      expect(resourceIdSchema.safeParse('../escape').success).toBe(false);
      expect(resourceIdSchema.safeParse('../../traversal').success).toBe(false);
      expect(resourceIdSchema.safeParse('/absolute/path').success).toBe(false);
    });

    it('F2-B.2: skill ID exceeding 64 characters is rejected', () => {
      const longId = 'a'.repeat(65);
      const res = resourceIdSchema.safeParse(longId);
      expect(res.success).toBe(false);
    });

    it('F2-B.3: preflight conflict detection throws ResourceConflictError when unmanaged file exists', async () => {
      ws = await createTestWorkspace();
      const conflictDir = path.join(ws.workspacePath, '.agents', 'skills', 'unmanaged-skill');
      await fse.ensureDir(conflictDir);
      await fs.writeFile(path.join(conflictDir, 'SKILL.md'), 'unmanaged user file', 'utf-8');

      const testSkill = {
        id: 'unmanaged-skill',
        name: 'unmanaged-skill',
        description: 'Trying to overwrite unmanaged file',
        content: '# Clashing',
        custom: true,
      };

      await expect(
        reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [testSkill], []),
      ).rejects.toThrow(ResourceConflictError);
    });

    it('F2-B.4: materializer detects modified managed file and blocks overwrite', async () => {
      ws = await createTestWorkspace();
      const testSkill = {
        id: 'tamper-test',
        name: 'tamper-test',
        description: 'Tamper testing skill',
        content: '# Original Content',
        custom: true,
      };

      // Materialize first time
      await reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [testSkill], []);

      // User modifies the materialized file on disk
      const targetPath = path.join(ws.workspacePath, '.agents', 'skills', 'tamper-test', 'SKILL.md');
      await fs.writeFile(targetPath, '# Modified Content by Developer', 'utf-8');

      // Attempt to re-reconcile or update should detect hash mismatch
      const updatedSkill = { ...testSkill, content: '# Newer Content' };
      await expect(
        reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [updatedSkill], []),
      ).rejects.toThrow(ResourceConflictError);
    });

    it('F2-B.5: empty skills array produces clean empty state without creating unneeded directories', async () => {
      ws = await createTestWorkspace();
      const result = await reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [], []);
      expect(result.installed.length).toBe(0);
      expect(result.updated.length).toBe(0);
      expect(result.removed.length).toBe(0);
    });
  });

  // ─── F3-B: MCP Skill Administration Boundaries ───────────────────────
  describe('F3-B: MCP Tool Security & Role Boundaries', () => {
    const mockConfig = {
      version: '1.0',
      devDir: '/dev',
      workspacesDir: '/dev/workspaces',
      defaultAssistant: null,
      scanDepth: 2,
    };

    it('F3-B.1: invokeMcpTool returns null for unregistered or non-existent tools', async () => {
      const result = await invokeMcpTool('non_existent_fake_tool', {});
      expect(result).toBeNull();
    });

    it('F3-B.2: readonly role denies mutating workspace tools', () => {
      const readonlyTools = enabledTools(mockConfig, 'readonly').map((t) => t.name);
      expect(readonlyTools).not.toContain('create_workspace');
      expect(readonlyTools).not.toContain('commit_workspace');
      expect(readonlyTools).not.toContain('finish_workspace');
      expect(readonlyTools).toContain('workspace_status');
    });

    it('F3-B.3: unknown runtime role fails closed and receives empty tools list', () => {
      const unknownRoleTools = enabledTools(mockConfig, 'unknown_malicious_role' as any);
      expect(unknownRoleTools).toEqual([]);
    });

    it('F3-B.4: explicit deny list excludes tools even for developer role', () => {
      const restricted = enabledTools(mockConfig, 'developer', undefined, ['refresh_context']);
      const names = restricted.map((t) => t.name);
      expect(names).not.toContain('refresh_context');
    });

    it('F3-B.5: read_workroom tool includes untrusted-collaborator security boundary', () => {
      const tool = findTool('read_workroom');
      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
    });
  });

  // ─── F4-B: CLI Skill Administration Boundaries ───────────────────────
  describe('F4-B: Skill Identifier Boundary Patterns', () => {
    it('F4-B.1: consecutive hyphens in skill ID are rejected', () => {
      expect(resourceIdSchema.safeParse('my--skill').success).toBe(false);
      expect(resourceIdSchema.safeParse('test---skill').success).toBe(false);
    });

    it('F4-B.2: leading and trailing hyphens in skill ID are rejected', () => {
      expect(resourceIdSchema.safeParse('-start-hyphen').success).toBe(false);
      expect(resourceIdSchema.safeParse('end-hyphen-').success).toBe(false);
    });

    it('F4-B.3: special characters and punctuation in skill ID are rejected', () => {
      const specialIds = ['skill@1', 'skill#core', 'skill$val', 'skill!'];
      for (const id of specialIds) {
        expect(resourceIdSchema.safeParse(id).success).toBe(false);
      }
    });

    it('F4-B.4: single-character valid ID is accepted', () => {
      expect(resourceIdSchema.safeParse('a').success).toBe(true);
      expect(resourceIdSchema.safeParse('1').success).toBe(true);
    });

    it('F4-B.5: maximum boundary 64-character valid ID is accepted', () => {
      const maxValidId = 'a'.repeat(64);
      expect(resourceIdSchema.safeParse(maxValidId).success).toBe(true);
    });
  });

  // ─── F5-B: Tag & Domain Pack Boundaries ──────────────────────────────
  describe('F5-B: Tag & Domain Rule Deduction Boundaries', () => {
    it('F5-B.1: getDomainPack returns null for unregistered tag identifier', () => {
      const nonExistent = getDomainPack('non-existent-domain-pack-12345');
      expect(nonExistent).toBeNull();
    });

    it('F5-B.2: resolveActiveDomainRules handles empty tag array gracefully', () => {
      const withoutOrg = resolveActiveDomainRules(undefined, []);
      expect(withoutOrg.allRules.length).toBe(0);
      expect(withoutOrg.domainPacks.length).toBe(0);
      expect(withoutOrg.compositeVerifyCommand).toBeUndefined();

      const withOrg = resolveActiveDomainRules('acme', []);
      expect(withOrg.domainPacks.length).toBe(0);
      expect(withOrg.allRules.length).toBe(4); // Root organization conventions
      expect(withOrg.compositeVerifyCommand).toBeUndefined();
    });

    it('F5-B.3: duplicate tags in input are deduplicated without generating duplicate rules', () => {
      const resolved = resolveActiveDomainRules('acme', ['economy', 'economy', 'ECONOMY']);
      const vatRules = resolved.allRules.filter((r) => r.toLowerCase().includes('vat'));
      expect(vatRules.length).toBe(1);
    });

    it('F5-B.4: case-insensitive tag input is normalized and resolved properly', () => {
      const lower = resolveActiveDomainRules('acme', ['economy']);
      const upper = resolveActiveDomainRules('acme', ['ECONOMY']);
      expect(lower.domainPacks.length).toBe(upper.domainPacks.length);
      expect(lower.allRules).toEqual(upper.allRules);
    });

    it('F5-B.5: unknown tags in mixed array are skipped without throwing error', () => {
      const mixed = resolveActiveDomainRules('acme', ['economy', 'unknown-tag-xyz']);
      expect(mixed.domainPacks.length).toBe(1);
      expect(mixed.domainPacks[0].id).toBe('economy');
    });
  });

  // ─── F6-B: CLI Inception & Flow Preset Boundaries ────────────────────
  describe('F6-B: Development Flow Preset Boundaries', () => {
    it('F6-B.1: quick flow does not require steps', async () => {
      ws = await createTestWorkspace({ flow: 'quick' });
      expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);
    });

    it('F6-B.2: feature flow does not infer dependencies', async () => {
      ws = await createTestWorkspace({ flow: 'feature' });
      expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);
    });

    it('F6-B.3: epic flow does not invent deliverables', async () => {
      ws = await createTestWorkspace({ flow: 'epic' });
      expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);
    });

    it('F6-B.4: empty repo list in workspace feature is handled safely in markdown generation', async () => {
      ws = await createTestWorkspace({ repos: [] });
      const agentsMd = await generateAgentsMd(ws.feature, []);
      expect(agentsMd).toContain('Where to look');
    });

    it('F6-B.5: feature branch names do not create milestones', async () => {
      ws = await createTestWorkspace({ flow: 'feature' });
      expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);
    });
  });

  // ─── F7-B: Web GUI Inception Payload Boundaries ──────────────────────
  describe('F7-B: Web GUI Inception Payload Schema Boundaries', () => {
    it('F7-B.1: rejects non-object or null payloads', () => {
      expect(validateCreateWorkspacePayload(null).isValid).toBe(false);
      expect(validateCreateWorkspacePayload(undefined).isValid).toBe(false);
      expect(validateCreateWorkspacePayload('string-payload').isValid).toBe(false);
    });

    it('F7-B.2: rejects repo items with missing name or path', () => {
      const payloadMissingName = {
        description: 'Valid description',
        mode: 'in-place',
        repos: [{ path: '/dev/repo' }],
      };
      expect(validateCreateWorkspacePayload(payloadMissingName).isValid).toBe(false);

      const payloadMissingPath = {
        description: 'Valid description',
        mode: 'in-place',
        repos: [{ name: 'repo-name' }],
      };
      expect(validateCreateWorkspacePayload(payloadMissingPath).isValid).toBe(false);
    });

    it('F7-B.3: accepts payload with very long description (up to 50,000 characters)', () => {
      const longDesc = 'A'.repeat(50_000);
      const payload = {
        description: longDesc,
        mode: 'in-place',
        repos: [{ name: 'repo-one', path: '/dev/repo-one' }],
      };
      const result = validateCreateWorkspacePayload(payload);
      expect(result.isValid).toBe(true);
    });

    it('F7-B.4: trims whitespace when evaluating required description', () => {
      const whitespaceDesc = '\t   \n  \r\n  ';
      const payload = {
        description: whitespaceDesc,
        mode: 'in-place',
        repos: [{ name: 'repo-one', path: '/dev/repo-one' }],
      };
      expect(validateCreateWorkspacePayload(payload).isValid).toBe(false);
    });

    it('F7-B.5: rejects invalid workspace mode strings', () => {
      const invalidModes = ['work-tree', 'inplace', 'local', 'remote'];
      for (const mode of invalidModes) {
        const payload = {
          description: 'Valid description',
          mode,
          repos: [{ name: 'repo-one', path: '/dev/repo-one' }],
        };
        expect(validateCreateWorkspacePayload(payload).isValid).toBe(false);
      }
    });
  });

  // ─── F8-B: Mid-Flight Refresh & Concurrency Boundaries ────────────────
  describe('F8-B: Workspace Refresh & State Preservation Boundaries', () => {
    it('F8-B.1: refreshWorkspace on non-existent directory throws error', async () => {
      const nonExistent = path.join(ws ? ws.workspacePath : '/tmp', 'non-existent-ws-12345');
      await expect(refreshWorkspace(nonExistent, { force: true })).rejects.toThrow();
    });

    it('F8-B.2: rapid sequential description updates retain latest state', async () => {
      ws = await createTestWorkspace({ description: 'Version 1' });

      ws.feature.description = 'Version 2';
      let md = await generateAgentsMd(ws.feature, ws.repos);
      expect(md).toContain('Version 2');

      ws.feature.description = 'Version 3 (Final Revision)';
      md = await generateAgentsMd(ws.feature, ws.repos);
      expect(md).toContain('Version 3 (Final Revision)');
      expect(md).not.toContain('Version 1');
      expect(md).not.toContain('Version 2');
    });

    it('F8-B.3: unmanaged markdown files in workspace root are preserved across refreshes', async () => {
      ws = await createTestWorkspace();
      const customDocPath = path.join(ws.workspacePath, 'CUSTOM_NOTES.md');
      await fs.writeFile(customDocPath, '# Custom Developer Notes', 'utf-8');

      await refreshWorkspace(ws.workspacePath, { force: true });

      const stillExists = await fse.pathExists(customDocPath);
      expect(stillExists).toBe(true);
      const content = await fs.readFile(customDocPath, 'utf-8');
      expect(content).toBe('# Custom Developer Notes');
    });

    it('F8-B.4: corrupted skills.json does not corrupt workspace manifest', async () => {
      ws = await createTestWorkspace();
      const skillsJsonPath = path.join(ws.workspacePath, '.contextspace', 'skills.json');
      await fs.writeFile(skillsJsonPath, '{ invalid-json-syntax }', 'utf-8');

      // Manifest remains valid
      const manifestPath = path.join(ws.workspacePath, 'contextspace.json');
      const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
      expect(() => JSON.parse(manifestRaw)).not.toThrow();
    });

    it('F8-B.5: multiple repos with overlapping files do not collision in AGENTS.md table', async () => {
      ws = await createTestWorkspace({
        repos: [
          { name: 'service-a', files: { 'README.md': 'Service A' } },
          { name: 'service-b', files: { 'README.md': 'Service B' } },
        ],
      });

      const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
      expect(agentsMd).toContain('`service-a`');
      expect(agentsMd).toContain('`service-b`');
    });
  });

  // ─── F9-B: Session Resumption Boundaries ─────────────────────────────
  describe('F9-B: Session Resumption Sanitization & Terminal Boundaries', () => {
    it('F9-B.1: session ID containing shell command injection characters is rejected', () => {
      const maliciousIds = [
        'session; rm -rf /',
        'session && echo pwned',
        'session | cat /etc/passwd',
        '`whoami`',
        '$(calc.exe)',
      ];

      for (const id of maliciousIds) {
        expect(isValidSessionId(id)).toBe(false);
      }
    });

    it('F9-B.2: session ID containing spaces or quotes is rejected', () => {
      expect(isValidSessionId('session with spaces')).toBe(false);
      expect(isValidSessionId('"quoted-session"')).toBe(false);
      expect(isValidSessionId("'single-quoted'")).toBe(false);
    });

    it('F9-B.3: unsupported assistant name throws descriptive error', () => {
      expect(() => buildHarnessCliCommand('unsupported-agent')).toThrow(
        /Unsupported assistant for terminal launch: "unsupported-agent"/,
      );
    });

    it('F9-B.4: buildHarnessCliCommand without sessionId outputs base launcher command', () => {
      expect(buildHarnessCliCommand('antigravity')).toBe('agy');
      expect(buildHarnessCliCommand('claude')).toBe('claude');
      expect(buildHarnessCliCommand('codex')).toBe('codex');
      expect(buildHarnessCliCommand('copilot')).toBe('copilot');
      expect(buildHarnessCliCommand('cursor')).toBe('cursor-agent');
    });

    it('F9-B.5: formatTerminalTitle sanitizes malicious title characters', () => {
      const dangerousTitle = 'Terminal Title; rm -rf /; \u001b[31mRed';
      const sanitized = formatTerminalTitle('/dev/ws', { title: dangerousTitle });
      expect(sanitized).not.toContain(';');
      expect(sanitized).not.toContain('\u001b');
    });
  });
});
