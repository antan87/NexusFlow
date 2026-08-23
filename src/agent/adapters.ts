import { ProviderRegistry, type ProviderSetupHelp } from './ProviderRegistry.js';
import {
  type CliStatus,
  detectAntigravityCliStatus,
  detectClaudeCliStatus,
  detectCodexCliStatus,
  detectCopilotCliStatus,
} from './cliAvailability.js';
import { NativeClaudeAgent } from './NativeClaudeAgent.js';
import { NativeAgent } from './NativeAgent.js';
import { NativeGoogleAgent } from './NativeGoogleAgent.js';
import { ClaudeCliAdapter } from './ClaudeCliAdapter.js';
import { AntigravityCliAdapter } from './AntigravityCliAdapter.js';
import { CodexCliAdapter } from './CodexCliAdapter.js';
import { CopilotAcpAdapter } from './CopilotAcpAdapter.js';
import { ClaudeSdkAdapter } from './ClaudeSdkAdapter.js';
import { CodexSdkAdapter } from './CodexSdkAdapter.js';

ProviderRegistry.register({
  id: 'claude-native',
  name: 'Claude',
  icon: 'Bot',
  accessLabel: 'Read-only tools',
  capabilities: { transport: 'native-api', sessionIdentity: 'none', workspaceAccess: 'read-only' },
  isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  getStatusMessage: () => process.env.ANTHROPIC_API_KEY ? undefined : 'Anthropic API key is not configured in ANTHROPIC_API_KEY.',
  createInstance: () => new NativeClaudeAgent()
});

ProviderRegistry.register({
  id: 'openai-native',
  name: 'OpenAI',
  icon: 'Sparkles',
  accessLabel: 'Read-only tools',
  capabilities: { transport: 'native-api', sessionIdentity: 'none', workspaceAccess: 'read-only' },
  isConfigured: () => !!process.env.OPENAI_API_KEY,
  getStatusMessage: () => process.env.OPENAI_API_KEY ? undefined : 'OpenAI API key is not configured in OPENAI_API_KEY.',
  createInstance: () => new NativeAgent()
});

ProviderRegistry.register({
  id: 'google-native',
  name: 'Google Gemini',
  icon: 'Sparkles',
  accessLabel: 'Read-only tools',
  capabilities: { transport: 'native-api', sessionIdentity: 'none', workspaceAccess: 'read-only' },
  isConfigured: () => !!process.env.GEMINI_API_KEY,
  getStatusMessage: () => process.env.GEMINI_API_KEY ? undefined : 'Google API key is not configured in GEMINI_API_KEY.',
  createInstance: () => new NativeGoogleAgent()
});

/**
 * Wraps a synchronous detector in a short-lived cache.
 *
 * `isConfigured()` and `getStatusMessage()` are separate calls on the same
 * provider, so listing statuses ran every detector twice. CLI detectors walk
 * PATH and may spawn a bounded provider-owned status command, so duplicate
 * probes materially slow the request.
 *
 * A few seconds is the right window: long enough to collapse the duplicate calls
 * within one request, short enough that installing a CLI or signing in is
 * noticed almost immediately rather than needing a restart.
 */
export type CachedStatusReader<T> = (() => T) & { invalidate(): void };

export function cachedStatus<T>(detect: () => T, ttlMs = 5_000): CachedStatusReader<T> {
  // Freshness is tracked with a flag, not by testing the value: keying on
  // `value === undefined` would make a detector that legitimately returns
  // undefined re-run on every read, which is the case this exists to avoid.
  let cached: { value: T } | null = null;
  let readAt = 0;

  const read = (() => {
    const now = Date.now();
    if (!cached || now - readAt >= ttlMs) {
      const value = detect();
      // Age the cache from completion. A detector that consumes its whole
      // timeout must still be reused by the other fields in this status read.
      cached = { value };
      readAt = Date.now();
    }
    return cached.value;
  }) as CachedStatusReader<T>;
  read.invalidate = () => {
    cached = null;
    readAt = 0;
  };
  return read;
}

function setupHelp(status: CliStatus): ProviderSetupHelp | undefined {
  if (!status.setupIssue || !status.recoveryCommand || !status.recoveryLabel) return undefined;
  return {
    setupIssue: status.setupIssue,
    recoveryCommand: status.recoveryCommand,
    recoveryLabel: status.recoveryLabel,
  };
}

// The CLI providers need no API key, but "installed" is not the same as "usable":
// a CLI can be on PATH and still have no credentials a spawned process can use.
// Reporting that up front beats letting the first turn fail with whatever the CLI
// happened to print.
const claudeCliStatus = cachedStatus(() => detectClaudeCliStatus());
const antigravityCliStatus = cachedStatus(() => detectAntigravityCliStatus());
const codexCliStatus = cachedStatus(() => detectCodexCliStatus());
const copilotCliStatus = cachedStatus(() => detectCopilotCliStatus());

ProviderRegistry.register({
  id: 'claude-cli',
  name: 'Claude Code (Local CLI)',
  icon: 'Terminal',
  accessLabel: 'Harness-managed access',
  executionProfiles: [
    { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
    {
      id: 'workspace-write',
      label: 'Edit workspace',
      description: 'Auto-accepts in-workspace file edits and common filesystem actions; other approval-requiring commands are unavailable in embedded chat.',
    },
  ],
  defaultExecutionProfile: 'review',
  capabilities: {
    transport: 'cli-print',
    sessionIdentity: 'client-assigned',
    workspaceAccess: 'harness-managed',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => claudeCliStatus().usable,
  getStatusMessage: () => claudeCliStatus().message,
  getSetupHelp: () => setupHelp(claudeCliStatus()),
  invalidateStatus: () => claudeCliStatus.invalidate(),
  createInstance: () => new ClaudeCliAdapter()
});

ProviderRegistry.register({
  id: 'antigravity-cli',
  name: 'Antigravity (Local CLI)',
  icon: 'Terminal',
  accessLabel: 'Harness-managed access',
  executionProfiles: [
    { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
    {
      id: 'workspace-write',
      label: 'Edit workspace',
      description: 'Auto-accepts in-workspace file edits and common filesystem actions.',
    },
  ],
  defaultExecutionProfile: 'review',
  capabilities: {
    transport: 'cli-print',
    // agy assigns ids for new conversations; --conversation only resumes an
    // id that already exists in the provider's workspace-scoped history.
    sessionIdentity: 'provider-assigned',
    workspaceAccess: 'harness-managed',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => antigravityCliStatus().usable,
  getStatusMessage: () => antigravityCliStatus().message,
  getSetupHelp: () => setupHelp(antigravityCliStatus()),
  invalidateStatus: () => antigravityCliStatus.invalidate(),
  createInstance: () => new AntigravityCliAdapter()
});

ProviderRegistry.register({
  id: 'codex-cli',
  name: 'Codex (Local CLI)',
  icon: 'Terminal',
  accessLabel: 'Workspace write',
  executionProfiles: [
    { id: 'review', label: 'Review only', description: 'Read-only sandbox; escalation is denied.' },
    {
      id: 'workspace-write',
      label: 'Edit workspace',
      description: 'Workspace-write sandbox; command network and escalation outside the sandbox are denied.',
    },
  ],
  defaultExecutionProfile: 'review',
  capabilities: {
    transport: 'cli-print',
    sessionIdentity: 'provider-assigned',
    workspaceAccess: 'workspace-write',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => codexCliStatus().usable,
  getStatusMessage: () => codexCliStatus().message,
  getSetupHelp: () => setupHelp(codexCliStatus()),
  invalidateStatus: () => codexCliStatus.invalidate(),
  createInstance: () => new CodexCliAdapter()
});

ProviderRegistry.register({
  id: 'copilot-cli',
  name: 'GitHub Copilot (Local CLI)',
  icon: 'Terminal',
  accessLabel: 'Read-only workspace tools',
  capabilities: {
    transport: 'acp',
    sessionIdentity: 'provider-assigned',
    workspaceAccess: 'read-only',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => copilotCliStatus().usable,
  getStatusMessage: () => copilotCliStatus().message,
  createInstance: () => new CopilotAcpAdapter()
});

const claudeSdkStatus = cachedStatus(() => {
  const hasCredential = Boolean(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_CODE_OAUTH_TOKEN ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
  if (hasCredential) return { usable: true };
  return claudeCliStatus();
});

const codexSdkStatus = cachedStatus(() => {
  const hasCredential = Boolean(
    process.env.OPENAI_API_KEY ||
    process.env.CODEX_API_KEY
  );
  if (hasCredential) return { usable: true };
  return codexCliStatus();
});

ProviderRegistry.register({
  id: 'claude-sdk',
  name: 'Claude Code (First-Party SDK)',
  icon: 'Terminal',
  accessLabel: 'Harness-managed access',
  executionProfiles: [
    { id: 'review', label: 'Review only', description: 'Reads and plans; no source edits.' },
    {
      id: 'workspace-write',
      label: 'Edit workspace',
      description: 'Auto-accepts in-workspace file edits and common filesystem actions; other approval-requiring commands are unavailable in embedded chat.',
    },
  ],
  defaultExecutionProfile: 'review',
  capabilities: {
    transport: 'sdk',
    sessionIdentity: 'client-assigned',
    workspaceAccess: 'harness-managed',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => claudeSdkStatus().usable,
  getStatusMessage: () => claudeSdkStatus().message,
  getSetupHelp: () => setupHelp(claudeSdkStatus()),
  invalidateStatus: () => {
    claudeSdkStatus.invalidate();
    claudeCliStatus.invalidate();
  },
  createInstance: () => new ClaudeSdkAdapter()
});

ProviderRegistry.register({
  id: 'codex-sdk',
  name: 'Codex (First-Party SDK)',
  icon: 'Terminal',
  accessLabel: 'Workspace write',
  executionProfiles: [
    { id: 'review', label: 'Review only', description: 'Read-only sandbox; escalation is denied.' },
    {
      id: 'workspace-write',
      label: 'Edit workspace',
      description: 'Workspace-write sandbox (network/escalation denied). Approvals are configured at the Codex engine level.',
    },
  ],
  defaultExecutionProfile: 'review',
  capabilities: {
    transport: 'sdk',
    sessionIdentity: 'provider-assigned',
    workspaceAccess: 'workspace-write',
    sessionIdFormat: 'uuid',
  },
  isConfigured: () => codexSdkStatus().usable,
  getStatusMessage: () => codexSdkStatus().message,
  getSetupHelp: () => setupHelp(codexSdkStatus()),
  invalidateStatus: () => {
    codexSdkStatus.invalidate();
    codexCliStatus.invalidate();
  },
  createInstance: () => new CodexSdkAdapter()
});

export { ProviderRegistry };
