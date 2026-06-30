import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import {
  loadWorkspaceState,
  recordRepoSync,
  markValidated,
} from './workspace-state.js';
import type { WorkspaceState } from '../types.js';

vi.mock('node:fs/promises');

/** Parses the JSON written by the most recent writeFile call. */
function lastWritten(): WorkspaceState {
  const calls = vi.mocked(fs.writeFile).mock.calls;
  const data = calls[calls.length - 1][1] as string;
  return JSON.parse(data) as WorkspaceState;
}

describe('workspace-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  describe('loadWorkspaceState', () => {
    it('returns an empty skeleton when the file is absent', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const state = await loadWorkspaceState('/ws');

      expect(state.workspacePath).toBe('/ws');
      expect(state.repos).toEqual({});
    });

    it('round-trips an existing state file', async () => {
      const existing: WorkspaceState = {
        workspacePath: '/ws',
        repos: { api: { repoName: 'api', lastSyncStatus: 'rebased' } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      const state = await loadWorkspaceState('/ws');

      expect(state.repos.api.lastSyncStatus).toBe('rebased');
    });
  });

  describe('recordRepoSync', () => {
    beforeEach(() => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    });

    it('sets pendingValidation when a repo was rebased', async () => {
      const entry = await recordRepoSync('/ws', 'api', {
        status: 'rebased',
        message: 'Rebased onto latest base',
      });

      expect(entry.pendingValidation).toBe(true);
      expect(entry.lastSyncStatus).toBe('rebased');
      expect(entry.lastSyncedAt).toBeTruthy();
      expect(lastWritten().repos.api.pendingValidation).toBe(true);
    });

    it('does not set pendingValidation for an up-to-date repo', async () => {
      const entry = await recordRepoSync('/ws', 'api', {
        status: 'up-to-date',
        message: 'Up to date',
      });

      expect(entry.pendingValidation).toBe(false);
    });

    it('preserves a prior pending flag on a later no-op sync', async () => {
      const existing: WorkspaceState = {
        workspacePath: '/ws',
        repos: { api: { repoName: 'api', pendingValidation: true } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      const entry = await recordRepoSync('/ws', 'api', {
        status: 'up-to-date',
        message: 'Up to date',
      });

      expect(entry.pendingValidation).toBe(true);
    });
  });

  describe('markValidated', () => {
    it('records the result and clears the pending flag', async () => {
      const existing: WorkspaceState = {
        workspacePath: '/ws',
        repos: { api: { repoName: 'api', pendingValidation: true } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      const entry = await markValidated('/ws', 'api', 'pass');

      expect(entry.lastValidationResult).toBe('pass');
      expect(entry.pendingValidation).toBe(false);
      expect(entry.lastValidatedAt).toBeTruthy();
    });
  });
});
