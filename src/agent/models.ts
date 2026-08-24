export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

const CLAUDE_MODELS = [
  { id: '', label: 'Automatic', description: 'Use the default selected by Claude Code for this account and deployment.' },
  { id: 'fable', label: 'Fable', description: 'Use the latest Fable model available to this Claude Code account.' },
  { id: 'opus', label: 'Opus', description: 'Use the latest Opus model for complex reasoning and architecture work.' },
  { id: 'sonnet', label: 'Sonnet', description: 'Use the latest Sonnet model for everyday coding tasks.' },
  { id: 'haiku', label: 'Haiku', description: 'Use the latest Haiku model for fast, lightweight tasks.' },
] as const satisfies readonly ModelOption[];

const CODEX_MODELS = [
  { id: '', label: 'Automatic', description: 'Use the model configured by the Codex account or local harness.' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Frontier capability for complex professional coding and reasoning.' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Balance intelligence, latency, and cost.' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Cost-efficient model for high-volume and focused tasks.' },
] as const satisfies readonly ModelOption[];

export const PROVIDER_MODELS: Record<string, readonly ModelOption[]> = {
  'claude-cli': CLAUDE_MODELS,
  'claude-sdk': CLAUDE_MODELS,
  'codex-cli': CODEX_MODELS,
  'codex-sdk': CODEX_MODELS,
};

export function getAvailableModels(providerId: string): readonly ModelOption[] {
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
  return `Model '${model}' was rejected by ${providerId}${detailStr}. Please select a valid model in chat settings or use Automatic.`;
}
