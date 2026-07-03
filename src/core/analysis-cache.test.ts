import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import {
  loadAnalysisCache,
  saveAnalysisCache,
  getRepoFingerprint,
  type AnalysisCache,
} from './analysis-cache.js';
import type { ProjectAnalysis } from '../types.js';

vi.mock('node:fs/promises');
vi.mock('execa');

const mockAnalysis: ProjectAnalysis = {
  name: 'repo-1',
  path: '/ws/repo-1',
  techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'backend' },
  endpoints: [],
  dependencies: [],
  ports: [],
  readmeSummary: null,
  existingAIConfigs: [],
};

/** Parses the JSON written by the most recent writeFile call. */
function lastWritten(): AnalysisCache {
  const calls = vi.mocked(fs.writeFile).mock.calls;
  const data = calls[calls.length - 1][1] as string;
  return JSON.parse(data) as AnalysisCache;
}

describe('analysis-cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  describe('loadAnalysisCache', () => {
    it('returns an empty skeleton when the file is absent', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const cache = await loadAnalysisCache('/ws');

      expect(cache.version).toBe(1);
      expect(cache.repos).toEqual({});
    });

    it('round-trips an existing cache file', async () => {
      const existing: AnalysisCache = {
        version: 1,
        repos: {
          'repo-1': {
            repoName: 'repo-1',
            fingerprint: 'abc123',
            analyzedAt: '2026-01-01T00:00:00.000Z',
            analysis: mockAnalysis,
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existing) as any);

      const cache = await loadAnalysisCache('/ws');

      expect(cache.repos['repo-1']!.fingerprint).toBe('abc123');
      expect(cache.repos['repo-1']!.analysis.name).toBe('repo-1');
    });
  });

  describe('saveAnalysisCache', () => {
    it('prunes entries for repos no longer in the workspace', async () => {
      const cache: AnalysisCache = {
        version: 1,
        repos: {
          'repo-1': { repoName: 'repo-1', fingerprint: 'a', analyzedAt: '', analysis: mockAnalysis },
          'removed-repo': { repoName: 'removed-repo', fingerprint: 'b', analyzedAt: '', analysis: mockAnalysis },
        },
      };

      await saveAnalysisCache('/ws', cache, ['repo-1']);

      const written = lastWritten();
      expect(written.repos['repo-1']).toBeDefined();
      expect(written.repos['removed-repo']).toBeUndefined();
    });
  });

  describe('getRepoFingerprint', () => {
    it('returns the bare HEAD SHA for a clean tree', async () => {
      vi.mocked(execa).mockImplementation((async (_cmd: any, args: any) => {
        if (args[0] === 'rev-parse') return { stdout: 'abc123\n' };
        return { stdout: '' }; // clean status
      }) as any);

      const fp = await getRepoFingerprint('/ws/repo-1');

      expect(fp).toBe('abc123');
    });

    it('extends the SHA with a dirty-files hash when the tree is dirty', async () => {
      vi.mocked(execa).mockImplementation((async (_cmd: any, args: any) => {
        if (args[0] === 'rev-parse') return { stdout: 'abc123\n' };
        return { stdout: ' M src/file1.ts\n' };
      }) as any);
      vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);

      const fp = await getRepoFingerprint('/ws/repo-1');

      expect(fp).toMatch(/^abc123\+[0-9a-f]{12}$/);
    });

    it('changes the fingerprint when a dirty file is edited', async () => {
      vi.mocked(execa).mockImplementation((async (_cmd: any, args: any) => {
        if (args[0] === 'rev-parse') return { stdout: 'abc123\n' };
        return { stdout: ' M src/file1.ts\n' };
      }) as any);

      vi.mocked(fs.stat).mockResolvedValue({ size: 100, mtimeMs: 1000 } as any);
      const before = await getRepoFingerprint('/ws/repo-1');

      vi.mocked(fs.stat).mockResolvedValue({ size: 150, mtimeMs: 2000 } as any);
      const after = await getRepoFingerprint('/ws/repo-1');

      expect(before).not.toBe(after);
      expect(before).not.toBe('abc123');
    });

    it('returns null when git fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('not a git repository'));

      const fp = await getRepoFingerprint('/not-a-repo');

      expect(fp).toBeNull();
    });
  });
});
