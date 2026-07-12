import { describe, it, expect, beforeEach } from 'vitest';
import { NativeAgent } from './NativeAgent.js';
import { NativeClaudeAgent } from './NativeClaudeAgent.js';
import { NativeGoogleAgent } from './NativeGoogleAgent.js';

// Ensure no keys leak in from the environment.
beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

const cases: [string, () => any, RegExp][] = [
  ['NativeAgent (OpenAI)', () => new NativeAgent(), /OpenAI API key is not configured/],
  ['NativeClaudeAgent', () => new NativeClaudeAgent(), /Anthropic API key is not configured/],
  ['NativeGoogleAgent', () => new NativeGoogleAgent(), /Google API key is not configured/],
];

describe('native agents without an API key', () => {
  for (const [name, make, expected] of cases) {
    it(`${name}: constructs without throwing and emits a clear config error on send`, async () => {
      // Construction must not throw even though the SDK client would reject an
      // empty key — the client is built lazily behind the config gate.
      const agent = make();
      const events: { type: string; message?: string }[] = [];
      agent.on('error', (e: Error) => events.push({ type: 'error', message: e.message }));
      agent.on('idle', () => events.push({ type: 'idle' }));

      await agent.start('/tmp/ws');
      await agent.send('hello');

      const err = events.find((e) => e.type === 'error');
      expect(err, 'expected an error event').toBeTruthy();
      expect(err!.message).toMatch(expected);
      // No network call happened, and the turn settled.
      expect(events.some((e) => e.type === 'idle')).toBe(true);
    });
  }
});
