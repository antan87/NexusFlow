import { describe, it, expect } from 'vitest';
import {
  PROVIDER_MODELS,
  getAvailableModels,
  isValidModelForProvider,
  formatModelRejectionError,
} from './models.js';

describe('models catalog and validation', () => {
  it('defines valid non-empty model options for Claude and Codex', () => {
    const claudeModels = getAvailableModels('claude-cli');
    expect(claudeModels.length).toBeGreaterThan(3);
    expect(claudeModels.some((m) => m.id === '')).toBe(true); // Default option
    expect(claudeModels.some((m) => m.id === 'claude-3-7-sonnet-latest')).toBe(true);
    expect(claudeModels.some((m) => m.id === 'claude-3-5-sonnet-latest')).toBe(true);
    expect(claudeModels.some((m) => m.id === 'claude-3-5-haiku-latest')).toBe(true);

    const codexModels = getAvailableModels('codex-cli');
    expect(codexModels.length).toBeGreaterThan(3);
    expect(codexModels.some((m) => m.id === '')).toBe(true); // Default option
    expect(codexModels.some((m) => m.id === 'gpt-5-codex')).toBe(true);
    expect(codexModels.some((m) => m.id === 'o3-mini')).toBe(true);
    expect(codexModels.some((m) => m.id === 'gpt-4o')).toBe(true);

    // Verify deprecated/dead models are NOT in the catalog
    expect(codexModels.some((m) => m.id === 'gpt-4.5-preview')).toBe(false);
    expect(codexModels.some((m) => m.id === 'o1-preview')).toBe(false);
  });

  it('validates model IDs against provider catalogs', () => {
    expect(isValidModelForProvider('claude-cli', '')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'claude-3-7-sonnet-latest')).toBe(true);
    expect(isValidModelForProvider('claude-cli', 'non-existent-model')).toBe(false);

    expect(isValidModelForProvider('codex-cli', '')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-5-codex')).toBe(true);
    expect(isValidModelForProvider('codex-cli', 'gpt-4.5-preview')).toBe(false);
  });

  it('formats model rejection errors with clear user remediation guidance', () => {
    const errorMsg = formatModelRejectionError('codex-cli', 'invalid-model-x', 'model_not_found');
    expect(errorMsg).toContain("Model 'invalid-model-x' was rejected by codex-cli");
    expect(errorMsg).toContain('(model_not_found)');
    expect(errorMsg).toContain('Please select a valid model in chat settings or use the default model.');
  });
});
