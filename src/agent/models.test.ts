import { describe, it, expect } from 'vitest';
import {
  getAvailableModels,
  isValidModelForProvider,
  formatModelRejectionError,
} from './models.js';

describe('models catalog and validation', () => {
  it('defines current model options for Claude and Codex', () => {
    const claudeModels = getAvailableModels('claude-cli');
    expect(claudeModels.length).toBeGreaterThan(3);
    expect(claudeModels.some((m) => m.id === '')).toBe(true); // Automatic option
    expect(claudeModels.some((m) => m.id === 'fable')).toBe(true);
    expect(claudeModels.some((m) => m.id === 'opus')).toBe(true);
    expect(claudeModels.some((m) => m.id === 'sonnet')).toBe(true);
    expect(claudeModels.some((m) => m.id === 'haiku')).toBe(true);
    expect(getAvailableModels('claude-sdk')).toBe(claudeModels);

    const codexModels = getAvailableModels('codex-cli');
    expect(codexModels.length).toBeGreaterThanOrEqual(4);
    expect(codexModels.some((m) => m.id === '')).toBe(true); // Automatic option
    expect(codexModels.some((m) => m.id === 'gpt-5.6-sol')).toBe(true);
    expect(codexModels.some((m) => m.id === 'gpt-5.6-terra')).toBe(true);
    expect(codexModels.some((m) => m.id === 'gpt-5.6-luna')).toBe(true);
    expect(getAvailableModels('codex-sdk')).toBe(codexModels);

    // Superseded/deprecated models must not linger in the user-facing catalog.
    expect(codexModels.some((m) => m.id === 'gpt-5-codex')).toBe(false);
    expect(codexModels.some((m) => m.id === 'gpt-4.5-preview')).toBe(false);
    expect(codexModels.some((m) => m.id === 'o1-preview')).toBe(false);
    const antigravityModels = getAvailableModels('antigravity-cli');
    expect(antigravityModels.length).toBeGreaterThanOrEqual(4);
    expect(antigravityModels.some((m) => m.id === '')).toBe(true); // Automatic option
    expect(antigravityModels.some((m) => m.id === 'gemini-2.5-pro')).toBe(true);
    expect(antigravityModels.some((m) => m.id === 'gemini-2.5-flash')).toBe(true);
    expect(antigravityModels.some((m) => m.id === 'antigravity-preview-05-2026')).toBe(true);
  });

  it('validates model IDs against provider catalogs', () => {
    expect(isValidModelForProvider('claude-cli', '')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'sonnet')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'non-existent-model')).toBe(false);

    expect(isValidModelForProvider('codex-cli', '')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-5.6-sol')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-4.5-preview')).toBe(false);

    expect(isValidModelForProvider('antigravity-cli', '')).toBe(true);
    expect(isValidModelForProvider('antigravity-cli', 'gemini-2.5-pro')).toBe(true);
    expect(isValidModelForProvider('antigravity-cli', 'gemini-2.5-flash')).toBe(true);
    expect(isValidModelForProvider('antigravity-cli', 'antigravity-preview-05-2026')).toBe(true);
    expect(isValidModelForProvider('antigravity-cli', 'gemini-3.8-flash')).toBe(true);
    expect(isValidModelForProvider('antigravity-cli', 'unknown-gemini-model')).toBe(false);
  });

  it('formats model rejection errors with clear user remediation guidance', () => {
    const errorMsg = formatModelRejectionError('codex-cli', 'invalid-model-x', 'model_not_found');
    expect(errorMsg).toContain("Model 'invalid-model-x' was rejected by codex-cli");
    expect(errorMsg).toContain('(model_not_found)');
    expect(errorMsg).toContain('Please select a valid model in chat settings or use Automatic.');
  });

  it('parses dynamic agy models output correctly', async () => {
    const { parseAgyModels } = await import('./models.js');
    const mockOutput = `
⠋ Fetching available models...
gemini-3.8-flash-high\tGemini 3.8 Flash (High)
gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)
gemini-3.8-flash-low\tGemini 3.8 Flash (Low)
gemini-3.7-flash-high\tGemini 3.7 Flash (High)
claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)
    `;
    const parsed = parseAgyModels(mockOutput);
    expect(parsed.some(m => m.id === '')).toBe(true);
    expect(parsed.some(m => m.id === 'gemini-3.8-flash')).toBe(true);
    expect(parsed.some(m => m.id === 'gemini-3.8-flash-high')).toBe(true);
    expect(parsed.some(m => m.id === 'gemini-3.7-flash')).toBe(true);
    expect(parsed.some(m => m.id === 'claude-sonnet-4-6')).toBe(true);
  });

  it('reads codex models cache safely', async () => {
    const { readCodexModelsCache } = await import('./models.js');
    const missing = readCodexModelsCache('/non/existent/path');
    expect(missing).toEqual([]);
  });

  it('handles fetchAnthropicModelsOnline gracefully when unauthenticated', async () => {
    const { fetchAnthropicModelsOnline } = await import('./models.js');
    const models = await fetchAnthropicModelsOnline('');
    expect(models).toEqual([]);
  });
});
