/**
 * @module tests/e2e/tier4-scenarios.test
 * Tier 4: Real-World Application Scenarios (Full lifecycle workflows)
 * Covers all 5 workloads defined in TEST_INFRA.md.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import fse from 'fs-extra';
import { execa } from 'execa';

import {
  createTestWorkspace,
  readAgentsMd,
  readWorkspacePlan,
  listMaterializedSkills,
  generateAgentsMd,
  featureGates,
  type TestWorkspace,
} from './test-harness.js';

import {
  getDomainPack,
  resolveActiveDomainRules,
} from '../../src/core/domain-packs.js';

import { buildHarnessCliCommand } from '../../src/utils/terminal-launch.js';
import { createDefaultSteps } from '../../src/core/lifecycle.js';
import { reconcileWorkspaceResources } from '../../src/resources/materializer.js';
import { refreshWorkspace } from '../../src/core/refresh.js';

describe('Tier 4: Real-World Application Scenarios', () => {
  let ws: TestWorkspace;

  afterEach(async () => {
    if (ws) {
      await ws.cleanup();
    }
  });

  // ─── Scenario 1: Solo Bug Fix Workflow ───────────────────────────────
  it('Scenario 1: Solo Bug Fix Workflow (quick flow, in-place, reproduce/fix, terminal resumption)', async () => {
    // 1. Inception: Developer starts solo bug fix with quick flow in-place
    ws = await createTestWorkspace({
      id: 'fix-vat-calc',
      description: 'Fix rounding error in Swedish reverse-charge VAT computation',
      flow: 'quick',
      mode: 'in-place',
      tags: ['economy'],
      repos: [
        {
          name: 'billing-app',
          files: {
            'src/vat.ts': 'export function calcVat(amount: number): number { return amount * 0.25; }',
            'tests/vat.test.ts': '// reproduction test',
          },
        },
      ],
    });

    // 2. Sizing verification: Lifecycle sizes to 2 steps for fast turnaround
    const steps = createDefaultSteps('quick', ws.feature.id, ws.feature.branchName);
    expect(steps.length).toBe(2);
    expect(steps[0].id).toBe('reproduce_and_fix');
    expect(steps[1].id).toBe('verify_and_ship');
    expect(steps[1].dependsOn).toContain('reproduce_and_fix');

    // 3. Context check: AGENTS.md carries isolation instructions and domain rules
    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('Fix rounding error in Swedish reverse-charge VAT computation');
    expect(agentsMd).toContain('isolate_repo');
    expect(agentsMd).toContain('Economy & Invoicing');
    expect(agentsMd).toContain('Swedish VAT standard rates');

    // 4. Conventions check: Conventional commit pattern is present
    expect(agentsMd).toContain('^(feat|fix|refactor|test|chore|docs|style|perf|build|ci)');

    // 5. Session Resumption: Fast terminal launch check
    const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const resumeCmd = buildHarnessCliCommand('antigravity', sessionId);
    expect(resumeCmd).toBe(`agy --conversation ${sessionId}`);
  });

  // ─── Scenario 2: Standard Feature Development Workflow ───────────────
  it('Scenario 2: Standard Feature Development Workflow (feature flow, worktree, multi-tag, 4-step pipeline)', async () => {
    // 1. Inception: Standard feature with dedicated git worktree
    ws = await createTestWorkspace({
      id: 'feat-payroll-benefits',
      description: 'Implement Swedish collective agreement benefits and deductions',
      flow: 'feature',
      mode: 'worktree',
      tags: ['hr', 'hr/payroll'],
      repos: [
        { name: 'payroll-engine', files: { 'package.json': JSON.stringify({ name: 'payroll-engine', version: '2.0.0' }) } },
      ],
    });

    // 2. Lifecycle check: 4-stage pipeline is configured
    const steps = createDefaultSteps('feature', ws.feature.id, ws.feature.branchName);
    expect(steps.length).toBe(4);
    expect(steps.map((s) => s.id)).toEqual([
      'step_discovery',
      'step_implementation',
      'step_verification',
      'step_ship',
    ]);

    // 3. Domain rules: Parent and sub-vertical rules composite cleanly
    const resolved = resolveActiveDomainRules('hogia', ['hr', 'hr/payroll']);
    expect(resolved.compositeVerifyCommand).toContain('npm test -- hr');
    expect(resolved.compositeVerifyCommand).toContain('npm test -- payroll');

    // 4. AGENTS.md verification: Contains worktree structure and domain rules
    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('separate git worktree');
    expect(agentsMd).toContain('kollektivavtal');
    expect(agentsMd).toContain('Payroll & Salaries');

    // 5. Resumption check for Claude Code
    const sessionId = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const resumeCmd = buildHarnessCliCommand('claude', sessionId);
    expect(resumeCmd).toBe(`claude --resume ${sessionId}`);
  });

  // ─── Scenario 3: Agent Autonomous Skill Administration Workflow ──────
  it('Scenario 3: Agent Autonomous Skill Administration Workflow (local creation, materialization, lockfile)', async () => {
    // 1. Workspace inception
    ws = await createTestWorkspace({
      id: 'agent-skill-workspace',
      description: 'Workspace requiring specialized verification playbook',
    });

    // 2. Agent creates workspace-local one-off skill
    const autonomousSkill = {
      id: 'swedish-tax-auditor',
      name: 'swedish-tax-auditor',
      title: 'Swedish Tax Compliance Auditor',
      description: 'Verifies Skatteverket tax rules for ledger entries',
      content: `# Swedish Tax Compliance Auditor
1. Check VAT rate applicability.
2. Verify reverse charge requirements for EU businesses.
3. Validate monotonic invoice numbering.`,
      tags: ['tax', 'compliance', 'skatteverket'],
      custom: true,
    };

    // 3. Materialize directly into workspace
    const reconcileResult = await reconcileWorkspaceResources(
      ws.workspacePath,
      ['antigravity', 'cursor'],
      [autonomousSkill],
      [],
    );

    expect(reconcileResult.installed.some((p) => p.includes('swedish-tax-auditor'))).toBe(true);

    // 4. Verify physical materialization on disk
    const materialized = await listMaterializedSkills(ws.workspacePath);
    expect(materialized).toContain('swedish-tax-auditor');

    const skillPath = path.join(ws.workspacePath, '.agents', 'skills', 'swedish-tax-auditor', 'SKILL.md');
    const skillContent = await fs.readFile(skillPath, 'utf-8');
    expect(skillContent).toContain('Swedish Tax Compliance Auditor');
    expect(skillContent).toContain('Validate monotonic invoice numbering');

    // 5. Verify integrity lockfile
    const lockPath = path.join(ws.workspacePath, '.contextspace', 'resources.lock.json');
    const lockRaw = await fs.readFile(lockPath, 'utf-8');
    const lock = JSON.parse(lockRaw);
    expect(lock.outputs.some((o: any) => o.resourceId === 'swedish-tax-auditor')).toBe(true);
  });

  // ─── Scenario 4: Mid-Flight Scope Shift Workflow ─────────────────────
  it('Scenario 4: Mid-Flight Scope Shift Workflow (PO refines AC, toggles tags, dynamic AGENTS.md recompile)', async () => {
    // 1. Initial inception: Basic billing feature
    ws = await createTestWorkspace({
      id: 'shift-workspace',
      description: 'Initial invoicing feature',
      tags: ['economy'],
    });

    let agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('Initial invoicing feature');
    expect(agentsMd).not.toContain('GDPR & Privacy Guard');

    // 2. Mid-flight shift: PO adds strict GDPR compliance requirements & acceptance criteria
    ws.feature.description = `Initial invoicing feature
## Acceptance Criteria
- [ ] AC 1: Ensure customer personal data is encrypted at rest
- [ ] AC 2: Apply Swedish VAT correctly on exported invoices
- [ ] AC 3: Mask credit card and bank account details in logs`;
    ws.feature.domainPacks = ['economy', 'gdpr'];

    // Persist manifest change
    await fs.writeFile(
      path.join(ws.workspacePath, 'contextspace.json'),
      JSON.stringify(ws.feature, null, 2),
      'utf-8',
    );

    // 3. Trigger dynamic workspace refresh
    const refreshResult = await refreshWorkspace(ws.workspacePath, { force: true });
    expect(refreshResult).toBeDefined();

    // 4. Verify AGENTS.md recompiled with both economy and GDPR rules
    const updatedMd = await readAgentsMd(ws.workspacePath);
    expect(updatedMd).toContain('Ensure customer personal data is encrypted at rest');
    expect(updatedMd).toContain('Economy & Invoicing');
    expect(updatedMd).toContain('GDPR & Privacy Guard');
  });

  // ─── Scenario 5: Multi-Repo Enterprise Epic Workflow ─────────────────
  it('Scenario 5: Multi-Repo Enterprise Epic Workflow (epic flow, multi-repo plan, sister fleet tracking)', async () => {
    // 1. Inception: Multi-repo epic with 3 repositories
    ws = await createTestWorkspace({
      id: 'epic-enterprise-portal',
      description: 'Enterprise HR and payroll customer self-service portal',
      flow: 'epic',
      mode: 'worktree',
      tags: ['hr', 'hr/payroll', 'economy'],
      repos: [
        {
          name: 'identity-service',
          files: { 'package.json': JSON.stringify({ name: 'identity-service', version: '1.0.0' }) },
        },
        {
          name: 'payroll-engine',
          files: {
            'package.json': JSON.stringify({
              name: 'payroll-engine',
              version: '1.0.0',
              dependencies: { 'identity-service': '1.0.0' },
            }),
          },
        },
        {
          name: 'portal-frontend',
          files: {
            'package.json': JSON.stringify({
              name: 'portal-frontend',
              version: '1.0.0',
              dependencies: { 'payroll-engine': '1.0.0' },
            }),
          },
        },
      ],
    });

    // 2. Lifecycle Sizing: 4 multi-slice stages
    const steps = createDefaultSteps('epic', ws.feature.id, ws.feature.branchName);
    expect(steps.length).toBe(4);
    expect(steps[0].id).toBe('epic_slice_1');
    expect(steps[1].id).toBe('epic_slice_2');
    expect(steps[2].id).toBe('epic_slice_3');
    expect(steps[3].id).toBe('epic_slice_4');

    // 3. Composite verification across all vertical tags
    const resolved = resolveActiveDomainRules('hogia', ['hr', 'hr/payroll', 'economy']);
    expect(resolved.compositeVerifyCommand).toContain('npm test -- hr');
    expect(resolved.compositeVerifyCommand).toContain('npm test -- payroll');
    expect(resolved.compositeVerifyCommand).toContain('npm test -- economy');

    // 4. AGENTS.md generation: Verifies all 3 repos are listed
    const agentsMd = await generateAgentsMd(ws.feature, ws.repos);
    expect(agentsMd).toContain('`identity-service`');
    expect(agentsMd).toContain('`payroll-engine`');
    expect(agentsMd).toContain('`portal-frontend`');

    // 5. Session resumption across assistants for multi-agent collaboration
    const agyCmd = buildHarnessCliCommand('antigravity', '12345678-1234-4234-8234-123456789abc');
    const codexCmd = buildHarnessCliCommand('codex', '12345678-1234-4234-8234-123456789abc');
    expect(agyCmd).toContain('agy --conversation');
    expect(codexCmd).toContain('codex resume');
  });
});
