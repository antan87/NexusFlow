import { describe, expect, it, vi } from 'vitest';
import { refreshPlanningContext } from './planning-refresh.js';
import { refreshWorkspace } from './refresh.js';

vi.mock('./refresh.js', () => ({ refreshWorkspace: vi.fn() }));

describe('refreshPlanningContext', () => {
  it('reports a successful generated-context refresh', async () => {
    vi.mocked(refreshWorkspace).mockResolvedValueOnce({ workspacePath: '/workspace', analyzedRepos: [], reusedRepos: [], refreshedHandoff: false });
    await expect(refreshPlanningContext('/workspace')).resolves.toEqual({ contextRefreshed: true });
  });

  it('keeps the planning save result actionable when generation fails', async () => {
    vi.mocked(refreshWorkspace).mockRejectedValueOnce(new Error('generator unavailable'));
    await expect(refreshPlanningContext('/workspace')).resolves.toEqual({ contextRefreshed: false, contextRefreshError: 'generator unavailable' });
  });
});
