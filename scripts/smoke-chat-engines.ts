#!/usr/bin/env node
/**
 * Standalone mocked cross-engine chat contract smoke.
 *
 * This script never contacts a vendor engine. It validates Claude and Codex
 * harness initialization, provider-status model wiring, approval gating,
 * usage extraction, and invalid-model error surfacing with injected fakes.
 */

import { ClaudeSdkAdapter } from '../src/agent/ClaudeSdkAdapter.js';
import { CodexSdkAdapter } from '../src/agent/CodexSdkAdapter.js';
import { ProviderRegistry } from '../src/agent/adapters.js';
import { formatModelRejectionError, type ModelOption } from '../src/agent/models.js';
import type { ProviderStatus } from '../src/agent/ProviderRegistry.js';
import type { HarnessAdapter, SessionHandle } from '../src/harness/interface.js';
import type { HarnessEvent, StartSpec } from '../src/harness/types.js';

function requireModels(statuses: ProviderStatus[], providerId: string): readonly ModelOption[] {
  const status = statuses.find(candidate => candidate.id === providerId);
  if (!status) throw new Error(`ProviderStatus missing ${providerId}`);
  if (!status.models || status.models.length < 2) {
    throw new Error(`ProviderStatus for ${providerId} must advertise Automatic and at least one selectable model`);
  }
  return status.models;
}

function verifyProviderCatalogPair(
  statuses: ProviderStatus[],
  cliProviderId: string,
  sdkProviderId: string,
): string {
  const cliModels = requireModels(statuses, cliProviderId);
  const sdkModels = requireModels(statuses, sdkProviderId);
  const cliIds = cliModels.map(model => model.id);
  const sdkIds = sdkModels.map(model => model.id);

  if (cliIds[0] !== '' || sdkIds[0] !== '') {
    throw new Error(`${cliProviderId}/${sdkProviderId} catalogs must start with Automatic`);
  }
  if (new Set(cliIds).size !== cliIds.length || new Set(sdkIds).size !== sdkIds.length) {
    throw new Error(`${cliProviderId}/${sdkProviderId} catalogs contain duplicate model IDs`);
  }
  if (JSON.stringify(cliIds) !== JSON.stringify(sdkIds)) {
    throw new Error(`${cliProviderId}/${sdkProviderId} ProviderStatus catalogs have drifted`);
  }
  for (const model of [...cliModels, ...sdkModels]) {
    if (model.id !== model.id.trim()) {
      throw new Error(`${cliProviderId}/${sdkProviderId} catalog contains a non-normalized model ID`);
    }
    if (!model.label.trim() || !model.description.trim()) {
      throw new Error(`${cliProviderId}/${sdkProviderId} catalog contains incomplete model metadata`);
    }
  }

  const selectedModel = cliModels.find(model => model.id)?.id
    ?? (() => { throw new Error(`${cliProviderId} catalog has no selectable model`); })();
  for (const providerId of [cliProviderId, sdkProviderId]) {
    const provider = ProviderRegistry.getProvider(providerId);
    if (!provider || ProviderRegistry.resolveModel(provider, selectedModel) !== selectedModel) {
      throw new Error(`${providerId} does not resolve its advertised model '${selectedModel}' identically`);
    }
  }

  return selectedModel;
}

async function runSmokeTests() {
  console.log('=== MOCKED CONTRACT SMOKE — NO LIVE VENDOR CALLS ===');

  // 1. Verify the same provider-owned metadata production sends to the GUI.
  console.log('[1/4] Verifying ProviderStatus model catalogs...');
  const statuses = ProviderRegistry.getAllStatus();
  const claudeModel = verifyProviderCatalogPair(statuses, 'claude-cli', 'claude-sdk');
  const codexModel = verifyProviderCatalogPair(statuses, 'codex-cli', 'codex-sdk');
  console.log('✓ CLI and SDK ProviderStatus catalogs are complete, paired, and selectable.');

  // 2. Smoke Test Claude SDK with Model Choice + Approval Gate
  console.log('[2/4] Executing Claude SDK Adapter Smoke Turn (Model + Gating)...');
  let claudeSpecReceived: StartSpec | null = null;
  let claudeApprovalDenied = false;
  let claudeUsageReceived = false;

  async function* makeClaudeEvents(): AsyncIterable<HarnessEvent> {
    yield { type: 'session_started', sessionId: '11111111-1111-1111-1111-111111111111' };
    yield { type: 'text_delta', text: 'Claude stream delta 1...' };
    yield {
      type: 'approval_required',
      requestId: 'req-lifecycle',
      tool: 'mcp__nexusflow__create_workspace',
      input: { name: 'test' },
    };
    yield {
      type: 'turn_completed',
      usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
    };
  }

  const mockClaudeHarness: HarnessAdapter = {
    vendor: 'claude-code',
    async start(spec: StartSpec): Promise<SessionHandle> {
      claudeSpecReceived = spec;
      return {
        vendor: 'claude-code',
        sessionId: async () => '11111111-1111-1111-1111-111111111111',
        events: makeClaudeEvents(),
        send: () => {},
        respondToApproval: (_id, decision) => {
          if (decision.behavior === 'deny' && decision.message?.includes('unavailable in embedded chat')) {
            claudeApprovalDenied = true;
          }
        },
        interrupt: async () => {},
        dispose: async () => {},
      };
    },
    resume: viFn(),
    authStatus: async () => ({ configured: true }),
    listSessions: async () => [],
  };

  const claudeAdapter = new ClaudeSdkAdapter(
    undefined,
    mockClaudeHarness,
  );

  claudeAdapter.on('usage', () => { claudeUsageReceived = true; });
  claudeAdapter.start(process.cwd(), {
    id: '11111111-1111-1111-1111-111111111111',
    resume: false,
    model: claudeModel,
  });
  claudeAdapter.send('Hello Claude', 'workspace-write');

  // Wait briefly for stream processing
  await new Promise(r => setTimeout(r, 100));
  claudeAdapter.stop();

  if (claudeSpecReceived?.model !== claudeModel) {
    throw new Error(`Claude model not forwarded: received ${claudeSpecReceived?.model}`);
  }
  if (!claudeApprovalDenied) {
    throw new Error('Claude approval gate did not deny mutating lifecycle tool with guidance copy');
  }
  if (!claudeUsageReceived) {
    throw new Error('Claude usage frame not received');
  }
  console.log('✓ Claude SDK: model forwarded, mutating tool denied-with-guidance, usage captured.');

  // 3. Smoke Test Codex SDK with Model Choice
  console.log('[3/4] Executing Codex SDK Adapter Smoke Turn (Model Override)...');
  let codexSpecReceived: StartSpec | null = null;
  let codexUsageReceived = false;

  async function* makeCodexEvents(): AsyncIterable<HarnessEvent> {
    yield { type: 'session_started', sessionId: '22222222-2222-2222-2222-222222222222' };
    yield { type: 'text_delta', text: 'Codex stream response...' };
    yield {
      type: 'turn_completed',
      usage: { inputTokens: 200, outputTokens: 80, cachedInputTokens: 100 },
    };
  }

  const mockCodexHarness: HarnessAdapter = {
    vendor: 'codex',
    async start(spec: StartSpec): Promise<SessionHandle> {
      codexSpecReceived = spec;
      return {
        vendor: 'codex',
        sessionId: async () => '22222222-2222-2222-2222-222222222222',
        events: makeCodexEvents(),
        send: () => {},
        respondToApproval: () => {},
        interrupt: async () => {},
        dispose: async () => {},
      };
    },
    resume: viFn(),
    authStatus: async () => ({ configured: true }),
    listSessions: async () => [],
  };

  const codexAdapter = new CodexSdkAdapter(
    mockCodexHarness,
  );

  codexAdapter.on('usage', () => { codexUsageReceived = true; });
  codexAdapter.start(process.cwd(), {
    id: '22222222-2222-2222-2222-222222222222',
    resume: false,
    model: codexModel,
  });
  codexAdapter.send('Hello Codex', 'workspace-write');

  await new Promise(r => setTimeout(r, 100));
  codexAdapter.stop();

  if (codexSpecReceived?.model !== codexModel) {
    throw new Error(`Codex model not forwarded: received ${codexSpecReceived?.model}`);
  }
  if (!codexUsageReceived) {
    throw new Error('Codex usage frame not received');
  }
  console.log('✓ Codex SDK: model forwarded into the mocked harness contract, usage captured.');

  // 4. Test Invalid Model Error Frame
  console.log('[4/4] Testing Invalid Model Error Frame Surfacing...');
  let caughtErrorMsg = '';
  const invalidModelHarness: HarnessAdapter = {
    vendor: 'codex',
    async start(spec: StartSpec): Promise<SessionHandle> {
      throw new Error(formatModelRejectionError('codex-sdk', spec.model || 'unknown', 'model_not_found'));
    },
    resume: viFn(),
    authStatus: async () => ({ configured: true }),
    listSessions: async () => [],
  };

  const errAdapter = new CodexSdkAdapter(
    invalidModelHarness,
  );

  errAdapter.on('error', (err) => { caughtErrorMsg = err.message; });
  errAdapter.start(process.cwd(), {
    id: '33333333-3333-3333-3333-333333333333',
    resume: false,
    model: 'invalid-model-x',
  });
  errAdapter.send('Trigger error', 'workspace-write');

  await new Promise(r => setTimeout(r, 100));
  errAdapter.stop();

  if (!caughtErrorMsg.includes("Model 'invalid-model-x' was rejected") || !caughtErrorMsg.includes('Please select a valid model')) {
    throw new Error(`Error frame did not surface rejected model copy: got "${caughtErrorMsg}"`);
  }
  console.log('✓ Error frame properly surfaced rejected model name with remediation guidance.');

  console.log('\n=== MOCKED CONTRACT SMOKE PASSED — LIVE VALIDATION NOT PERFORMED ===');
}

function viFn(): any {
  return async () => ({} as any);
}

runSmokeTests().catch(err => {
  console.error('Smoke tests failed:', err);
  process.exit(1);
});
