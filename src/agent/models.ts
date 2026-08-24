export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  'claude-cli': [
    { id: '', label: 'Default', description: 'Harness default (Claude 3.7 Sonnet)' },
    { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet', description: 'Flagship hybrid reasoning and coding model' },
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'High-speed coding intelligence' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Fastest turn completion and lightweight edits' },
    { id: 'claude-3-opus-latest', label: 'Claude 3 Opus', description: 'Deep context reasoning and architecture planning' },
  ],
  'codex-cli': [
    { id: '', label: 'Default', description: 'Harness default (gpt-5-codex / o3-mini)' },
    { id: 'gpt-5-codex', label: 'GPT-5 Codex', description: 'Next-generation frontier coding and agentic execution' },
    { id: 'gpt-5', label: 'GPT-5', description: 'Flagship multimodal reasoning and general intelligence' },
    { id: 'o3', label: 'o3', description: 'Deep STEM and architectural reasoning model' },
    { id: 'o3-mini', label: 'o3-mini', description: 'High-speed coding and mathematical reasoning' },
    { id: 'gpt-4o', label: 'GPT-4o', description: 'Omni multi-modal fast model' },
  ],
};

export function getAvailableModels(providerId: string): ModelOption[] {
  return PROVIDER_MODELS[providerId] ?? [];
}

export function isValidModelForProvider(providerId: string, modelId: string): boolean {
  if (!modelId) return true; // Default / empty is always valid
  const models = PROVIDER_MODELS[providerId];
  if (!models) return true; // Open catalog for custom/unregistered providers
  return models.some((m) => m.id === modelId);
}

export function formatModelRejectionError(providerId: string, model: string, details?: string): string {
  const detailStr = details ? ` (${details})` : '';
  return `Model '${model}' was rejected by ${providerId}${detailStr}. Please select a valid model in chat settings or use the default model.`;
}
