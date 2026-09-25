import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { registerWorkGuidanceRoutes } from './work-guidance-routes.js';

vi.mock('../core/refresh.js', () => ({
  refreshWorkspace: vi.fn().mockResolvedValue({ workspacePath: '/tmp/test', analyzedRepos: [], reusedRepos: [], refreshedHandoff: false }),
}));
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
  expect(result.contextRefreshed).toBe(true);
  const read = await app.request(`/api/workspace/test/work/documents/${result.guidance.documents[0].id}`);
  expect((await read.json()).content).toBe('Original requirements');
});

it('reports a saved plan conflict and refresh result without hiding the mutation', async () => {
  const first = await app.request('/api/workspace/test/work', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 0, workType: 'feature', size: 'small', assignment: { stage: 'design', objective: 'Shape the change', expectedOutput: 'A proposal', stopCondition: 'Before implementation' } }),
  });
  expect(first.status).toBe(200);
  expect((await first.json()).contextRefreshed).toBe(true);
  const stale = await app.request('/api/workspace/test/work', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 0, workType: 'feature', size: 'small', assignment: { stage: 'design', objective: 'Stale', expectedOutput: 'A proposal', stopCondition: 'Before implementation' } }),
  });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toContain('another session');
});
it('rejects absent workspaces, malformed metadata, oversized input, and stale writes', async () => {
  expect((await app.request('/api/workspace/missing/work')).status).toBe(404);
  const request = (body: unknown) => app.request('/api/workspace/test/work/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect((await request({ revision: 0, title: '', content: 'x' })).status).toBe(400);
  expect((await request({ revision: 0, title: 'Large', role: 'reference', content: 'x'.repeat(600_001) })).status).toBe(413);
  expect((await request({ revision: 0, title: 'First', role: 'reference', content: 'hello' })).status).toBe(200);
  expect((await request({ revision: 0, title: 'Stale', role: 'reference', content: 'world' })).status).toBe(409);
});
it('serves authored planning notes and returns a conflict without replacing newer content', async () => {
  const initial = await (await app.request('/api/workspace/test/planning-notes')).json();
  const save = (content: string) => app.request('/api/workspace/test/planning-notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: initial.revision, content }) });
  expect((await save('# Agreed sequence')).status).toBe(200);
  expect((await save('# Stale overwrite')).status).toBe(409);
  expect((await (await app.request('/api/workspace/test/planning-notes')).json()).content).toBe('# Agreed sequence');
  expect((await app.request('/api/workspace/missing/planning-notes')).status).toBe(404);
});

it('lists and previews root documents without registering sources, and serves safe downloads', async () => {
  await fs.writeFile(path.join(root, 'agent report.md'), '# Agent report');
  await fs.writeFile(path.join(root, 'brief.pdf'), '%PDF-1.7\nfixture');
  const list = await (await app.request('/api/workspace/test/documents')).json();
  expect(list.documents.map((doc: { name: string }) => doc.name)).toEqual(['agent report.md', 'brief.pdf']);
  const preview = await (await app.request('/api/workspace/test/documents/preview?name=agent%20report.md')).json();
  expect(preview).toMatchObject({ name: 'agent report.md', kind: 'markdown', content: '# Agent report' });
  expect(preview).not.toHaveProperty('bytes');
  const file = await app.request('/api/workspace/test/documents/file?name=brief.pdf');
  expect(file.headers.get('content-type')).toBe('application/pdf');
  expect(file.headers.get('x-content-type-options')).toBe('nosniff');
  expect(await file.text()).toBe('%PDF-1.7\nfixture');
  const download = await app.request('/api/workspace/test/documents/file?name=agent%20report.md&download=1');
  expect(download.headers.get('content-disposition')).toContain('attachment;');
  expect((await app.request('/api/workspace/test/documents/preview?name=..%2Fescape.md')).status).toBe(400);
  expect((await app.request('/api/workspace/missing/documents')).status).toBe(404);
});
