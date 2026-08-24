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
    expect(codexModels).toHaveLength(4);
    expect(codexModels.some((m) => m.id === '')).toBe(true); // Automatic option
    expect(codexModels.some((m) => m.id === 'gpt-5.6-sol')).toBe(true);
    expect(codexModels.some((m) => m.id === 'gpt-5.6-terra')).toBe(true);
    expect(codexModels.some((m) => m.id === 'gpt-5.6-luna')).toBe(true);
    expect(getAvailableModels('codex-sdk')).toBe(codexModels);

    // Superseded/deprecated models must not linger in the user-facing catalog.
    expect(codexModels.some((m) => m.id === 'gpt-5-codex')).toBe(false);
    expect(codexModels.some((m) => m.id === 'gpt-4.5-preview')).toBe(false);
    expect(codexModels.some((m) => m.id === 'o1-preview')).toBe(false);
  });

  it('validates model IDs against provider catalogs', () => {
    expect(isValidModelForProvider('claude-cli', '')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'sonnet')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'non-existent-model')).toBe(false);

    expect(isValidModelForProvider('codex-cli', '')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-5.6-sol')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-4.5-preview')).toBe(false);
  });

  it('formats model rejection errors with clear user remediation guidance', () => {
    const errorMsg = formatModelRejectionError('codex-cli', 'invalid-model-x', 'model_not_found');
    expect(errorMsg).toContain("Model 'invalid-model-x' was rejected by codex-cli");
    expect(errorMsg).toContain('(model_not_found)');
    expect(errorMsg).toContain('Please select a valid model in chat settings or use Automatic.');
  });
});
