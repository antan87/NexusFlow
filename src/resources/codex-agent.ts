import { parse, stringify } from 'smol-toml';

import type { CodexAgentItem } from '../types.js';
import {
  codexAgentInputSchema,
  codexAgentTomlSchema,
  formatValidationError,
  type CodexAgentInput,
} from './contracts.js';

export function parseCodexAgentToml(raw: string, expectedId?: string): CodexAgentInput {
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Codex agent TOML: ${message}`);
  }

  const result = codexAgentTomlSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid Codex agent: ${formatValidationError(result.error)}`);
  }
  if (expectedId && result.data.name !== expectedId) {
    throw new Error(`Agent name "${result.data.name}" must match file identity "${expectedId}".`);
  }

  return {
    id: result.data.name,
    name: result.data.name,
    category: 'general',
    description: result.data.description,
    developerInstructions: result.data.developer_instructions,
    model: result.data.model,
    modelReasoningEffort: result.data.model_reasoning_effort,
    sandboxMode: result.data.sandbox_mode,
  };
}

export function validateCodexAgentInput(input: unknown): CodexAgentInput {
  const result = codexAgentInputSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid Codex agent: ${formatValidationError(result.error)}`);
  }
  const id = result.data.id ?? result.data.name;
  if (id !== result.data.name) {
    throw new Error('Codex agent id and name must match.');
  }
  return { ...result.data, id };
}

export function serializeCodexAgentToml(agent: CodexAgentInput | CodexAgentItem): string {
  const data: Record<string, string> = {
    name: agent.name,
    description: agent.description,
    developer_instructions: agent.developerInstructions,
  };
  if (agent.model) data.model = agent.model;
  if (agent.modelReasoningEffort) data.model_reasoning_effort = agent.modelReasoningEffort;
  if (agent.sandboxMode) data.sandbox_mode = agent.sandboxMode;
  return `${stringify(data).trim()}\n`;
}
