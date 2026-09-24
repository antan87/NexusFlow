import { beforeEach, describe, expect, it, vi } from 'vitest';

import { statusCommand } from './status.js';
import * as orchestration from '../orchestration/index.js';
import * as repositoryStatus from '../core/status.js';
import * as generationLock from '../core/generation-lock.js';
import * as workspaceState from '../core/workspace-state.js';
import * as sessionFinder from '../utils/session-finder.js';

vi.mock('../core/config.js');
vi.mock('../core/workspace.js');
vi.mock('../orchestration/index.js');
vi.mock('../core/status.js');
vi.mock('../core/generation-lock.js');
vi.mock('../core/workspace-state.js');
vi.mock('../utils/session-finder.js');

describe('statusCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves the legacy running-state shape for --json', async () => {
    const runningState = {
      workspacePath: '/ws',
      services: [],
      orchestrators: [],
      updatedAt: '2026-08-26T00:00:00.000Z',
    };
    vi.mocked(orchestration.loadRunningState).mockResolvedValue(runningState as any);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await statusCommand('/ws', { json: true });

    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual(runningState);
    expect(repositoryStatus.getWorkspaceStatusReport).not.toHaveBeenCalled();
    expect(generationLock.checkGenerationLock).not.toHaveBeenCalled();
    expect(sessionFinder.findSessions).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('renders AI Assistant Sessions with usage, cached tokens, quota, and cost in human output', async () => {
    vi.mocked(repositoryStatus.getWorkspaceStatusReport).mockResolvedValue({
      workspacePath: '/ws',
      repos: [{ name: 'NexusFlow', path: '/ws/NexusFlow', branch: 'main', headSha: '1234567890ab', dirty: false, ahead: 0, behind: 0 }],
    } as any);
    vi.mocked(generationLock.checkGenerationLock).mockResolvedValue({ fresh: true, drift: [] } as any);
    vi.mocked(workspaceState.getLastVerificationReport).mockResolvedValue(null);
    vi.mocked(orchestration.getServiceStatus).mockResolvedValue(undefined as any);

    vi.mocked(sessionFinder.findSessions).mockResolvedValue([
      {
        id: 'sess-claude-99',
        assistant: 'claude',
        title: 'Build UI',
        lastActive: new Date(),
        messageCount: 5,
        workspacePath: '/ws',
        usage: {
          inputTokens: 5000,
          outputTokens: 1200,
          cachedInputTokens: 2500,
          costUsdEstimate: 0.035,
        },
        quota: {
          tokens: { unit: 'tokens', remaining: 45000, limit: 50000, status: 'ok' as const },
        },
      } as any,
      {
        id: 'sess-codex-88',
        assistant: 'codex-cli',
        title: 'Fix tests',
        lastActive: new Date(),
        messageCount: 3,
        workspacePath: '/ws',
        usage: {
          inputTokens: 3000,
          outputTokens: 800,
        },
        quota: {
          planType: 'plan-included' as const,
        },
      } as any,
    ]);

    const logMessages: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logMessages.push(args.map(String).join(' '));
    });

    await statusCommand('/ws');

    const output = logMessages.join('\n');
    expect(output).toContain('AI Assistant Sessions:');
    expect(output).toContain('[claude-cli] sess-claude-99: 5,000 in / 1,200 out (2,500 cached) | Quota: ok | ~$0.035');
    expect(output).toContain('[codex-cli] sess-codex-88: 3,000 in / 800 out | Quota: plan-included');
    log.mockRestore();
  });

  it('handles empty AI assistant sessions gracefully in human output', async () => {
    vi.mocked(repositoryStatus.getWorkspaceStatusReport).mockResolvedValue({
      workspacePath: '/ws',
      repos: [{ name: 'NexusFlow', path: '/ws/NexusFlow', branch: 'main', headSha: '1234567890ab', dirty: false, ahead: 0, behind: 0 }],
    } as any);
    vi.mocked(generationLock.checkGenerationLock).mockResolvedValue({ fresh: true, drift: [] } as any);
    vi.mocked(workspaceState.getLastVerificationReport).mockResolvedValue(null);
    vi.mocked(orchestration.getServiceStatus).mockResolvedValue(undefined as any);
    vi.mocked(sessionFinder.findSessions).mockResolvedValue([]);

    const logMessages: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logMessages.push(args.map(String).join(' '));
    });

    await statusCommand('/ws');

    const output = logMessages.join('\n');
    expect(output).toContain('AI Assistant Sessions:');
    expect(output).toContain('No active AI sessions found.');
    log.mockRestore();
  });
});
