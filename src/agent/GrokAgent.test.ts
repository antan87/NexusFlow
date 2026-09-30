import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrokAgent } from './GrokAgent.js';

/**
 * The xAI integration is an OpenAI-compatible endpoint with its own credential,
 * base URL and model default, so the risk is entirely in those three: a test
 * that only asserted "it constructs" would pass while the agent silently talked
 * to OpenAI with an empty key.
 */
function stubStream(chunks: unknown[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

let created: Array<Record<string, unknown>>;

beforeEach(() => {
  created = [];
  process.env.XAI_API_KEY = 'xai-test';
  vi.resetModules();
  vi.doMock('openai', () => {
    class FakeOpenAI {
      chat = {
        completions: {
          create: vi.fn(async (_body: unknown, options?: unknown) => {
            created.push({ body: _body, options });
            return stubStream([
              { choices: [{ delta: { content: 'hello' } }] },
              { choices: [{ delta: { content: ' from grok' } }] },
            ]);
          }),
        },
      };
      constructor(public options: Record<string, unknown>) {}
    }
    return { default: FakeOpenAI };
  });
});

afterEach(() => {
  delete process.env.XAI_API_KEY;
  delete process.env.XAI_MODEL;
  delete process.env.XAI_BASE_URL;
  vi.doUnmock('openai');
  vi.resetModules();
});

describe('GrokAgent', () => {
  it('uses the xAI credential and base URL, never the OpenAI ones', async () => {
    process.env.OPENAI_API_KEY = 'openai-key-must-not-be-used';
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    agent.on('data', () => {});
    await agent.start('/tmp/ws');
    await agent.send('hi');
    expect(created.length).toBeGreaterThan(0);

    expect((agent as never as { openai: { options: Record<string, unknown> } }).openai.options).toMatchObject({
      apiKey: 'xai-test',
      baseURL: 'https://api.x.ai/v1',
    });
  });

  it('honours an xAI base URL override without falling back to OPENAI_BASE_URL', async () => {
    process.env.XAI_BASE_URL = 'https://gateway.internal/xai/v1';
    process.env.OPENAI_BASE_URL = 'https://elsewhere.invalid/v1';
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    agent.on('data', () => {});
    await agent.start('/tmp/ws');
    await agent.send('hi');
    expect((agent as never as { openai: { options: Record<string, unknown> } }).openai.options).toMatchObject({
      baseURL: 'https://gateway.internal/xai/v1',
    });
  });

  it('defaults the model from XAI_MODEL, not OPENAI_MODEL', async () => {
    process.env.OPENAI_MODEL = 'gpt-4o';
    process.env.XAI_MODEL = 'grok-4-fast';
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    agent.on('data', () => {});
    await agent.start('/tmp/ws');
    await agent.send('hi');
    expect((created[0]!.body as { model: string }).model).toBe('grok-4-fast');
  });

  it('streams assistant text as it arrives', async () => {
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    const chunks: unknown[] = [];
    agent.on('data', (chunk: unknown) => chunks.push(chunk));
    await agent.start('/tmp/ws');
    await agent.send('hi');
    expect(chunks.slice(0, 2)).toEqual(['hello', ' from grok']);
  });

  it('reports a missing credential instead of calling the API', async () => {
    delete process.env.XAI_API_KEY;
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    // A missing credential is reported as an event, not a rejection, so the
    // chat surface can show it without an unhandled rejection.
    const failures: Error[] = [];
    agent.on('error', (error: Error) => failures.push(error));
    await agent.start('/tmp/ws');
    await agent.send('hi');
    expect(failures.map((error) => error.message).join()).toMatch(/XAI_API_KEY/);
    expect(created).toHaveLength(0);
  });

  it('instructs the model to read the generated AGENTS.md', async () => {
    const { GrokAgent: Fresh } = await import('./GrokAgent.js');
    const agent = new Fresh();
    agent.on('data', () => {});
    await agent.start('/tmp/ws');
    await agent.send('hi');
    const messages = (created[0]!.body as { messages: Array<{ content: string }> }).messages;
    expect(messages[0]!.content).toContain('AGENTS.md');
  });
});
