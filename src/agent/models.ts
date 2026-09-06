import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

export interface ModelOption {
  id: string;
  label: string;
  description: string;
}

export interface ReasoningEffortOption {
  id: string;
  label: string;
  description: string;
}

export const REASONING_EFFORT_OPTIONS: readonly ReasoningEffortOption[] = [
  { id: '', label: 'Auto Effort', description: 'Use the model or provider default reasoning effort.' },
  { id: 'low', label: 'Low Effort', description: 'Fast responses with lightweight reasoning.' },
  { id: 'medium', label: 'Medium Effort', description: 'Balanced reasoning depth and latency.' },
  { id: 'high', label: 'High Effort', description: 'Deep multi-step reasoning and thorough verification.' },
  { id: 'max', label: 'Max Effort', description: 'Maximum thinking budget for complex coding and architecture.' },
] as const;

export const CLAUDE_MODELS: readonly ModelOption[] = [
  { id: '', label: 'Automatic', description: 'Use the default selected by Claude Code for this account and deployment.' },
  { id: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet', description: 'Hybrid reasoning and frontier coding capability.' },
  { id: 'sonnet', label: 'Sonnet (Latest)', description: 'Fast, high-quality everyday coding and refactoring.' },
  { id: 'opus', label: 'Opus (Latest)', description: 'Deep reasoning, architecture design, and complex problem solving.' },
  { id: 'haiku', label: 'Haiku (Latest)', description: 'Ultra-fast, lightweight tasks and quick edits.' },
  { id: 'fable', label: 'Fable', description: 'Experimental specialized coding model.' },
] as const satisfies readonly ModelOption[];

export const CODEX_MODELS: readonly ModelOption[] = [
  { id: '', label: 'Automatic', description: 'Use the model configured by the Codex account or local harness.' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Frontier capability for complex professional coding and reasoning.' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Balance intelligence, latency, and cost.' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Cost-efficient model for high-volume and focused tasks.' },
  { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Frontier model for complex coding and real-world development.' },
  { id: 'o3-mini', label: 'o3-mini', description: 'High-speed reasoning model specialized for math and coding.' },
  { id: 'o1', label: 'o1', description: 'Deep reasoning model for difficult multi-step planning.' },
  { id: 'gpt-4o', label: 'GPT-4o', description: 'Omni model for fast, versatile general coding.' },
] as const satisfies readonly ModelOption[];

export const ANTIGRAVITY_MODELS: readonly ModelOption[] = [
  { id: '', label: 'Automatic', description: 'Use the default model configured in Google Antigravity.' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Latest frontier reasoning speed and advanced agentic coding capability.' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: 'Frontier reasoning speed and hybrid thinking capability.' },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', description: 'Comprehensive multimodal code analysis and synthesis.' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Anthropic Sonnet model running inside Antigravity engine.' },
  { id: 'claude-opus-4-6-thinking', label: 'Claude Opus 4.6', description: 'Deep reasoning Claude Opus model with extended thinking.' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Advanced reasoning and multimodal coding capabilities.' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast, lightweight model for rapid iteration.' },
  { id: 'antigravity-preview-05-2026', label: 'Antigravity Preview', description: 'Preview model with experimental agentic capabilities.' },
] as const satisfies readonly ModelOption[];

export const PROVIDER_MODELS: Record<string, readonly ModelOption[]> = {
  'claude-cli': CLAUDE_MODELS,
  'claude-sdk': CLAUDE_MODELS,
  'codex-cli': CODEX_MODELS,
  'codex-sdk': CODEX_MODELS,
  'antigravity-cli': ANTIGRAVITY_MODELS,
};

export function parseAgyModels(rawOutput: string): ModelOption[] {
  const lines = rawOutput.split('\n').map((l) => l.trim()).filter(Boolean);
  const models: ModelOption[] = [
    { id: '', label: 'Automatic', description: 'Use the default model configured in Google Antigravity.' },
  ];
  const seen = new Set<string>(['']);

  for (const line of lines) {
    if (line.includes('Fetching') || line.startsWith('Usage')) continue;
    const parts = line.split(/\t+|\s{2,}/);
    if (parts.length >= 1) {
      const id = parts[0].trim();
      const label = (parts[1] || id).trim();

      // Register base model if it has an effort suffix (e.g. gemini-3.8-flash)
      if (id.endsWith('-high') || id.endsWith('-medium') || id.endsWith('-low')) {
        const baseId = id.replace(/-(high|medium|low)$/, '');
        const baseLabel = label.replace(/\s*\((High|Medium|Low)\)$/, '');
        if (baseId && !seen.has(baseId)) {
          seen.add(baseId);
          models.push({
            id: baseId,
            label: baseLabel,
            description: `Active base model dynamically reported by Antigravity CLI.`,
          });
        }
      }

      if (id && !seen.has(id)) {
        seen.add(id);
        models.push({
          id,
          label,
          description: `Active model dynamically reported by Antigravity CLI.`,
        });
      }
    }
  }
  return models;
}

export function readCodexModelsCache(cacheDir?: string): ModelOption[] {
  try {
    const p = path.join(cacheDir ?? path.join(os.homedir(), '.codex'), 'models_cache.json');
    if (!fs.existsSync(p)) return [];
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(data.models) || data.models.length === 0) return [];

    const models: ModelOption[] = [
      { id: '', label: 'Automatic', description: 'Use the model configured by the Codex account or local harness.' },
    ];
    const seen = new Set<string>(['']);

    for (const m of data.models) {
      const id = m.slug || m.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        models.push({
          id,
          label: m.display_name || m.name || m.slug || m.id,
          description: m.description || 'Active model from ~/.codex/models_cache.json',
        });
      }
    }
    return models;
  } catch {
    return [];
  }
}

interface CachedModels {
  models: readonly ModelOption[];
  timestamp: number;
}
let cachedAgyModels: CachedModels | null = null;
let cachedCodexModels: CachedModels | null = null;
let cachedClaudeModels: CachedModels | null = null;
let isRefreshingClaude = false;
let isRefreshingAgy = false;
const CACHE_TTL_MS = 60_000;

function refreshAgyModelsInBackground(): void {
  if (isRefreshingAgy) return;
  isRefreshingAgy = true;
  import('node:child_process').then(({ exec }) => {
    exec('agy models', { timeout: 5000, encoding: 'utf8' }, (err, stdout) => {
      isRefreshingAgy = false;
      if (err || !stdout) return;
      const discovered = parseAgyModels(stdout);
      if (discovered.length > 1) {
        const seen = new Set(discovered.map(m => m.id));
        for (const base of ANTIGRAVITY_MODELS) {
          if (!seen.has(base.id)) {
            discovered.push(base);
            seen.add(base.id);
          }
        }
        cachedAgyModels = { models: discovered, timestamp: Date.now() };
      }
    });
  }).catch(() => {
    isRefreshingAgy = false;
  });
}

export async function fetchAnthropicModelsOnline(apiKey?: string): Promise<ModelOption[]> {
  const key = apiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key) return [];
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return [];
    const json = await res.json() as { data?: Array<{ id: string; display_name?: string }> };
    if (Array.isArray(json.data) && json.data.length > 0) {
      const models: ModelOption[] = [
        { id: '', label: 'Automatic', description: 'Use the default selected by Claude Code for this account and deployment.' },
      ];
      const seen = new Set<string>(['']);
      for (const m of json.data) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          models.push({
            id: m.id,
            label: m.display_name || m.id,
            description: 'Active Claude model dynamically discovered from Anthropic API.',
          });
        }
      }
      return models;
    }
  } catch {
    // Non-fatal
  }
  return [];
}

export function invalidateModelsCache(providerId?: string): void {
  if (!providerId || providerId === 'antigravity-cli') cachedAgyModels = null;
  if (!providerId || providerId.startsWith('codex')) cachedCodexModels = null;
  if (!providerId || providerId.startsWith('claude')) cachedClaudeModels = null;
}

export function getAvailableModels(providerId: string): readonly ModelOption[] {
  const now = Date.now();

  if (providerId === 'antigravity-cli') {
    if (cachedAgyModels && now - cachedAgyModels.timestamp < CACHE_TTL_MS) {
      return cachedAgyModels.models;
    }
    if (cachedAgyModels) {
      refreshAgyModelsInBackground();
      return cachedAgyModels.models;
    }
    try {
      const raw = execSync('agy models', {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const discovered = parseAgyModels(raw);
      if (discovered.length > 1) {
        const seen = new Set(discovered.map(m => m.id));
        for (const base of ANTIGRAVITY_MODELS) {
          if (!seen.has(base.id)) {
            discovered.push(base);
            seen.add(base.id);
          }
        }
        cachedAgyModels = { models: discovered, timestamp: now };
        return discovered;
      }
    } catch {
      refreshAgyModelsInBackground();
    }
    return ANTIGRAVITY_MODELS;
  }

  if (providerId === 'codex-cli' || providerId === 'codex-sdk') {
    if (cachedCodexModels && now - cachedCodexModels.timestamp < CACHE_TTL_MS) {
      return cachedCodexModels.models;
    }
    try {
      const discovered = readCodexModelsCache();
      if (discovered.length > 1) {
        const seen = new Set(discovered.map(m => m.id));
        for (const base of CODEX_MODELS) {
          if (!seen.has(base.id)) {
            discovered.push(base);
            seen.add(base.id);
          }
        }
        cachedCodexModels = { models: discovered, timestamp: now };
        return discovered;
      }
    } catch {
      // cache missing or corrupted -> fallback to baseline catalog
    }
    return CODEX_MODELS;
  }

  if (providerId === 'claude-cli' || providerId === 'claude-sdk') {
    if (cachedClaudeModels && now - cachedClaudeModels.timestamp < CACHE_TTL_MS) {
      return cachedClaudeModels.models;
    }
    const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    if (hasKey && !isRefreshingClaude) {
      isRefreshingClaude = true;
      fetchAnthropicModelsOnline()
        .then((models) => {
          if (models.length > 1) {
            const seen = new Set(models.map(m => m.id));
            for (const base of CLAUDE_MODELS) {
              if (!seen.has(base.id)) {
                models.push(base);
                seen.add(base.id);
              }
            }
            cachedClaudeModels = { models, timestamp: Date.now() };
          }
        })
        .finally(() => {
          isRefreshingClaude = false;
        });
    }
    return cachedClaudeModels?.models ?? CLAUDE_MODELS;
  }

  return PROVIDER_MODELS[providerId] ?? [];
}

export function isValidModelForProvider(providerId: string, modelId: string): boolean {
  if (!modelId) return true; // Default / empty is always valid
  const models = getAvailableModels(providerId);
  if (!models || models.length === 0) return true; // Open catalog for custom/unregistered providers
  return models.some((m) => m.id === modelId);
}

export function formatModelRejectionError(providerId: string, model: string, details?: string): string {
  const detailStr = details ? ` (${details})` : '';
  return `Model '${model}' was rejected by ${providerId}${detailStr}. Please select a valid model in chat settings or use Automatic.`;
}
