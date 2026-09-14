import { beforeEach, afterEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerWorkGuidanceRoutes } from './work-guidance-routes.js';
let root: string;
let app: Hono;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'guidance-api-'));
  await fs.writeFile(path.join(root, 'contextspace.json'), JSON.stringify({ id: 'test', branchName: 'test', description: 'Test', repos: [], assistants: [] }));
  app = new Hono();
  registerWorkGuidanceRoutes(app, async (id) => id === 'test' ? root : null);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
it('serves source labels, original text, and an updated scoped assignment', async () => {
  expect((await app.request('/api/workspace/test/work')).status).toBe(200);
  const saved = await app.request('/api/workspace/test/work/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0, title: 'Requirements', role: 'requirements', status: 'approved', content: 'Original requirements' }) });
  expect(saved.status).toBe(200);
  const result = await saved.json();
  expect(result.assignment).toContain('requirements, approved');
  const read = await app.request(`/api/workspace/test/work/documents/${result.guidance.documents[0].id}`);
  expect((await read.json()).content).toBe('Original requirements');
});
it('rejects absent workspaces, malformed metadata, oversized input, and stale writes', async () => {
  expect((await app.request('/api/workspace/missing/work')).status).toBe(404);
  const request = (body: unknown) => app.request('/api/workspace/test/work/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await request({ revision: 0, title: '', content: 'x' })).status).toBe(400);
  expect((await request({ revision: 0, title: 'Large', role: 'reference', content: 'x'.repeat(600_001) })).status).toBe(413);
  expect((await request({ revision: 0, title: 'First', role: 'reference', content: 'hello' })).status).toBe(200);
  expect((await request({ revision: 0, title: 'Stale', role: 'reference', content: 'world' })).status).toBe(409);
});
