import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { dataRoutes } from './routes.js';
import { collectDiagnostics } from '../core/diagnostics.js';

describe('diagnostic HTTP contract', () => {
  const resolveWorkspace = vi.fn(async () => { throw new Error('SECRET_PATH'); });
  const app = dataRoutes(resolveWorkspace);
  const post = (route: string, body: unknown) => app.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('does not impose its diagnostic payload limit on unrelated API routes', async () => {
    const server = new Hono().route('/api', app);
    server.post('/api/unrelated', async c => c.text(String((await c.req.text()).length)));
    const response = await server.request('/api/unrelated', { method: 'POST', body: 'x'.repeat(1100000) });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('1100000');
    expect(response.headers.get('cache-control')).toBeNull();
  });

  it('returns the guide without invoking workspace resolution, collectors or a network service', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const response = await app.request('/data-guide');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).classes.length).toBeGreaterThan(10);
    expect(resolveWorkspace).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('uses a captured preview for section removal and byte-identical download', async () => {
    const capture = await (await post('/diagnostics/preview', {})).json();
    const reviewed = await (await post('/diagnostics/review', { report: capture.report, omit: ['runtime'] })).json();
    const download = await post('/diagnostics/export', { report: reviewed.report, digest: reviewed.digest });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(await download.text()).toBe(reviewed.content);
    const stale = await post('/diagnostics/export', { report: reviewed.report, digest: capture.digest });
    expect(stale.status).toBe(400);
  });

  it('cannot bypass exclusions through direct export and never echoes unsafe input/errors', async () => {
    const capture = await collectDiagnostics();
    const response = await post('/diagnostics/export', { report: { ...capture.report, token: 'SECRET_VALUE' }, digest: capture.digest });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('SECRET_VALUE');
    const failure = await post('/diagnostics/preview', { workspaceId: 'invalid' });
    expect(failure.status).toBe(400);
    expect(await failure.text()).not.toContain('SECRET_PATH');
    expect((await post('/diagnostics/preview', { workspacePath: '/etc' })).status).toBe(400);
    expect((await post('/diagnostics/export', { report: 'x'.repeat(1100000), digest: 'bad' })).status).toBe(413);
  });
});
