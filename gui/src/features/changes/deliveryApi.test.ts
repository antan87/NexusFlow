import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCommitResponse, postJson, remoteLabel, submitFinish } from './deliveryApi.js';

const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }));

describe('delivery request classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a JSON error response into an HTTP failure with the server message', async () => {
    vi.stubGlobal('fetch', respond(500, JSON.stringify({ error: 'index.lock exists' })));
    await expect(postJson('/x', {}, isCommitResponse)).resolves.toMatchObject({ ok: false, kind: 'http', status: 500, error: 'index.lock exists' });
  });

  it('never treats an error body without results as an empty success', async () => {
    vi.stubGlobal('fetch', respond(200, JSON.stringify({ error: 'partial' })));
    await expect(postJson('/x', {}, isCommitResponse)).resolves.toMatchObject({ ok: false, kind: 'invalid-response' });
  });

  it('reports unreadable bodies and network failures distinctly', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>bad gateway</html>'));
    await expect(postJson('/x', {}, isCommitResponse)).resolves.toMatchObject({ ok: false, kind: 'invalid-response', status: 502 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(postJson('/x', {}, isCommitResponse)).resolves.toMatchObject({ ok: false, kind: 'network' });
  });

  it('accepts a blocked finish (409) as an explained result', async () => {
    vi.stubGlobal('fetch', respond(409, JSON.stringify({ blocked: true, policy: { ready: false, repos: [], blockers: ['stale'] }, repos: [], dryRun: false, safeToCleanup: false })));
    await expect(submitFinish('ws', { createPrs: false })).resolves.toMatchObject({ ok: true, status: 409, data: { blocked: true } });
  });

  it('labels remotes compactly', () => {
    expect(remoteLabel('git@github.com:o/api.git')).toBe('github.com/o/api');
    expect(remoteLabel('https://token@github.com/o/api.git')).toBe('github.com/o/api');
    expect(remoteLabel(null)).toBe('no remote');
  });
});
