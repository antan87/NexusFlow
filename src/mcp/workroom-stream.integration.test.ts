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
import { app } from '../server.js';
import * as configModule from '../core/config.js';
import * as workroomManager from '../workrooms/manager.js';
import * as workspace from '../core/workspace.js';
import { resolveWorkspaceChatLedger } from '../core/constants.js';
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
    const workspaceDir = path.join(root, workspaceId);
    await fs.mkdir(workspaceDir, { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      ...mockConfig,
      workspacesDir: root,
    } as any);

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
    const ledger = await resolveWorkspaceChatLedger(workspaceDir);
    const chatLines = (await fs.readFile(ledger.chatPath, 'utf8'))
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

    // Milestone evaluation directly on confirmedPayload.recentMessages[0] evaluates to completed
    // WITHOUT manually injecting stepProposal - stream reader dynamically reconciles live state!
    const evaluatedConfirmed = evaluateMilestoneStatus(confirmedPayload.recentMessages[0]);
    expect(evaluatedConfirmed).toBe('completed');
    expect(confirmedPayload.recentMessages[0].stepProposal.status).toBe('completed');

    // GUI / API stream endpoint also returns dynamically reconciled messages and live workflowProgress
    const guiStreamRes = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(guiStreamRes.status).toBe(200);
    const guiStreamPayload = (await guiStreamRes.json()) as any;
    expect(guiStreamPayload.isRemoteActive).toBe(true);
    expect(guiStreamPayload.workflowProgress.steps.find((s: any) => s.stepId === 'step-verify').status).toBe('completed');
    expect(guiStreamPayload.messages[0].stepProposal.status).toBe('completed');
    expect(evaluateMilestoneStatus(guiStreamPayload.messages[0])).toBe('completed');

    // -------------------------------------------------------------------------
    // TEST 3b: Subsequent Authoritative Transitions
    //         Human host re-transitions step back to in_progress (reopening it)
    //         Verify read_workroom_stream immediately reconciles to in_progress
    // -------------------------------------------------------------------------
    const updatedRevision = remoteStep.revision;
    await host.service.transitionWorkflowStep(
      host.hostToken,
      'step-verify',
      'in_progress',
      updatedRevision,
    );

    const readAfterReopen = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    const reopenPayload = JSON.parse(readAfterReopen.content[0]!.text);
    const reopenedStep = reopenPayload.workflowProgress.steps.find((s: any) => s.stepId === 'step-verify');
    expect(reopenedStep.status).toBe('in_progress');
    expect(reopenPayload.recentMessages[0].stepProposal.status).toBe('in_progress');

    // Evaluator directly on stream message now reflects in_progress status
    const evaluatedReopen = evaluateMilestoneStatus(reopenPayload.recentMessages[0]);
    expect(evaluatedReopen).toBe('in_progress');

    // GUI / API stream endpoint immediately reflects subsequent transition to in_progress
    const guiStreamRes2 = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(guiStreamRes2.status).toBe(200);
    const guiStreamPayload2 = (await guiStreamRes2.json()) as any;
    expect(guiStreamPayload2.workflowProgress.steps.find((s: any) => s.stepId === 'step-verify').status).toBe('in_progress');
    expect(guiStreamPayload2.messages[0].stepProposal.status).toBe('in_progress');
    expect(evaluateMilestoneStatus(guiStreamPayload2.messages[0])).toBe('in_progress');

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

describe('Shared Brand-Aware Ledger Integration (API ↔ MCP)', () => {
  it('shares ledger bidirectionally (API → MCP, MCP → API) in native ContextSpace workspaces (.contextspace)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-ledger-native-'));
    cleanupPaths.push(root);

    const workspaceId = 'native-ws';
    const workspaceDir = path.join(root, workspaceId);
    await fs.mkdir(path.join(workspaceDir, '.contextspace'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      ...mockConfig,
      workspacesDir: root,
    } as any);

    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: workspaceId,
      branchName: workspaceId,
      description: 'Native workspace',
      mode: 'worktree',
      repos: [],
      assistants: ['antigravity', 'claude', 'codex'],
      workspacePath: workspaceDir,
      createdAt: new Date().toISOString(),
    });

    const postTool = findTool('post_workroom_handoff')!;
    const readTool = findTool('read_workroom_stream')!;

    // 1. API POST -> MCP read
    const apiPostRes = await app.request(`/api/workspace/${workspaceId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'GUI handoff in native workspace',
        harness: 'developer',
        author: 'human',
      }),
    });
    expect(apiPostRes.status).toBe(200);

    const mcpReadRes = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpReadRes.isError).toBeFalsy();
    const mcpPayload = JSON.parse(mcpReadRes.content[0]!.text);
    expect(mcpPayload.recentMessages).toHaveLength(1);
    expect(mcpPayload.recentMessages[0].message).toBe('GUI handoff in native workspace');
    expect(mcpPayload.recentMessages[0].author).toBe('human');

    // 2. MCP POST -> API GET
    const mcpPostRes = await postTool.handler(
      {
        message: 'MCP handoff in native workspace',
        harness: 'antigravity',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpPostRes.isError).toBeFalsy();

    const apiGetRes = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(apiGetRes.status).toBe(200);
    const apiPayload = (await apiGetRes.json()) as any;
    expect(apiPayload.messages).toHaveLength(2);
    expect(apiPayload.messages[0].message).toBe('GUI handoff in native workspace');
    expect(apiPayload.messages[1].message).toBe('MCP handoff in native workspace');
    expect(apiPayload.ledgerPath).toBe('.contextspace/chat.jsonl');
    expect(apiPayload.isLegacy).toBe(false);

    // Verify storage location on disk
    const primaryExists = await fs.access(path.join(workspaceDir, '.contextspace', 'chat.jsonl')).then(() => true).catch(() => false);
    const legacyExists = await fs.access(path.join(workspaceDir, '.nexusflow', 'chat.jsonl')).then(() => true).catch(() => false);
    expect(primaryExists).toBe(true);
    expect(legacyExists).toBe(false);
  });

  it('shares ledger bidirectionally (API → MCP, MCP → API) in legacy NexusFlow workspaces (.nexusflow)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nf-ledger-legacy-'));
    cleanupPaths.push(root);

    const workspaceId = 'legacy-ws';
    const workspaceDir = path.join(root, workspaceId);
    await fs.mkdir(path.join(workspaceDir, '.nexusflow'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      ...mockConfig,
      workspacesDir: root,
    } as any);

    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: workspaceId,
      branchName: workspaceId,
      description: 'Legacy workspace',
      mode: 'worktree',
      repos: [],
      assistants: ['antigravity', 'claude', 'codex'],
      workspacePath: workspaceDir,
      createdAt: new Date().toISOString(),
    });

    const postTool = findTool('post_workroom_handoff')!;
    const readTool = findTool('read_workroom_stream')!;

    // 1. API POST -> MCP read
    const apiPostRes = await app.request(`/api/workspace/${workspaceId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'GUI handoff in legacy workspace',
        harness: 'developer',
        author: 'human',
      }),
    });
    expect(apiPostRes.status).toBe(200);

    const mcpReadRes = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpReadRes.isError).toBeFalsy();
    const mcpPayload = JSON.parse(mcpReadRes.content[0]!.text);
    expect(mcpPayload.recentMessages).toHaveLength(1);
    expect(mcpPayload.recentMessages[0].message).toBe('GUI handoff in legacy workspace');

    // 2. MCP POST -> API GET
    const mcpPostRes = await postTool.handler(
      {
        message: 'MCP handoff in legacy workspace',
        harness: 'claude',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpPostRes.isError).toBeFalsy();

    const apiGetRes = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(apiGetRes.status).toBe(200);
    const apiPayload = (await apiGetRes.json()) as any;
    expect(apiPayload.messages).toHaveLength(2);
    expect(apiPayload.messages[0].message).toBe('GUI handoff in legacy workspace');
    expect(apiPayload.messages[1].message).toBe('MCP handoff in legacy workspace');
    expect(apiPayload.ledgerPath).toBe('.nexusflow/chat.jsonl');
    expect(apiPayload.isLegacy).toBe(true);

    // Verify storage location on disk
    const legacyExists = await fs.access(path.join(workspaceDir, '.nexusflow', 'chat.jsonl')).then(() => true).catch(() => false);
    const primaryExists = await fs.access(path.join(workspaceDir, '.contextspace', 'chat.jsonl')).then(() => true).catch(() => false);
    expect(legacyExists).toBe(true);
    expect(primaryExists).toBe(false);
  });

  it('preserves existing history and shares bidirectionally in mixed-directory workspaces with legacy ledger', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mixed-ledger-legacy-'));
    cleanupPaths.push(root);

    const workspaceId = 'mixed-ws';
    const workspaceDir = path.join(root, workspaceId);
    // Both directories exist!
    await fs.mkdir(path.join(workspaceDir, '.nexusflow'), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, '.contextspace'), { recursive: true });

    // Pre-existing history in .nexusflow/chat.jsonl
    const initialEntry = {
      id: 'pre-rebrand-entry',
      timestamp: '2026-09-01T10:00:00.000Z',
      harness: 'codex',
      author: 'agent',
      status: 'proposed',
      message: 'Initial pre-rebrand handoff note',
    };
    await fs.writeFile(
      path.join(workspaceDir, '.nexusflow', 'chat.jsonl'),
      JSON.stringify(initialEntry) + '\n',
      'utf8',
    );

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      ...mockConfig,
      workspacesDir: root,
    } as any);

    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: workspaceId,
      branchName: workspaceId,
      description: 'Mixed workspace',
      mode: 'worktree',
      repos: [],
      assistants: ['antigravity', 'claude', 'codex'],
      workspacePath: workspaceDir,
      createdAt: new Date().toISOString(),
    });

    const postTool = findTool('post_workroom_handoff')!;
    const readTool = findTool('read_workroom_stream')!;

    // Initial readers must see historical entry
    const initialMcpRead = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    const initialMcpPayload = JSON.parse(initialMcpRead.content[0]!.text);
    expect(initialMcpPayload.recentMessages).toHaveLength(1);
    expect(initialMcpPayload.recentMessages[0].id).toBe('pre-rebrand-entry');

    const initialApiGet = await app.request(`/api/workspace/${workspaceId}/stream`);
    const initialApiPayload = (await initialApiGet.json()) as any;
    expect(initialApiPayload.messages).toHaveLength(1);
    expect(initialApiPayload.messages[0].id).toBe('pre-rebrand-entry');

    // 1. API POST -> MCP read
    const apiPostRes = await app.request(`/api/workspace/${workspaceId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'GUI handoff in mixed workspace',
        harness: 'developer',
        author: 'human',
      }),
    });
    expect(apiPostRes.status).toBe(200);

    const mcpReadRes = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    const mcpPayload = JSON.parse(mcpReadRes.content[0]!.text);
    expect(mcpPayload.recentMessages).toHaveLength(2);
    expect(mcpPayload.recentMessages[0].id).toBe('pre-rebrand-entry');
    expect(mcpPayload.recentMessages[1].message).toBe('GUI handoff in mixed workspace');

    // 2. MCP POST -> API GET
    const mcpPostRes = await postTool.handler(
      {
        message: 'MCP handoff in mixed workspace',
        harness: 'antigravity',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpPostRes.isError).toBeFalsy();

    const apiGetRes = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(apiGetRes.status).toBe(200);
    const apiPayload = (await apiGetRes.json()) as any;
    expect(apiPayload.messages).toHaveLength(3);
    expect(apiPayload.messages[0].id).toBe('pre-rebrand-entry');
    expect(apiPayload.messages[1].message).toBe('GUI handoff in mixed workspace');
    expect(apiPayload.messages[2].message).toBe('MCP handoff in mixed workspace');

    // Ledger path reflects preserved legacy file where history lives
    expect(apiPayload.ledgerPath).toBe('.nexusflow/chat.jsonl');
  });

  it('shares ledger bidirectionally in mixed-directory workspaces without pre-existing ledger files', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mixed-fresh-'));
    cleanupPaths.push(root);

    const workspaceId = 'fresh-mixed-ws';
    const workspaceDir = path.join(root, workspaceId);
    await fs.mkdir(path.join(workspaceDir, '.nexusflow'), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, '.contextspace'), { recursive: true });

    vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
      ...mockConfig,
      workspacesDir: root,
    } as any);

    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
      id: workspaceId,
      branchName: workspaceId,
      description: 'Fresh mixed workspace',
      mode: 'worktree',
      repos: [],
      assistants: ['antigravity', 'claude', 'codex'],
      workspacePath: workspaceDir,
      createdAt: new Date().toISOString(),
    });

    const postTool = findTool('post_workroom_handoff')!;
    const readTool = findTool('read_workroom_stream')!;

    // 1. API POST -> MCP read
    const apiPostRes = await app.request(`/api/workspace/${workspaceId}/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'GUI handoff in fresh mixed',
        harness: 'developer',
        author: 'human',
      }),
    });
    expect(apiPostRes.status).toBe(200);

    const mcpReadRes = await readTool.handler(
      { limit: 10 },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    const mcpPayload = JSON.parse(mcpReadRes.content[0]!.text);
    expect(mcpPayload.recentMessages).toHaveLength(1);
    expect(mcpPayload.recentMessages[0].message).toBe('GUI handoff in fresh mixed');

    // 2. MCP POST -> API GET
    const mcpPostRes = await postTool.handler(
      {
        message: 'MCP handoff in fresh mixed',
        harness: 'claude',
      },
      { config: mockConfig, workspacePath: workspaceDir },
    );
    expect(mcpPostRes.isError).toBeFalsy();

    const apiGetRes = await app.request(`/api/workspace/${workspaceId}/stream`);
    expect(apiGetRes.status).toBe(200);
    const apiPayload = (await apiGetRes.json()) as any;
    expect(apiPayload.messages).toHaveLength(2);
    expect(apiPayload.messages[0].message).toBe('GUI handoff in fresh mixed');
    expect(apiPayload.messages[1].message).toBe('MCP handoff in fresh mixed');
    expect(apiPayload.ledgerPath).toBe('.contextspace/chat.jsonl');
  });
});
