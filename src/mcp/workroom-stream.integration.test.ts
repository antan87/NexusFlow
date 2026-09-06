import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findTool } from './tools.js';
import { startHostedWorkroom, type HostedWorkroom } from '../workrooms/host.js';
import { PinnedWorkroomClient } from '../workrooms/client.js';
import { WorkroomAuthorizationError, WORKROOM_SCHEMA_VERSION } from '../workrooms/contracts.js';
import { evaluateMilestoneStatus } from '../workrooms/milestones.js';
import * as workroomManager from '../workrooms/manager.js';
import * as workspace from '../core/workspace.js';
import type { NexusFlowConfig } from '../types.js';

const cleanupPaths: string[] = [];
const hosted: HostedWorkroom[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(hosted.splice(0).map((item) => item.stop().catch(() => {})));
  for (const target of cleanupPaths.splice(0)) {
    const resolved = path.resolve(target);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      await fs.rm(resolved, { recursive: true, force: true }).catch(() => {});
    }
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function testBundle(workspaceId: string) {
  return {
    schemaVersion: WORKROOM_SCHEMA_VERSION,
    project: { id: 'test-project', name: 'Test Project' },
    feature: { id: workspaceId, goal: 'Integration testing cross-harness coordination', description: 'Test' },
    repos: [{ id: 'repo-1', name: 'Repo 1', remoteUrl: 'https://example.test/repo-1', defaultBranch: 'main' }],
    pinnedResources: [],
    createdAt: new Date().toISOString(),
  };
}

const mockConfig: NexusFlowConfig = {
  version: '1.0',
  devDir: '/dev',
  workspacesDir: '/dev/workspaces',
  defaultAssistant: null,
  scanDepth: 2,
};

describe('Connected Workroom Stream Integration', () => {
  it('coordinates milestone proposals and stream reads across agents with proper authority', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-stream-integ-'));
    cleanupPaths.push(root);

    const workspaceId = 'feat-stream-test';
    const workspaceDir = path.join(root, 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    // 1. Spin up a real hosted Workroom server over HTTPS with SQLite store
    const port = await freePort();
    const host = await startHostedWorkroom({
      homeDir: root,
      name: 'Stream Integ Room',
      workspaceId,
      address: '127.0.0.1',
      port,
      password: 'secure horse battery staple',
      hostDisplayName: 'Human Host',
      bundle: testBundle(workspaceId),
      documents: { plan: '# Test Plan', handoff: 'Initial handoff' },
    });
    hosted.push(host);

    // Set up structured workflow on the room via human host authority
    await host.service.selectWorkflow(
      host.hostToken,
      {
        schemaVersion: 1,
        id: 'verification-workflow',
        version: '1.0.0',
        name: 'Verification Workflow',
        description: 'Verify cross-harness features',
        markdown: '# Verification Workflow',
        steps: [
          { id: 'step-plan', title: 'Plan Feature', requiresEvidence: false },
          { id: 'step-verify', title: 'Verify Verification', requiresEvidence: true },
        ],
        dependencies: [],
      },
      0,
    );

    // Mock workspace config resolution to our temporary workspace dir
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: workspaceId,
      branchName: workspaceId,
      description: 'Stream integration test workspace',
      mode: 'worktree',
      repos: [],
      assistants: ['antigravity', 'claude', 'codex'],
      workspacePath: workspaceDir,
      createdAt: new Date().toISOString(),
    });

    // Provide the pinned client with hostAgentToken (agent authority)
    const agentClient = new PinnedWorkroomClient(host.url, host.certificateFingerprint, host.hostAgentToken);
    vi.spyOn(workroomManager, 'loadPinnedWorkroomClientForWorkspace').mockResolvedValue(agentClient);

    const postTool = findTool('post_workroom_handoff')!;
    const readTool = findTool('read_workroom_stream')!;
    expect(postTool).toBeDefined();
    expect(readTool).toBeDefined();

    // -------------------------------------------------------------------------
    // TEST 1: Agent (e.g. Codex) calls post_workroom_handoff claiming status: "completed"
    //         Verify status is capped at "proposed" and remote proposal is completion_proposed
    // -------------------------------------------------------------------------
    const postResult = await postTool.handler(
      {
        message: 'Completed verification test suite with 100% pass rate.',
        stepId: 'step-verify',
        evidence: 'npm test passed: 14 test suites, 862 tests passed.',
        status: 'completed', // Agent attempts to claim completed
        harness: 'codex',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );

    expect(postResult.isError).toBeFalsy();
    const postPayload = JSON.parse(postResult.content[0]!.text);
    expect(postPayload.status).toBe('posted');
    expect(postPayload.effectiveMilestoneStatus).toBe('proposed'); // Capped!
    expect(postPayload.author).toBe('agent');
    expect(postPayload.workroomSynced).toBe(true);
    expect(postPayload.localChatPersisted).toBe(true);
    expect(postPayload.harness).toBe('codex');
    expect(postPayload.stepProposal).toMatchObject({
      stepId: 'step-verify',
      status: 'completion_proposed',
      evidence: 'npm test passed: 14 test suites, 862 tests passed.',
    });

    // Verify local chat ledger was written to disk with capped status and author: agent
    const chatLines = (await fs.readFile(path.join(workspaceDir, '.nexusflow', 'chat.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(chatLines).toHaveLength(1);
    expect(chatLines[0].status).toBe('proposed');
    expect(chatLines[0].author).toBe('agent');
    expect(chatLines[0].stepProposal.status).toBe('completion_proposed');

    // -------------------------------------------------------------------------
    // TEST 2: Agent 2 (e.g. Claude) calls read_workroom_stream
    //         Verifies proposal state remains unconfirmed (proposed) in evaluator
    // -------------------------------------------------------------------------
    const readResult = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );

    expect(readResult.isError).toBeFalsy();
    const readPayload = JSON.parse(readResult.content[0]!.text);
    expect(readPayload.status).toBe('connected');
    expect(readPayload.mode).toBe('workroom');
    expect(readPayload.workspaceId).toBe(workspaceId);
    expect(readPayload.activeStep).toMatchObject({
      stepId: 'step-verify',
      status: 'completion_proposed',
      evidence: 'npm test passed: 14 test suites, 862 tests passed.',
    });
    expect(readPayload.recentMessages).toHaveLength(1);
    expect(readPayload.recentMessages[0].harness).toBe('codex');

    // Milestone evaluator on read message evaluates to proposed, NOT completed
    const evaluatedStatus = evaluateMilestoneStatus(readPayload.recentMessages[0]);
    expect(evaluatedStatus).toBe('proposed');

    // -------------------------------------------------------------------------
    // TEST 3: Trusted Human Confirmation via Workroom Authority
    //         Human host transitions step to completed in Workroom
    // -------------------------------------------------------------------------
    const stepRevision = postPayload.stepProposal.revision;
    await host.service.transitionWorkflowStep(
      host.hostToken,
      'step-verify',
      'completed',
      stepRevision,
    );

    // Stream reader now reflects remote authoritative completion
    const readAfterConfirm = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    const confirmedPayload = JSON.parse(readAfterConfirm.content[0]!.text);
    const remoteStep = confirmedPayload.workflowProgress.steps.find((s: any) => s.stepId === 'step-verify');
    expect(remoteStep.status).toBe('completed');

    // Milestone evaluation with authoritative remote completed state evaluates to completed
    const evaluatedConfirmed = evaluateMilestoneStatus({
      ...readPayload.recentMessages[0],
      stepProposal: remoteStep,
    });
    expect(evaluatedConfirmed).toBe('completed');

    // -------------------------------------------------------------------------
    // TEST 4: Authority Boundaries & Actionable Error Handling
    // -------------------------------------------------------------------------
    // 4a. Agent token attempting human-only operation (updateDocument or transitionWorkflowStep)
    //     must be hard-rejected with 401 WorkroomAuthorizationError by the server
    await expect(
      agentClient.updateDocument('handoff', 'Agent trying human edit', 0),
    ).rejects.toBeInstanceOf(WorkroomAuthorizationError);

    await expect(
      agentClient.transitionWorkflowStep('step-verify', 'completed', 1),
    ).rejects.toBeInstanceOf(WorkroomAuthorizationError);

    // 4b. Agent posting handoff for a non-existent stepId receives an explicit syncError warning,
    //     NOT silent success, and evaluates to failed
    const invalidStepResult = await postTool.handler(
      {
        message: 'Trying non-existent step.',
        stepId: 'does-not-exist',
        harness: 'claude',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );

    expect(invalidStepResult.isError).toBeFalsy(); // Handled gracefully with warning
    const invalidPayload = JSON.parse(invalidStepResult.content[0]!.text);
    expect(invalidPayload.status).toBe('warning');
    expect(invalidPayload.workroomSynced).toBe(false);
    expect(invalidPayload.localChatPersisted).toBe(true);
    expect(invalidPayload.syncError).toContain('Workflow step "does-not-exist" was not found');

    // Evaluating the failed proposal entry returns failed
    expect(evaluateMilestoneStatus(invalidPayload)).toBe('failed');
  }, 30_000);
});
