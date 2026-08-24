#!/usr/bin/env node
/**
 * Standalone cross-engine chat smoke test script.
 * Validates Claude and Codex harness initialization, model overrides,
 * approval gating, usage extraction, and invalid-model error surfacing.
 */

import { ClaudeSdkAdapter } from '../src/agent/ClaudeSdkAdapter.js';
import { CodexSdkAdapter } from '../src/agent/CodexSdkAdapter.js';
import { PROVIDER_MODELS, formatModelRejectionError } from '../src/agent/models.js';
import type { HarnessAdapter, SessionHandle } from '../src/harness/interface.js';
import type { HarnessEvent, StartSpec } from '../src/harness/types.js';

async function runSmokeTests() {
  console.log('--- Starting Cross-Engine Chat Smoke Test Suite ---');

  // 1. Verify Model Catalogs
  console.log('[1/4] Verifying Model Catalogs...');
  const claudeModels = PROVIDER_MODELS['claude-cli'];
  const codexModels = PROVIDER_MODELS['codex-cli'];
  if (!claudeModels?.some(m => m.id === 'claude-3-7-sonnet-latest')) {
    throw new Error('Claude catalog missing claude-3-7-sonnet-latest');
  }
  if (!codexModels?.some(m => m.id === 'gpt-5-codex')) {
    throw new Error('Codex catalog missing gpt-5-codex');
  }
  if (codexModels?.some(m => m.id === 'gpt-4.5-preview')) {
    throw new Error('Codex catalog still contains deprecated gpt-4.5-preview');
  }
  console.log('✓ Model catalogs verified active and pruned of deprecated models.');

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
    model: 'claude-3-7-sonnet-latest',
  });
  claudeAdapter.send('Hello Claude', 'workspace-write');

  // Wait briefly for stream processing
  await new Promise(r => setTimeout(r, 100));
  claudeAdapter.stop();

  if (claudeSpecReceived?.model !== 'claude-3-7-sonnet-latest') {
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
    model: 'gpt-5-codex',
  });
  codexAdapter.send('Hello Codex', 'workspace-write');

  await new Promise(r => setTimeout(r, 100));
  codexAdapter.stop();

  if (codexSpecReceived?.model !== 'gpt-5-codex') {
    throw new Error(`Codex model not forwarded: received ${codexSpecReceived?.model}`);
  }
  if (!codexUsageReceived) {
    throw new Error('Codex usage frame not received');
  }
  console.log('✓ Codex SDK: model forwarded and honored, usage captured.');

  // 4. Test Invalid Model Error Frame
  console.log('[4/4] Testing Invalid Model Error Frame Surfacing...');
  let caughtErrorMsg = '';
  const invalidModelHarness: HarnessAdapter = {
    vendor: 'codex',
    async start(spec: StartSpec): Promise<SessionHandle> {
      throw new Error(formatModelRejectionError('codex-cli', spec.model || 'unknown', 'model_not_found'));
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

  console.log('\n=== All Cross-Engine Chat Smoke Tests Passed Successfully ===');
}

function viFn(): any {
  return async () => ({} as any);
}

runSmokeTests().catch(err => {
  console.error('Smoke tests failed:', err);
  process.exit(1);
});
