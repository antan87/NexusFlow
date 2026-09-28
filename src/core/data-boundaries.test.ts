import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteWorkspace } from './workspace.js';
import { collectDiagnostics } from './diagnostics.js';
import { clearChatThread, closeDatabase, getPendingApprovals, initDatabase, loadChatThread, recordApproval, saveChatThread } from '../storage/db.js';
import { findSessions, getClaudeProjectFolderName } from '../utils/session-finder.js';

let root: string | undefined;
afterEach(async () => {
  closeDatabase();
  vi.unstubAllEnvs();
  if (root) await fs.rm(root, { recursive: true, force: true });
});

it('keeps diagnostic collection, chat clearing and workspace deletion within their documented stores', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-data-boundaries-'));
  const workspace = path.join(root, 'workspace');
  const repository = path.join(root, 'source-repository');
  const profile = path.join(root, 'profile');
  const external = path.join(root, 'assistant-history');
  for (const dir of [workspace, repository, profile, external]) await fs.mkdir(dir);
  vi.stubEnv('CONTEXTSPACE_HOME', profile);
  vi.stubEnv('NEXUSFLOW_HOME', profile);
  vi.stubEnv('CLAUDE_CONFIG_DIR', external);
  const canary = 'SYNTHETIC_PRIVATE_CONTENT';
  await fs.writeFile(path.join(repository, 'source.txt'), canary);
  await fs.writeFile(path.join(workspace, 'contextspace.json'), JSON.stringify({
    id: 'fixture', branchName: 'fixture', workspacePath: workspace, mode: 'in-place', repos: [repository], createdAt: '2026-01-01T00:00:00Z',
  }));
  await fs.mkdir(path.join(workspace, '.contextspace'));
  const ledger = path.join(workspace, '.contextspace', 'chat.jsonl');
  await fs.writeFile(ledger, canary);
  const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  const historyDir = path.join(external, 'projects', getClaudeProjectFolderName(workspace));
  await fs.mkdir(historyDir, { recursive: true });
  const historyFile = path.join(historyDir, `${sessionId}.jsonl`);
  const history = JSON.stringify({ type: 'user', sessionId, cwd: workspace, timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: canary } }) + '\n';
  await fs.writeFile(historyFile, history);
  const db = initDatabase(path.join(profile, 'nexusflow.db'));
  const thread = { workspaceId: 'fixture', messages: [{ role: 'user' as const, content: canary }] };
  saveChatThread(thread, db);
  recordApproval({ id: 'approval', workspaceId: 'fixture', tool: 'synthetic', input: { canary } }, db);

  expect((await findSessions(workspace, [repository], 'claude')).map(session => session.id)).toContain(sessionId);
  expect((await collectDiagnostics(workspace)).content).not.toContain(canary);
  expect(loadChatThread('fixture', db)?.messages[0]?.content).toBe(canary);
  expect(await fs.readFile(ledger, 'utf8')).toBe(canary);
  expect(await fs.readFile(historyFile, 'utf8')).toBe(history);
  expect(await fs.readFile(path.join(repository, 'source.txt'), 'utf8')).toBe(canary);

  clearChatThread('fixture', db);
  expect(loadChatThread('fixture', db)).toBeNull();
  expect(getPendingApprovals('fixture', db)).toHaveLength(1);
  expect(await fs.readFile(ledger, 'utf8')).toBe(canary);
  expect(await fs.readFile(historyFile, 'utf8')).toBe(history);

  saveChatThread(thread, db);
  await deleteWorkspace(workspace);
  await expect(fs.access(workspace)).rejects.toThrow();
  expect(loadChatThread('fixture', db)?.messages[0]?.content).toBe(canary);
  expect(getPendingApprovals('fixture', db)).toHaveLength(1);
  expect(await fs.readFile(historyFile, 'utf8')).toBe(history);
  expect(await fs.readFile(path.join(repository, 'source.txt'), 'utf8')).toBe(canary);
});
