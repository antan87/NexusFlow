import { describe, expect, it, beforeEach } from 'vitest';
import {
  initDatabase,
  saveChatThread,
  loadChatThread,
  clearChatThread,
  recordApproval,
  resolveApproval,
  getPendingApprovals,
  type StoredChatThread,
} from './db.js';

describe('storage/db SQLite persistence', () => {
  let db: ReturnType<typeof initDatabase>;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  it('saves and loads a chat thread with turns', () => {
    const thread: Omit<StoredChatThread, 'updatedAt'> = {
      workspaceId: 'ws-test-1',
      providerId: 'claude-cli',
      sessions: {
        'claude-cli': { id: 'sess-123', started: true, model: 'claude-3-7-sonnet' },
      },
      profilesByProvider: { 'claude-cli': 'workspace-write' },
      modelsByProvider: { 'claude-cli': 'claude-3-7-sonnet' },
      effortsByProvider: { 'claude-cli': 'high' },
      messages: [
        { role: 'user', content: 'Hello', ts: 1000 },
        { role: 'assistant', content: 'Hi there!', ts: 2000 },
        { role: 'system', content: 'File edited', kind: 'note', ts: 3000 },
      ],
    };

    saveChatThread(thread, db);
    const loaded = loadChatThread('ws-test-1', db);

    expect(loaded).not.toBeNull();
    expect(loaded?.workspaceId).toBe('ws-test-1');
    expect(loaded?.providerId).toBe('claude-cli');
    expect(loaded?.sessions['claude-cli']).toEqual({ id: 'sess-123', started: true, model: 'claude-3-7-sonnet' });
    expect(loaded?.profilesByProvider['claude-cli']).toBe('workspace-write');
    expect(loaded?.modelsByProvider['claude-cli']).toBe('claude-3-7-sonnet');
    expect(loaded?.effortsByProvider['claude-cli']).toBe('high');
    expect(loaded?.messages).toHaveLength(3);
    expect(loaded?.messages[0]).toEqual({ role: 'user', content: 'Hello', ts: 1000 });
    expect(loaded?.messages[1]).toEqual({ role: 'assistant', content: 'Hi there!', ts: 2000 });
    expect(loaded?.messages[2]).toEqual({ role: 'system', content: 'File edited', kind: 'note', ts: 3000 });
  });

  it('overwrites thread turns on update', () => {
    saveChatThread({
      workspaceId: 'ws-test-2',
      providerId: null,
      sessions: {},
      profilesByProvider: {},
      modelsByProvider: {},
      effortsByProvider: {},
      messages: [{ role: 'user', content: 'Initial message' }],
    }, db);

    let loaded = loadChatThread('ws-test-2', db);
    expect(loaded?.messages).toHaveLength(1);

    saveChatThread({
      workspaceId: 'ws-test-2',
      providerId: 'codex-cli',
      sessions: {},
      profilesByProvider: {},
      modelsByProvider: {},
      effortsByProvider: {},
      messages: [
        { role: 'user', content: 'Initial message' },
        { role: 'assistant', content: 'Reply' },
      ],
    }, db);

    loaded = loadChatThread('ws-test-2', db);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.providerId).toBe('codex-cli');
  });

  it('clears chat thread and turns', () => {
    saveChatThread({
      workspaceId: 'ws-test-3',
      providerId: 'claude-cli',
      sessions: {},
      profilesByProvider: {},
      modelsByProvider: {},
      effortsByProvider: {},
      messages: [{ role: 'user', content: 'Test' }],
    }, db);

    expect(loadChatThread('ws-test-3', db)).not.toBeNull();
    clearChatThread('ws-test-3', db);
    expect(loadChatThread('ws-test-3', db)).toBeNull();
  });

  it('records and resolves approvals', () => {
    recordApproval({
      id: 'app-1',
      workspaceId: 'ws-test-4',
      tool: 'Bash',
      input: { command: 'npm test' },
      description: 'Run unit tests',
    }, db);

    let pending = getPendingApprovals('ws-test-4', db);
    expect(pending).toHaveLength(1);
    expect(pending[0].tool).toBe('Bash');
    expect(pending[0].input).toEqual({ command: 'npm test' });
    expect(pending[0].description).toBe('Run unit tests');
    expect(pending[0].decision).toBe('pending');

    resolveApproval('app-1', 'allow', db);
    pending = getPendingApprovals('ws-test-4', db);
    expect(pending).toHaveLength(0);
  });
});
