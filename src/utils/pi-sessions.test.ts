import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findActiveAssistants, findSessions, getSessionTranscript } from './session-finder.js';

describe('Pi saved conversations', () => {
  let root: string, workspace: string, repo: string, agentDir: string;
  const id = '01a0df53-f0a9-7290-bdd1-5c094ab07027';

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-pi-'));
    workspace = path.join(root, 'workspace');
    repo = path.join(workspace, 'repo');
    agentDir = path.join(root, 'pi-agent');
    await fs.mkdir(repo, { recursive: true });
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function saveSession(cwd: string, sessionId: string, name?: string) {
    const folder = path.join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, `2026-09-26T20-06-55-401Z_${sessionId}.jsonl`), [
      { type: 'session', version: 3, id: sessionId, timestamp: '2026-09-26T20:06:55.401Z', cwd },
      ...(name ? [{ type: 'session_info', name, timestamp: '2026-09-26T20:07:00.000Z' }] : []),
      { type: 'message', timestamp: '2026-09-26T20:07:20.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Improve the menu' }] } },
      { type: 'message', timestamp: '2026-09-26T20:07:30.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }], usage: { input: 10, output: 5, cacheRead: 2, cost: { total: 0.01 } } } },
      'malformed-record',
    ].map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n'));
  }

  it('lists Pi sessions for the workspace and its repos, with resumable cwd and transcript', async () => {
    await saveSession(repo, id, 'Menu cleanup');
    await saveSession(path.join(root, 'unrelated'), '01a0df53-f0a9-7290-bdd1-5c094ab07028');
    const sessions = await findSessions(workspace, [repo], 'pi');
    expect(sessions).toMatchObject([{ id, assistant: 'pi', title: 'Menu cleanup', recordedCwd: repo,
      workspacePath: repo, messageCount: 2, usage: { inputTokens: 10, outputTokens: 5, costUsdEstimate: 0.01 } }]);
    expect(await findActiveAssistants(workspace, [repo])).toContain('pi');
    expect(await getSessionTranscript('pi', id)).toMatchObject([
      { role: 'user', content: 'Improve the menu' }, { role: 'assistant', content: 'Done.' },
    ]);
  });

  it('uses the first user prompt when unnamed and rejects unrelated or invalid headers', async () => {
    await saveSession(workspace, id);
    const invalidDir = path.join(agentDir, 'sessions', 'invalid');
    await fs.mkdir(invalidDir, { recursive: true });
    await fs.writeFile(path.join(invalidDir, 'invalid.jsonl'), JSON.stringify({ type: 'session', id: 'bad-id', cwd: workspace }));
    expect((await findSessions(workspace, [], 'pi')).map(session => session.title)).toEqual(['Improve the menu']);
    expect(await findSessions(path.join(root, 'other'), [], 'pi')).toEqual([]);
    await expect(getSessionTranscript('pi', '01a0df53-f0a9-7290-bdd1-5c094ab07029')).rejects.toThrow('not found');
  });
});
