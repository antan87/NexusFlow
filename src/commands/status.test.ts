import { beforeEach, describe, expect, it, vi } from 'vitest';

import { statusCommand } from './status.js';
import * as orchestration from '../orchestration/index.js';
import * as repositoryStatus from '../core/status.js';
import * as generationLock from '../core/generation-lock.js';

vi.mock('../core/config.js');
vi.mock('../core/workspace.js');
vi.mock('../orchestration/index.js');
vi.mock('../core/status.js');
vi.mock('../core/generation-lock.js');

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
    vi.mocked(orchestration.loadRunningState).mockResolvedValue(runningState);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await statusCommand('/ws', { json: true });

    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual(runningState);
    expect(repositoryStatus.getWorkspaceStatusReport).not.toHaveBeenCalled();
    expect(generationLock.checkGenerationLock).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
