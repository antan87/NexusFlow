import { describe, expect, it } from 'vitest';

import { parseCodexAgentToml, serializeCodexAgentToml } from './codex-agent.js';

describe('Codex agent TOML', () => {
  it('round-trips the supported native fields', () => {
    const raw = serializeCodexAgentToml({
      id: 'reviewer',
      name: 'reviewer',
      category: 'general',
      description: 'Use when reviewing a fixed diff.',
      developerInstructions: 'Review correctness and security.',
      modelReasoningEffort: 'high',
      sandboxMode: 'read-only',
    });

    expect(parseCodexAgentToml(raw, 'reviewer')).toMatchObject({
      name: 'reviewer',
      description: 'Use when reviewing a fixed diff.',
      developerInstructions: 'Review correctness and security.',
      modelReasoningEffort: 'high',
      sandboxMode: 'read-only',
    });
  });

  it('rejects unsupported keys and identity mismatches', () => {
    expect(() => parseCodexAgentToml(
      'name = "reviewer"\ndescription = "Review"\ndeveloper_instructions = "Review"\nmcp_servers = {}\n',
    )).toThrow(/unrecognized key/i);
    expect(() => parseCodexAgentToml(
      'name = "reviewer"\ndescription = "Review"\ndeveloper_instructions = "Review"\n',
      'other',
    )).toThrow(/must match/i);
  });
});
