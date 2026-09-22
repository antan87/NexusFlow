import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { registerTerminalRoutes } from './routes.js';
import { getClaudeProjectFolderName, findSessions, codexThreadIdentity } from '../utils/session-finder.js';
import type { TerminalManager } from './manager.js';

const testHome = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async importOriginal => ({ ...await importOriginal<typeof import('node:os')>(), homedir: () => testHome.path }));
vi.mock('./targets.js', async importOriginal => ({ ...await importOriginal<typeof import('./targets.js')>(), resolveLaunch: (target: string, sessionId: string) => ({ file: 'fixture-only', args: [target, sessionId], env: {}, label: target }) }));
const ids = { codex: 'aaaaaaaa-0000-4000-8000-000000000001', claude: 'aaaaaaaa-0000-4000-8000-000000000002', antigravity: 'aaaaaaaa-0000-4000-8000-000000000003', copilot: 'aaaaaaaa-0000-4000-8000-000000000004' };
let root: string, workspace: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cs-resume-')); testHome.path = root;
  workspace = path.join(root, 'workspace'); await mkdir(workspace);
  vi.stubEnv('CODEX_HOME', path.join(root, 'codex'));
  vi.stubEnv('CLAUDE_CONFIG_DIR', path.join(root, 'claude'));
  vi.stubEnv('ANTIGRAVITY_CLI_HOME', path.join(root, 'agy'));
  await mkdir(path.join(root, 'codex', 'sessions'), { recursive: true });
  await mkdir(path.join(root, 'claude', 'projects', getClaudeProjectFolderName(workspace)), { recursive: true });
  await mkdir(path.join(root, 'agy'));
  await mkdir(path.join(root, '.copilot'));
  await writeFile(path.join(workspace, 'contextspace.json'), JSON.stringify({ id: 'workspace', workspacePath: workspace, repos: [] }));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

async function codex(source: unknown = 'cli', cwd = workspace) {
  await writeFile(path.join(root, 'codex', 'sessions', 'rollout.jsonl'), [
    { type: 'session_meta', payload: { id: ids.codex, cwd, source } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Continue the main task' } },
  ].map(v => JSON.stringify(v)).join('\n'));
}
async function fixture() {
  const app = new Hono(); const create = vi.fn(async input => ({ id: input.launchId, target: input.target }));
  registerTerminalRoutes(app, vi.fn() as any, async () => workspace, { create } as unknown as TerminalManager);
  const auth = await app.request('http://localhost/api/terminals/bootstrap', { method: 'POST', headers: { origin: 'http://localhost', 'x-contextspace-terminal': 'bootstrap' } });
  const { token } = await auth.json(); const cookie = auth.headers.get('set-cookie')!.split(';')[0];
  const launch = (target: string, sessionId: string) => app.request('http://localhost/api/terminals/workspace/create', { method: 'POST', headers: { origin: 'http://localhost', 'x-contextspace-terminal': token, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ target, sessionId, launchId: crypto.randomUUID() }) });
  return { create, launch };
}

describe('resume the histories already shown in Sessions', () => {
  it('uses the latest valid recorded activity, independent of record order or discovery time', async () => {
    await codex();
    const file = path.join(root, 'codex', 'sessions', 'rollout.jsonl');
    const { appendFile } = await import('node:fs/promises');
    for (const timestamp of ['2026-09-21T16:45:00Z', 'invalid', '2026-09-20T08:00:00Z']) {
      await appendFile(file, '\n' + JSON.stringify({ type: 'event_msg', timestamp }));
    }
    await writeFile(path.join(root, 'agy', 'history.jsonl'), JSON.stringify({ conversationId: ids.antigravity, workspace, timestamp: '2026-09-19T09:00:00Z' }));
    const transcriptDir = path.join(root, 'agy', 'brain', ids.antigravity, '.system_generated', 'logs');
    await mkdir(transcriptDir, { recursive: true });
    await writeFile(path.join(transcriptDir, 'transcript.jsonl'), JSON.stringify({ type: 'PLANNER_RESPONSE', timestamp: '2026-09-22T11:30:00Z', content: 'Finished' }));
    await writeFile(path.join(root, 'claude', 'projects', getClaudeProjectFolderName(workspace), `${ids.claude}.jsonl`), JSON.stringify({ sessionId: ids.claude, cwd: workspace, type: 'user', timestamp: 'invalid', message: { content: 'No timestamp' } }));
    const sessions = await findSessions(workspace);
    expect(sessions.map(s => s.assistant)).toEqual(['antigravity', 'codex', 'claude']);
    expect(sessions[0]).toMatchObject({ createdAt: '2026-09-19T09:00:00.000Z', updatedAt: '2026-09-22T11:30:00.000Z' });
    expect(sessions[1]).toMatchObject({ createdAt: '2026-09-20T08:00:00.000Z', updatedAt: '2026-09-21T16:45:00.000Z' });
    expect(sessions[2]).toMatchObject({ createdAt: '', updatedAt: '' });
  });
  it('uses verified recorded directories for all four existing harness histories', async () => {
    await codex();
    await writeFile(path.join(root, 'claude', 'projects', getClaudeProjectFolderName(workspace), `${ids.claude}.jsonl`), JSON.stringify({ sessionId: ids.claude, cwd: workspace, type: 'user', isSidechain: false, message: { content: 'Claude task' } }));
    await writeFile(path.join(root, 'agy', 'history.jsonl'), JSON.stringify({ conversationId: ids.antigravity, workspace, display: 'AGY task' }));
    const db = new DatabaseSync(path.join(root, '.copilot', 'session-store.db'));
    db.exec('CREATE TABLE sessions (id TEXT, cwd TEXT, summary TEXT, created_at TEXT, updated_at TEXT); CREATE TABLE turns (session_id TEXT, user_message TEXT, assistant_response TEXT, turn_index INTEGER)');
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)').run(ids.copilot, workspace, 'Copilot task', '2026-09-21', '2026-09-21'); db.close();
    const f = await fixture();
    const canonicalWorkspace = await realpath(workspace);
    for (const [target, id] of Object.entries(ids)) {
      const response = await f.launch(target, id);
      expect(response.status, await response.text()).toBe(200);
      expect(f.create).toHaveBeenLastCalledWith(expect.objectContaining({ target, sessionId: id, cwd: canonicalWorkspace }));
    }
    expect((await f.launch('claude', ids.codex)).status).toBe(400);
    expect(f.create).toHaveBeenCalledTimes(4);
  });
  it('rejects subagents and canonical-directory escapes before spawning', async () => {
    await codex({ subagent: { thread_spawn: { parent_thread_id: ids.claude, depth: 1 } } });
    const f = await fixture();
    expect((await f.launch('codex', ids.codex)).status).toBe(400);
    const outside = path.join(root, 'outside'); await mkdir(outside);
    await symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(path.join(root, 'agy', 'history.jsonl'), JSON.stringify({ conversationId: ids.antigravity, workspace: path.join(workspace, 'escape'), display: 'Outside task' }));
    expect((await f.launch('antigravity', ids.antigravity)).status).toBe(400);
    expect(f.create).not.toHaveBeenCalled();
  });
  it('classifies actual source metadata without mistaking forks or task titles for subagents', async () => {
    expect(codexThreadIdentity({ source: 'cli', forked_from_id: ids.claude })).toEqual({ threadKind: 'main' });
    expect(codexThreadIdentity({ source: { subagent: { other: 'worker' } } })).toEqual({ threadKind: 'subagent' });
    expect(codexThreadIdentity({})).toEqual({ threadKind: 'unknown' });
    await codex({ subagent: { thread_spawn: { parent_thread_id: ids.claude, depth: 1 } } });
    expect((await findSessions(workspace)).find(s => s.id === ids.codex)).toMatchObject({ threadKind: 'subagent', parentSessionId: ids.claude });
  });
  it('rejects Claude sidechain histories even when their filename looks like a main session', async () => {
    await writeFile(path.join(root, 'claude', 'projects', getClaudeProjectFolderName(workspace), `${ids.claude}.jsonl`), JSON.stringify({ sessionId: ids.claude, cwd: workspace, type: 'user', isSidechain: true, message: { content: 'A delegated task' } }));
    expect((await findSessions(workspace)).find(s => s.id === ids.claude)).toMatchObject({ threadKind: 'subagent' });
    const f = await fixture();
    expect((await f.launch('claude', ids.claude)).status).toBe(400);
    expect(f.create).not.toHaveBeenCalled();
  });
});
