import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  findSessions,
  getSessionTranscript,
  extractRecordUsage,
  accumulateUsage,
  clearSessionFinderCache,
  getClaudeProjectFolderName,
} from './session-finder.js';
import { statusCommand } from '../commands/status.js';
import * as orchestration from '../orchestration/index.js';
import * as repositoryStatus from '../core/status.js';
import * as generationLock from '../core/generation-lock.js';
import * as workspaceState from '../core/workspace-state.js';

describe('Empirical Stress Tests: session-finder and statusCommand', () => {
  let tempBaseDir: string;
  let workspaceDir: string;
  let origEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    origEnv = { ...process.env };
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-stress-'));
    workspaceDir = path.join(tempBaseDir, 'workspace');
    await fs.mkdir(workspaceDir, { recursive: true });

    // Set custom assistant paths inside tempBaseDir
    process.env.ANTIGRAVITY_CLI_HOME = path.join(tempBaseDir, 'antigravity');
    process.env.CLAUDE_CONFIG_DIR = path.join(tempBaseDir, 'claude');
    process.env.CODEX_HOME = path.join(tempBaseDir, 'codex');

    await fs.mkdir(process.env.ANTIGRAVITY_CLI_HOME, { recursive: true });
    await fs.mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

    clearSessionFinderCache();
  });

  afterEach(async () => {
    process.env = origEnv;
    clearSessionFinderCache();
    try {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  describe('1. extractRecordUsage & accumulateUsage edge cases', () => {
    it('handles null, undefined, primitives, and empty objects gracefully', () => {
      expect(extractRecordUsage(null)).toEqual({});
      expect(extractRecordUsage(undefined)).toEqual({});
      expect(extractRecordUsage(123)).toEqual({});
      expect(extractRecordUsage('some string')).toEqual({});
      expect(extractRecordUsage({})).toEqual({});
      expect(extractRecordUsage({ usage: null })).toEqual({});
      expect(extractRecordUsage({ usage: {} })).toEqual({});
      expect(extractRecordUsage({ message: null })).toEqual({});
      expect(extractRecordUsage({ payload: null })).toEqual({});
    });

    it('handles non-numeric token values without throwing', () => {
      const corruptedRecords = [
        { usage: { inputTokens: '1000', outputTokens: '200' } },
        { usage: { inputTokens: null, outputTokens: undefined } },
        { usage: { inputTokens: {}, outputTokens: [] } },
        { usage: { inputTokens: true, outputTokens: false } },
        { usage: { inputTokens: NaN, outputTokens: 50 } },
        { usage: { inputTokens: Infinity, outputTokens: 0 } },
        { usage: { input_tokens: '500', output_tokens: '100' } },
        { usage: { cachedInputTokens: 'invalid', cacheReadInputTokens: 'bad' } },
        { usage: { costUsdEstimate: 'expensive' } },
        { usage: { reasoningOutputTokens: [1, 2, 3] } },
      ];

      for (const rec of corruptedRecords) {
        expect(() => extractRecordUsage(rec)).not.toThrow();
        const res = extractRecordUsage(rec);
        expect(res).toBeDefined();
      }
    });

    it('correctly falls back when tokens are numeric vs non-numeric', () => {
      const rec = {
        usage: {
          inputTokens: 'non-numeric',
          input_tokens: 250,
          outputTokens: 100,
          cachedInputTokens: 'bad',
          cache_read_input_tokens: 50,
          cost_usd_estimate: 0.05,
        },
      };
      const { usage } = extractRecordUsage(rec);
      expect(usage).toBeDefined();
      expect(usage?.inputTokens).toBe(250);
      expect(usage?.outputTokens).toBe(100);
      expect(usage?.cachedInputTokens).toBe(50);
      expect(usage?.costUsdEstimate).toBe(0.05);
      expect(usage?.totalTokens).toBe(350);
    });

    it('handles accumulateUsage across turns with varied fields', () => {
      let acc;
      acc = accumulateUsage(acc, { inputTokens: 100, outputTokens: 50 });
      expect(acc).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });

      acc = accumulateUsage(acc, {
        inputTokens: 200,
        outputTokens: 80,
        cachedInputTokens: 50,
        costUsdEstimate: 0.01,
      });
      expect(acc.inputTokens).toBe(300);
      expect(acc.outputTokens).toBe(130);
      expect(acc.cachedInputTokens).toBe(50);
      expect(acc.costUsdEstimate).toBe(0.01);
      expect(acc.totalTokens).toBe(430);
    });
  });

  describe('2. findSessions stress testing across corrupted files and directories', () => {
    it('handles completely empty assistant directories without error', async () => {
      const sessions = await findSessions(workspaceDir);
      expect(sessions).toEqual([]);
    });

    it('handles corrupted Antigravity history.jsonl and transcripts', async () => {
      const agHistoryPath = path.join(process.env.ANTIGRAVITY_CLI_HOME!, 'history.jsonl');
      const convId = '123e4567-e89b-42d3-a456-426614174000';

      // Corrupted history: empty lines, broken JSON, valid entry, binary garbage
      await fs.writeFile(
        agHistoryPath,
        [
          '',
          '{ "truncated": ',
          'NOT_JSON_AT_ALL',
          JSON.stringify({ conversationId: convId, workspace: workspaceDir, display: 'Stress AG Conv' }),
          '\0\0\0\0NULL_BYTES',
          '{"another": "json"}',
        ].join('\n'),
      );

      // Transcript directory with corrupted transcript.jsonl
      const agBrainLogs = path.join(
        process.env.ANTIGRAVITY_CLI_HOME!,
        'brain',
        convId,
        '.system_generated',
        'logs',
      );
      await fs.mkdir(agBrainLogs, { recursive: true });

      const transcriptPath = path.join(agBrainLogs, 'transcript.jsonl');
      await fs.writeFile(
        transcriptPath,
        [
          '',
          '{ broken json',
          JSON.stringify({ type: 'USER_INPUT', content: '<USER_REQUEST>Stress Request</USER_REQUEST>' }),
          JSON.stringify({
            type: 'PLANNER_RESPONSE',
            content: 'Response 1',
            usage: { inputTokens: 500, outputTokens: 'bad', costUsdEstimate: 0.02 },
          }),
          '{ "unclosed": "object" ',
          JSON.stringify({
            type: 'PLANNER_RESPONSE',
            content: 'Response 2',
            usage: { inputTokens: 300, outputTokens: 150, cachedInputTokens: 100 },
            quota: { tokens: { status: 'ok', remaining: 10000 } },
          }),
        ].join('\n'),
      );

      const sessions = await findSessions(workspaceDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(convId);
      expect(sessions[0].assistant).toBe('antigravity');
      expect(sessions[0].title).toBe('Stress Request');
      expect(sessions[0].usage?.inputTokens).toBe(800);
      expect(sessions[0].usage?.outputTokens).toBe(150);
      expect(sessions[0].usage?.cachedInputTokens).toBe(100);
      expect(sessions[0].usage?.costUsdEstimate).toBe(0.02);
      expect(sessions[0].quota?.tokens?.status).toBe('ok');
    });

    it('handles Antigravity session when transcript file does NOT exist', async () => {
      const agHistoryPath = path.join(process.env.ANTIGRAVITY_CLI_HOME!, 'history.jsonl');
      const convId = '223e4567-e89b-42d3-a456-426614174001';

      await fs.writeFile(
        agHistoryPath,
        JSON.stringify({ conversationId: convId, workspace: workspaceDir, display: 'No Transcript Conv' }) + '\n',
      );

      // No brain/convId directory exists
      const sessions = await findSessions(workspaceDir);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(convId);
      expect(sessions[0].title).toBe('No Transcript Conv');
      expect(sessions[0].usage).toBeUndefined();
    });

    it('handles corrupted Claude Code project files and unreadable files', async () => {
      const claudeFolder = getClaudeProjectFolderName(workspaceDir);
      const claudeProjDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'projects', claudeFolder);
      await fs.mkdir(claudeProjDir, { recursive: true });

      const sess1Id = '323e4567-e89b-42d3-a456-426614174002';
      const sess2Id = '423e4567-e89b-42d3-a456-426614174003';

      // sess1: Corrupted JSONL with empty lines, truncated lines, invalid tokens
      await fs.writeFile(
        path.join(claudeProjDir, `${sess1Id}.jsonl`),
        [
          '',
          '{ "truncated": ',
          JSON.stringify({ type: 'user', sessionId: sess1Id, message: { content: 'Claude Prompt 1' }, timestamp: '2026-09-01T10:00:00Z' }),
          JSON.stringify({
            type: 'assistant',
            sessionId: sess1Id,
            message: { content: 'Claude Response 1' },
            totalCostUsd: 0.015,
            usage: { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 600 },
            timestamp: '2026-09-01T10:01:00Z',
          }),
          'GARBAGE LINE HERE',
        ].join('\n'),
      );

      // sess2: Empty file
      await fs.writeFile(path.join(claudeProjDir, `${sess2Id}.jsonl`), '');

      const sessions = await findSessions(workspaceDir);
      expect(sessions.some((s) => s.id === sess1Id)).toBe(true);
      const s1 = sessions.find((s) => s.id === sess1Id)!;
      expect(s1.title).toBe('Claude Prompt 1');
      expect(s1.usage?.inputTokens).toBe(1200);
      expect(s1.usage?.outputTokens).toBe(400);
      expect(s1.usage?.cachedInputTokens).toBe(600);
      expect(s1.usage?.costUsdEstimate).toBe(0.015);
    });

    it('handles corrupted Codex rollout files', async () => {
      const codexSessionsDir = path.join(process.env.CODEX_HOME!, 'sessions');
      await fs.mkdir(codexSessionsDir, { recursive: true });

      const codexId = '523e4567-e89b-42d3-a456-426614174004';
      await fs.writeFile(
        path.join(codexSessionsDir, 'rollout-corrupted.jsonl'),
        [
          'INVALID FIRST LINE',
          JSON.stringify({
            type: 'session_meta',
            payload: { id: codexId, cwd: workspaceDir, source: 'cli' },
            timestamp: '2026-09-01T10:00:00Z',
          }),
          '{ incomplete JSON',
          JSON.stringify({
            type: 'response_item',
            payload: { type: 'message', role: 'user', content: 'Codex Task' },
            timestamp: '2026-09-01T10:01:00Z',
          }),
          JSON.stringify({
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: 'Codex Answer' },
            usage: { inputTokens: 2000, outputTokens: 500, cachedInputTokens: 300, costUsdEstimate: 0.02 },
            timestamp: '2026-09-01T10:02:00Z',
          }),
        ].join('\n'),
      );

      const sessions = await findSessions(workspaceDir);
      const codexSess = sessions.find((s) => s.id === codexId);
      expect(codexSess).toBeDefined();
      expect(codexSess?.title).toBe('Codex Task');
      expect(codexSess?.usage?.inputTokens).toBe(2000);
      expect(codexSess?.usage?.outputTokens).toBe(500);
      expect(codexSess?.usage?.cachedInputTokens).toBe(300);
      expect(codexSess?.usage?.costUsdEstimate).toBe(0.02);
    });

    it('uses the latest cumulative token count from an interactive Codex rollout', async () => {
      const codexSessionsDir = path.join(process.env.CODEX_HOME!, 'sessions');
      await fs.mkdir(codexSessionsDir, { recursive: true });
      const codexId = '523e4567-e89b-42d3-a456-426614174014';
      await fs.writeFile(path.join(codexSessionsDir, 'rollout-token-count.jsonl'), [
        { type: 'session_meta', payload: { id: codexId, cwd: workspaceDir, source: 'cli' }, timestamp: '2026-09-01T10:00:00Z' },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Measure usage' }] }, timestamp: '2026-09-01T10:01:00Z' },
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, total_tokens: 120 } } }, timestamp: '2026-09-01T10:02:00Z' },
        { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 180, output_tokens: 35, cached_input_tokens: 60, cache_write_input_tokens: 10, total_tokens: 215 } } }, timestamp: '2026-09-01T10:03:00Z' },
      ].map(record => JSON.stringify(record)).join('\n'));

      const session = (await findSessions(workspaceDir)).find(s => s.id === codexId);
      expect(session?.usage).toMatchObject({ inputTokens: 180, outputTokens: 35, cachedInputTokens: 70, totalTokens: 215 });
    });

    it('handles corrupted .sessions directory files', async () => {
      const wsSessionsDir = path.join(workspaceDir, '.sessions');
      await fs.mkdir(wsSessionsDir, { recursive: true });

      const customId = '623e4567-e89b-42d3-a456-426614174005';
      await fs.writeFile(
        path.join(wsSessionsDir, `${customId}.jsonl`),
        [
          '{ truncated',
          JSON.stringify({
            sessionId: customId,
            provider: 'claude',
            userPrompt: 'Custom Session Prompt',
            assistantResponse: 'Custom Response',
            usage: { inputTokens: 450, outputTokens: 150 },
            timestamp: '2026-09-01T10:00:00Z',
          }),
          'CORRUPT TRAILING LINE',
        ].join('\n'),
      );

      const sessions = await findSessions(workspaceDir);
      const customSess = sessions.find((s) => s.id === customId);
      expect(customSess).toBeDefined();
      expect(customSess?.title).toBe('Custom Session Prompt');
      expect(customSess?.usage?.inputTokens).toBe(450);
      expect(customSess?.usage?.outputTokens).toBe(150);
    });

    it('survives unreadable files without crashing findSessions', async () => {
      const claudeFolder = getClaudeProjectFolderName(workspaceDir);
      const claudeProjDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'projects', claudeFolder);
      await fs.mkdir(claudeProjDir, { recursive: true });

      const unreadableFile = path.join(claudeProjDir, '723e4567-e89b-42d3-a456-426614174006.jsonl');
      await fs.writeFile(unreadableFile, '{"type":"user"}');
      try {
        await fs.chmod(unreadableFile, 0o000);
      } catch {}

      // findSessions must not throw
      let sessions: any[] = [];
      expect(async () => {
        sessions = await findSessions(workspaceDir);
      }).not.toThrow();

      // Clean up permissions so afterEach can delete the directory
      try {
        await fs.chmod(unreadableFile, 0o666);
      } catch {}
    });
  });

  describe('3. getSessionTranscript edge cases', () => {
    it('parses Claude transcripts with corrupted lines and extracts usage', async () => {
      const claudeFolder = getClaudeProjectFolderName(workspaceDir);
      const claudeProjDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'projects', claudeFolder);
      await fs.mkdir(claudeProjDir, { recursive: true });

      const sessId = '823e4567-e89b-42d3-a456-426614174007';
      await fs.writeFile(
        path.join(claudeProjDir, `${sessId}.jsonl`),
        [
          '',
          '{ bad json',
          JSON.stringify({ type: 'user', message: { content: 'Turn 1' } }),
          'NOT JSON',
          JSON.stringify({
            type: 'assistant',
            message: { content: 'Reply 1' },
            usage: { inputTokens: 100, outputTokens: 50 },
          }),
        ].join('\n'),
      );

      const msgs = await getSessionTranscript('claude', sessId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('Turn 1');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Reply 1');
      expect(msgs[1].usage?.inputTokens).toBe(100);
    });

    it('parses Antigravity transcripts with corrupted lines and extracts usage', async () => {
      const convId = '823e4567-e89b-42d3-a456-426614174009';
      const agBrainLogs = path.join(
        process.env.ANTIGRAVITY_CLI_HOME!,
        'brain',
        convId,
        '.system_generated',
        'logs',
      );
      await fs.mkdir(agBrainLogs, { recursive: true });

      await fs.writeFile(
        path.join(agBrainLogs, 'transcript.jsonl'),
        [
          '{ broken json',
          JSON.stringify({ type: 'USER_INPUT', content: '<USER_REQUEST>Do action</USER_REQUEST>' }),
          'INVALID LINE',
          JSON.stringify({
            type: 'PLANNER_RESPONSE',
            content: 'Done action.',
            usage: { inputTokens: 300, outputTokens: 100 },
          }),
        ].join('\n'),
      );

      const msgs = await getSessionTranscript('antigravity', convId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('Do action');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Done action.');
      expect(msgs[1].usage?.inputTokens).toBe(300);
    });

    it('parses Codex transcripts with corrupted lines and extracts usage', async () => {
      const codexSessionsDir = path.join(process.env.CODEX_HOME!, 'sessions');
      await fs.mkdir(codexSessionsDir, { recursive: true });

      const sessId = '823e4567-e89b-42d3-a456-426614174010';
      await fs.writeFile(
        path.join(codexSessionsDir, `rollout-${sessId}.jsonl`),
        [
          JSON.stringify({ type: 'session_meta', payload: { id: sessId, cwd: workspaceDir } }),
          '{ truncated',
          JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: 'Codex Query' } }),
          'CORRUPTED TEXT',
          JSON.stringify({
            type: 'response_item',
            payload: { type: 'message', role: 'assistant', content: 'Codex Output' },
            usage: { inputTokens: 700, outputTokens: 250 },
          }),
        ].join('\n'),
      );

      const msgs = await getSessionTranscript('codex', sessId);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].role).toBe('user');
      expect(msgs[0].content).toBe('Codex Query');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[1].content).toBe('Codex Output');
      expect(msgs[1].usage?.inputTokens).toBe(700);
    });

    it('enforces UUID session IDs and rejects invalid formats', async () => {
      await expect(getSessionTranscript('codex', 'invalid-id')).rejects.toThrow(/Invalid Codex session id/);
      await expect(getSessionTranscript('claude', 'not-a-uuid')).rejects.toThrow(/Invalid claude session id/);
    });

    it('handles non-existent transcripts with expected error rejection', async () => {
      const missingId = '999e4567-e89b-42d3-a456-426614174999';
      await expect(getSessionTranscript('claude', missingId)).rejects.toThrow(/not found/i);
      await expect(getSessionTranscript('codex', missingId)).rejects.toThrow(/not found/i);
      await expect(getSessionTranscript('antigravity', missingId)).rejects.toThrow();
    });
  });

  describe('4. statusCommand --json contract fidelity under all conditions', () => {
    it('produces byte-for-byte exact JSON matching loadRunningState with active sessions', async () => {
      // Put an active session on disk
      const wsSessionsDir = path.join(workspaceDir, '.sessions');
      await fs.mkdir(wsSessionsDir, { recursive: true });
      await fs.writeFile(
        path.join(wsSessionsDir, 'active-session.jsonl'),
        JSON.stringify({ sessionId: 'c23e4567-e89b-42d3-a456-426614174001', userPrompt: 'Active', assistantResponse: 'Yes' }) + '\n',
      );

      const sampleRunningState = {
        workspacePath: workspaceDir,
        services: [{ name: 'api-server', status: 'running', port: 3000 }],
        orchestrators: [{ id: 'orch-active', active: true }],
        updatedAt: '2026-09-24T10:00:00.000Z',
      };

      vi.spyOn(orchestration, 'loadRunningState').mockResolvedValue(sampleRunningState as any);

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        logs.push(String(msg));
      });

      await statusCommand(workspaceDir, { json: true });

      const expectedJsonString = JSON.stringify(sampleRunningState, null, 2);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(expectedJsonString);
      expect(Buffer.from(logs[0], 'utf-8')).toEqual(Buffer.from(expectedJsonString, 'utf-8'));

      logSpy.mockRestore();
    });

    it('produces byte-for-byte exact JSON without active sessions', async () => {
      const emptyRunningState = {
        workspacePath: workspaceDir,
        services: [],
        orchestrators: [],
        updatedAt: '2026-09-24T10:00:00.000Z',
      };

      vi.spyOn(orchestration, 'loadRunningState').mockResolvedValue(emptyRunningState as any);

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        logs.push(String(msg));
      });

      await statusCommand(workspaceDir, { json: true });

      const expectedJsonString = JSON.stringify(emptyRunningState, null, 2);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(expectedJsonString);
      expect(Buffer.from(logs[0], 'utf-8')).toEqual(Buffer.from(expectedJsonString, 'utf-8'));

      logSpy.mockRestore();
    });

    it('produces byte-for-byte exact JSON with corrupted sessions on disk', async () => {
      // Put corrupted sessions on disk
      const wsSessionsDir = path.join(workspaceDir, '.sessions');
      await fs.mkdir(wsSessionsDir, { recursive: true });
      await fs.writeFile(path.join(wsSessionsDir, 'corrupt.jsonl'), '{{BAD JSON}}');

      const runningStateWithDetails = {
        workspacePath: workspaceDir,
        services: [{ name: 'srv', status: 'error', error: 'failed to bind' }],
        orchestrators: [],
        metadata: { customField: [1, 2, 3], nested: { ok: true } },
      };

      vi.spyOn(orchestration, 'loadRunningState').mockResolvedValue(runningStateWithDetails as any);

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
        logs.push(String(msg));
      });

      await statusCommand(workspaceDir, { json: true });

      const expectedJsonString = JSON.stringify(runningStateWithDetails, null, 2);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toBe(expectedJsonString);
      expect(Buffer.from(logs[0], 'utf-8')).toEqual(Buffer.from(expectedJsonString, 'utf-8'));

      logSpy.mockRestore();
    });
  });

  describe('5. statusCommand human output formatting edge cases', () => {
    beforeEach(() => {
      vi.spyOn(repositoryStatus, 'getWorkspaceStatusReport').mockResolvedValue({
        workspacePath: workspaceDir,
        repos: [{ name: 'repo-1', branch: 'main', headSha: 'abcdef123456', dirty: false, ahead: 0, behind: 0, path: workspaceDir }],
      } as any);
      vi.spyOn(generationLock, 'checkGenerationLock').mockResolvedValue({ fresh: true, drift: [] } as any);
      vi.spyOn(workspaceState, 'getLastVerificationReport').mockResolvedValue(null);
      vi.spyOn(orchestration, 'getServiceStatus').mockResolvedValue(undefined as any);
    });

    it('formats human output with 0 sessions', async () => {
      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      await statusCommand(workspaceDir);
      const text = logs.join('\n');
      expect(text).toContain('AI Assistant Sessions:');
      expect(text).toContain('No active AI sessions found.');

      logSpy.mockRestore();
    });

    it('formats human output with exactly 1 session with full metrics', async () => {
      const claudeFolder = getClaudeProjectFolderName(workspaceDir);
      const claudeProjDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'projects', claudeFolder);
      await fs.mkdir(claudeProjDir, { recursive: true });

      const sessId = '923e4567-e89b-42d3-a456-426614174008';
      await fs.writeFile(
        path.join(claudeProjDir, `${sessId}.jsonl`),
        [
          JSON.stringify({ type: 'user', sessionId: sessId, message: { content: 'Task 1' } }),
          JSON.stringify({
            type: 'assistant',
            sessionId: sessId,
            message: { content: 'Reply 1' },
            usage: { inputTokens: 5000, outputTokens: 1200, cachedInputTokens: 2500, costUsdEstimate: 0.035 },
            quota: { tokens: { status: 'ok' } },
          }),
        ].join('\n'),
      );

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      await statusCommand(workspaceDir);
      const text = logs.join('\n');
      expect(text).toContain(`[claude-cli] ${sessId}: 5,000 in / 1,200 out (2,500 cached) | Quota: ok | ~$0.035`);

      const sessionRegex = /(?:\[([a-z0-9_-]+)\])?\s*([a-zA-Z0-9_-]{6,}):\s*([\d,]+)\s*in\s*\/\s*([\d,]+)\s*out(?:\s*\(([\d,]+)\s*cached\))?(?:\s*\|\s*Quota:\s*([a-zA-Z_-]+))?(?:\s*\|\s*(~\$[\d.]+))?/;
      const match = text.match(sessionRegex);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('claude-cli');
      expect(match![2]).toBe(sessId);
      expect(match![3]).toBe('5,000');
      expect(match![4]).toBe('1,200');
      expect(match![5]).toBe('2,500');
      expect(match![6]).toBe('ok');
      expect(match![7]).toBe('~$0.035');

      logSpy.mockRestore();
    });

    it('caps human output at 5 sessions when >5 sessions exist', async () => {
      const claudeFolder = getClaudeProjectFolderName(workspaceDir);
      const claudeProjDir = path.join(process.env.CLAUDE_CONFIG_DIR!, 'projects', claudeFolder);
      await fs.mkdir(claudeProjDir, { recursive: true });

      // Create 8 sessions
      for (let i = 1; i <= 8; i++) {
        const id = `a23e4567-e89b-42d3-a456-42661417400${i}`;
        await fs.writeFile(
          path.join(claudeProjDir, `${id}.jsonl`),
          [
            JSON.stringify({ type: 'user', sessionId: id, message: { content: `Prompt ${i}` }, timestamp: `2026-09-24T10:0${i}:00Z` }),
            JSON.stringify({ type: 'assistant', sessionId: id, message: { content: `Reply ${i}` }, timestamp: `2026-09-24T10:0${i}:30Z` }),
          ].join('\n'),
        );
      }

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      await statusCommand(workspaceDir);
      const text = logs.join('\n');
      const lines = text.split('\n').filter((l) => l.includes('[claude-cli]'));
      expect(lines).toHaveLength(5);

      logSpy.mockRestore();
    });

    it('formats sessions conditionally: omits cached when 0, omits cost when undefined, handles planType quota', async () => {
      const wsSessionsDir = path.join(workspaceDir, '.sessions');
      await fs.mkdir(wsSessionsDir, { recursive: true });

      // Session with 0 cache, no cost, planType quota
      const id1 = 'b23e4567-e89b-42d3-a456-426614174001';
      await fs.writeFile(
        path.join(wsSessionsDir, `${id1}.jsonl`),
        [
          JSON.stringify({
            sessionId: id1,
            provider: 'codex',
            userPrompt: 'Codex Task',
            assistantResponse: 'Codex Answer',
            usage: { inputTokens: 1500, outputTokens: 300, cachedInputTokens: 0 },
            quota: { planType: 'plan-included' },
            timestamp: '2026-09-24T10:00:00Z',
          }),
        ].join('\n'),
      );

      // Session with no quota, with cost
      const id2 = 'b23e4567-e89b-42d3-a456-426614174002';
      await fs.writeFile(
        path.join(wsSessionsDir, `${id2}.jsonl`),
        [
          JSON.stringify({
            sessionId: id2,
            provider: 'antigravity',
            userPrompt: 'Gemini Task',
            assistantResponse: 'Gemini Answer',
            usage: { inputTokens: 800, outputTokens: 200, costUsdEstimate: 0.005 },
            timestamp: '2026-09-24T10:01:00Z',
          }),
        ].join('\n'),
      );

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      await statusCommand(workspaceDir);
      const text = logs.join('\n');

      // Session 1: No cached in parentheses, plan-included quota, no cost
      expect(text).toContain(`[codex-cli] ${id1}: 1,500 in / 300 out | Quota: plan-included`);
      expect(text).not.toContain(`[codex-cli] ${id1}: 1,500 in / 300 out (`);
      expect(text).not.toContain(`[codex-cli] ${id1}: 1,500 in / 300 out | Quota: plan-included |`);

      // Session 2: No quota, cost included
      expect(text).toContain(`[antigravity-cli] ${id2}: 800 in / 200 out | ~$0.005`);
      expect(text).not.toContain(`[antigravity-cli] ${id2}: 800 in / 200 out | Quota:`);

      logSpy.mockRestore();
    });

    it('formats quota priority: tokens.status > requests.status > planType > label', async () => {
      const wsSessionsDir = path.join(workspaceDir, '.sessions');
      await fs.mkdir(wsSessionsDir, { recursive: true });

      // requests.status test
      const idReq = 'd23e4567-e89b-42d3-a456-426614174001';
      await fs.writeFile(
        path.join(wsSessionsDir, `${idReq}.jsonl`),
        JSON.stringify({
          sessionId: idReq,
          userPrompt: 'P',
          assistantResponse: 'A',
          usage: { inputTokens: 10, outputTokens: 10 },
          quota: { requests: { status: 'approaching_limit' } },
        }) + '\n',
      );

      // label test
      const idLabel = 'd23e4567-e89b-42d3-a456-426614174002';
      await fs.writeFile(
        path.join(wsSessionsDir, `${idLabel}.jsonl`),
        JSON.stringify({
          sessionId: idLabel,
          userPrompt: 'P',
          assistantResponse: 'A',
          usage: { inputTokens: 10, outputTokens: 10 },
          quota: { label: 'Team Plus Plan' },
        }) + '\n',
      );

      const logs: string[] = [];
      const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
        logs.push(args.map(String).join(' '));
      });

      await statusCommand(workspaceDir);
      const text = logs.join('\n');
      expect(text).toContain(`| Quota: approaching_limit`);
      expect(text).toContain(`| Quota: team_plus_plan`);

      logSpy.mockRestore();
    });
  });
});
