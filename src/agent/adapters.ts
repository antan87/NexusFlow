import { ProviderRegistry } from './ProviderRegistry.js';
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

ProviderRegistry.register({
  id: 'claude-cli',
  name: 'Claude Code (Local CLI)',
  icon: 'Terminal',
  isConfigured: () => true, // Assume the CLI is installed for now
  getStatusMessage: () => undefined, // No API key required!
  createInstance: () => new ClaudeCliAdapter()
});

ProviderRegistry.register({
  id: 'antigravity-cli',
  name: 'Antigravity (Local CLI)',
  icon: 'Terminal',
  isConfigured: () => true, // Assume the CLI is installed for now
  getStatusMessage: () => undefined, // No API key required!
  createInstance: () => new AntigravityCliAdapter()
});

export { ProviderRegistry };
