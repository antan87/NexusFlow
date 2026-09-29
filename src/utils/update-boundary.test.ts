import { afterEach, expect, it, vi } from 'vitest';
import { getToolsStatus } from './update-check.js';

vi.mock('execa', () => ({ execa: vi.fn(async () => ({ exitCode: 0, stdout: '1.0.0' })) }));
afterEach(() => vi.restoreAllMocks());

it('toolchain checks request public registry versions without a workspace payload and cache the result', async () => {
  const requests: { url: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options) => {
    requests.push({ url: String(url), body: options?.body ?? null });
    return new Response(JSON.stringify({ version: '2.23.0' }), { status: 200 });
  });
  await getToolsStatus(true);
  expect(requests).toEqual([
    { url: 'https://registry.npmjs.org/@mrpatronz/nexusflow/latest', body: null },
    { url: 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest', body: null },
  ]);
  await getToolsStatus();
  expect(requests).toHaveLength(2);
});
