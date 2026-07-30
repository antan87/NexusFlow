import { ProviderRegistry } from './ProviderRegistry.js';
import { detectAntigravityCliStatus, detectClaudeCliStatus } from './cliAvailability.js';
import { NativeClaudeAgent } from './NativeClaudeAgent.js';
import { NativeAgent } from './NativeAgent.js';
import { NativeGoogleAgent } from './NativeGoogleAgent.js';
import { ClaudeCliAdapter } from './ClaudeCliAdapter.js';
import { AntigravityCliAdapter } from './AntigravityCliAdapter.js';

ProviderRegistry.register({
  id: 'claude-native',
  name: 'Claude',
  icon: 'Bot',
  isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  getStatusMessage: () => process.env.ANTHROPIC_API_KEY ? undefined : 'Anthropic API key is not configured in ANTHROPIC_API_KEY.',
  createInstance: () => new NativeClaudeAgent()
});

ProviderRegistry.register({
  id: 'openai-native',
  name: 'OpenAI',
  icon: 'Sparkles',
  isConfigured: () => !!process.env.OPENAI_API_KEY,
  getStatusMessage: () => process.env.OPENAI_API_KEY ? undefined : 'OpenAI API key is not configured in OPENAI_API_KEY.',
  createInstance: () => new NativeAgent()
});

ProviderRegistry.register({
  id: 'google-native',
  name: 'Google Gemini',
  icon: 'Sparkles',
  isConfigured: () => !!process.env.GEMINI_API_KEY,
  getStatusMessage: () => process.env.GEMINI_API_KEY ? undefined : 'Google API key is not configured in GEMINI_API_KEY.',
  createInstance: () => new NativeGoogleAgent()
});

/**
 * Wraps a synchronous detector in a short-lived cache.
 *
 * `isConfigured()` and `getStatusMessage()` are separate calls on the same
 * provider, so listing statuses ran every detector twice — and each one walks
 * PATH with a `statSync` per directory per PATHEXT entry, then reads a
 * credentials file. `getStatuses()` over both CLI providers meant four full
 * scans per HTTP status request.
 *
 * A few seconds is the right window: long enough to collapse the duplicate calls
 * within one request, short enough that installing a CLI or signing in is
 * noticed almost immediately rather than needing a restart.
 */
export function cachedStatus<T>(detect: () => T, ttlMs = 5_000): () => T {
  // Freshness is tracked with a flag, not by testing the value: keying on
  // `value === undefined` would make a detector that legitimately returns
  // undefined re-run on every read, which is the case this exists to avoid.
  let cached: { value: T } | null = null;
  let readAt = 0;

  return () => {
    const now = Date.now();
    if (!cached || now - readAt >= ttlMs) {
      cached = { value: detect() };
      readAt = now;
    }
    return cached.value;
  };
}

// The CLI providers need no API key, but "installed" is not the same as "usable":
// a CLI can be on PATH and still have no credentials a spawned process can use.
// Reporting that up front beats letting the first turn fail with whatever the CLI
// happened to print.
const claudeCliStatus = cachedStatus(() => detectClaudeCliStatus());
const antigravityCliStatus = cachedStatus(() => detectAntigravityCliStatus());

ProviderRegistry.register({
  id: 'claude-cli',
  name: 'Claude Code (Local CLI)',
  icon: 'Terminal',
  isConfigured: () => claudeCliStatus().usable,
  getStatusMessage: () => claudeCliStatus().message,
  createInstance: () => new ClaudeCliAdapter()
});

ProviderRegistry.register({
  id: 'antigravity-cli',
  name: 'Antigravity (Local CLI)',
  icon: 'Terminal',
  isConfigured: () => antigravityCliStatus().usable,
  getStatusMessage: () => antigravityCliStatus().message,
  createInstance: () => new AntigravityCliAdapter()
});

export { ProviderRegistry };
