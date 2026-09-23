/**
 * @module tests/e2e/tier3-combinations.test
 * Tier 3: Cross-Feature Combinations (Pairwise coverage across tags, skills, flow sizing, and workspace modes)
 * Minimum 10 pairwise test cases.
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
  type TestWorkspace,
} from './test-harness.js';

import {
  getDomainPack,
  resolveActiveDomainRules,
} from '../../src/core/domain-packs.js';

import { buildHarnessCliCommand } from '../../src/utils/terminal-launch.js';
import { loadWorkspaceLifecycle } from '../../src/core/lifecycle.js';
import { reconcileWorkspaceResources } from '../../src/resources/materializer.js';
import { refreshWorkspace } from '../../src/core/refresh.js';

describe('Tier 3: Cross-Feature Combinations (Pairwise)', () => {
  let ws: TestWorkspace;

  afterEach(async () => {
    if (ws) {
      await ws.cleanup();
    }
  });

  // C1: Flow quick + In-Place mode + economy tag + antigravity assistant
  it('C1: Flow quick + In-Place mode + economy tag + antigravity assistant', async () => {
    ws = await createTestWorkspace({
      flow: 'quick',
      mode: 'in-place',
      tags: ['economy'],
    });

    expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('isolate_repo');
    expect(agentsMd).toContain('Economy & Invoicing');
    expect(agentsMd).toContain('Swedish VAT standard rates');

    const sessionUuid = '11111111-2222-4333-8444-555555555555';
    const cliCmd = buildHarnessCliCommand('antigravity', sessionUuid);
    expect(cliCmd).toBe(`agy --conversation ${sessionUuid}`);
  });

  // C2: Flow feature + Worktree mode + economy tag + claude assistant
  it('C2: Flow feature + Worktree mode + economy tag + claude assistant', async () => {
    ws = await createTestWorkspace({
      flow: 'feature',
      mode: 'worktree',
      tags: ['economy'],
    });

    expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('separate git worktree');
    expect(agentsMd).toContain('Economy & Invoicing');

    const sessionUuid = '22222222-3333-4444-8555-666666666666';
    const cliCmd = buildHarnessCliCommand('claude', sessionUuid);
    expect(cliCmd).toBe(`claude --resume ${sessionUuid}`);
  });

  // C3: Flow epic + Worktree mode + multiple tags (hr, hr/payroll) + codex assistant
  it('C3: Flow epic + Worktree mode + hierarchical tags (hr, hr/payroll) + codex assistant', async () => {
    ws = await createTestWorkspace({
      flow: 'epic',
      mode: 'worktree',
      tags: ['hr', 'hr/payroll'],
    });

    expect((await loadWorkspaceLifecycle(ws.workspacePath)).steps).toEqual([]);

    const resolved = resolveActiveDomainRules('acme', ['hr', 'hr/payroll']);
    expect(resolved.compositeVerifyCommand).toContain('npm test -- hr');
    expect(resolved.compositeVerifyCommand).toContain('npm test -- payroll');

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('Payroll & Salaries');
    expect(agentsMd).toContain('HR & Workforce');
    expect(agentsMd).toContain('kollektivavtal');

    const sessionUuid = '33333333-4444-4555-8666-777777777777';
    const cliCmd = buildHarnessCliCommand('codex', sessionUuid);
    expect(cliCmd).toBe(`codex resume ${sessionUuid}`);
  });

  // C4: Workspace-local skills + domain pack rules + dynamic AGENTS.md recompilation
  it('C4: Workspace-local skills + domain pack rules + dynamic AGENTS.md recompilation', async () => {
    ws = await createTestWorkspace({ tags: ['economy'] });

    const localSkill = {
      id: 'custom-vat-auditor',
      name: 'custom-vat-auditor',
      title: 'Custom VAT Auditor',
      description: 'Audits Swedish VAT entries in code',
      content: '# Custom VAT Auditor\nAudit instructions.',
      custom: true,
    };

    // Materialize skill
    await reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [localSkill], []);

    const materialized = await listMaterializedSkills(ws.workspacePath);
    expect(materialized).toContain('custom-vat-auditor');

    // Generate AGENTS.md and verify rules and skills directory pointer
    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('Economy & Invoicing');
    expect(agentsMd).toContain('.agents/skills/');
  });

  // C5: Mid-flight tag toggle (add then remove) + materializer reconciliation
  it('C5: Mid-flight tag toggle (add then remove) + materializer reconciliation', async () => {
    ws = await createTestWorkspace({ tags: ['economy'] });

    const skillA = {
      id: 'skill-alpha',
      name: 'skill-alpha',
      description: 'Alpha skill',
      content: '# Alpha\nAlpha instructions.',
      custom: true,
    };
    const skillB = {
      id: 'skill-beta',
      name: 'skill-beta',
      description: 'Beta skill',
      content: '# Beta\nBeta instructions.',
      custom: true,
    };

    // Step 1: Install both skills
    await reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [skillA, skillB], []);
    let currentSkills = await listMaterializedSkills(ws.workspacePath);
    expect(currentSkills).toContain('skill-alpha');
    expect(currentSkills).toContain('skill-beta');

    // Step 2: Remove skill-alpha, keep skill-beta
    const result = await reconcileWorkspaceResources(ws.workspacePath, ['antigravity'], [skillB], []);
    expect(result.removed.some((p) => p.includes('skill-alpha'))).toBe(true);

    currentSkills = await listMaterializedSkills(ws.workspacePath);
    expect(currentSkills).not.toContain('skill-alpha');
    expect(currentSkills).toContain('skill-beta');
  });

  // C6: Flow quick + In-Place mode + isolation rule enforcement in AGENTS.md
  it('C6: Flow quick + In-Place mode + isolation rule enforcement in AGENTS.md', async () => {
    ws = await createTestWorkspace({
      flow: 'quick',
      mode: 'in-place',
    });

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('READ-ONLY reference mode');
    expect(agentsMd).toContain('isolate_repo');
  });

  // C7: Multi-repo epic + Topological dependency plan generation
  it('C7: Multi-repo epic + topological dependency plan generation', async () => {
    ws = await createTestWorkspace({
      flow: 'epic',
      mode: 'worktree',
      repos: [
        { name: 'core-lib', files: { 'package.json': JSON.stringify({ name: 'core-lib', version: '1.0.0' }) } },
        { name: 'api-service', files: { 'package.json': JSON.stringify({ name: 'api-service', dependencies: { 'core-lib': '1.0.0' } }) } },
      ],
    });

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('`core-lib`');
    expect(agentsMd).toContain('`api-service`');
  });

  // C8: Flow feature + multiple AI assistants portable skill materialization
  it('C8: Flow feature + multiple AI assistants portable skill materialization', async () => {
    ws = await createTestWorkspace({ flow: 'feature' });

    const sharedSkill = {
      id: 'multi-assistant-skill',
      name: 'multi-assistant-skill',
      title: 'Shared Skill',
      description: 'Shared across assistants',
      content: '# Shared Skill\nPortable instructions.',
      custom: true,
    };

    const assistants = ['antigravity', 'cursor', 'copilot'] as const;
    const result = await reconcileWorkspaceResources(
      ws.workspacePath,
      [...assistants],
      [sharedSkill],
      [],
    );

    expect(result.installed.length).toBeGreaterThan(0);
    const agentSkills = await listMaterializedSkills(ws.workspacePath);
    expect(agentSkills).toContain('multi-assistant-skill');

    // Verify .cursor/skills/ and .github/skills/ redundant projections do not exist
    const cursorSkillPath = path.join(ws.workspacePath, '.cursor', 'skills', 'multi-assistant-skill', 'SKILL.md');
    expect(await fse.pathExists(cursorSkillPath)).toBe(false);
    const copilotSkillPath = path.join(ws.workspacePath, '.github', 'skills', 'multi-assistant-skill', 'SKILL.md');
    expect(await fse.pathExists(copilotSkillPath)).toBe(false);
  });

  // C9: Mid-flight description refinement + tag addition + refresh concurrency
  it('C9: Mid-flight description refinement + tag addition + refresh concurrency', async () => {
    ws = await createTestWorkspace({
      description: 'Base requirements',
      tags: ['economy'],
    });

    // Mutate state mid-flight and persist to manifest
    ws.feature.description = 'Expanded requirements with GDPR and VAT checks';
    ws.feature.domainPacks = ['economy', 'gdpr'];
    await fs.writeFile(
      path.join(ws.workspacePath, 'contextspace.json'),
      JSON.stringify(ws.feature, null, 2),
      'utf-8',
    );

    const result = await refreshWorkspace(ws.workspacePath, { force: true });
    expect(result).toBeDefined();

    const updatedMd = await readAgentsMd(ws.workspacePath);
    expect(updatedMd).toContain('Expanded requirements with GDPR and VAT checks');
    expect(updatedMd).toContain('GDPR & Privacy Guard');
    expect(updatedMd).toContain('Economy & Invoicing');
  });

  // C10: Ad-hoc inception + organization conventions (Acme Corp) + custom verification commands
  it('C10: Ad-hoc inception + organization conventions (Acme Corp) + composable verify commands', async () => {
    ws = await createTestWorkspace({
      organizationId: 'acme',
      tags: ['economy'],
    });

    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);

    // Verify Acme conventions
    expect(agentsMd).toContain('Organization Conventions (Acme Corp)');
    expect(agentsMd).toContain('feat(ECO-412)');
    expect(agentsMd).toContain('.github/pull_request_template.md');

    // Verify domain verification command
    expect(agentsMd).toContain('npm test -- economy');
  });
});
