import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LocalStorageAdapter } from './local-storage.js';

vi.mock('node:fs/promises');
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue('/mock/home'),
  };
});

describe('Storage Adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
  });

  describe('LocalStorageAdapter', () => {
    const adapter = new LocalStorageAdapter();

    it('should declare correct meta', () => {
      expect(adapter.meta.name).toBe('local');
      expect(adapter.meta.configFields.length).toBe(0);
    });

    it('should write workspace files directly to the workspace path', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeWorkspaceFile('/ws/path', 'feature-1', 'test.txt', 'hello');

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(path.normalize('/ws/path')), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.normalize('/ws/path/test.txt'),
        'hello',
        'utf8'
      );
    });

    it('should resolve local workspace paths', () => {
      const resolved = adapter.resolveWorkspaceFileUrl('/ws/path', 'feature-1', 'test.txt');
      expect(resolved).toContain('/ws/path/test.txt');
    });

    it('should delete workspace as NOP', async () => {
      await adapter.deleteWorkspace('/ws/path', 'feature-1');
      expect(fs.rm).not.toHaveBeenCalled();
    });

    it('should write base files into a per-repo base directory', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeBaseFile('/ws/path', 'RepoName', 'contextspace-knowledge.md', 'base');

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.normalize('/ws/path/.contextspace/base/RepoName/contextspace-knowledge.md'),
        'base',
        'utf8'
      );
    });

    it('should not collide base and workspace files that share a filename (A1.2)', () => {
      const wsUrl = adapter.resolveWorkspaceFileUrl('/ws/path', 'feature-1', 'contextspace-knowledge.md');
      const baseUrl = adapter.resolveBaseFileUrl('/ws/path', 'RepoName', 'contextspace-knowledge.md');
      expect(wsUrl).not.toBe(baseUrl);
      expect(wsUrl).toContain('/ws/path/contextspace-knowledge.md');
      expect(baseUrl).toContain('/ws/path/.contextspace/base/RepoName/contextspace-knowledge.md');
    });

    it('should isolate per-repo base files from each other', () => {
      const a = adapter.resolveBaseFileUrl('/ws/path', 'RepoA', 'contextspace-knowledge.md');
      const b = adapter.resolveBaseFileUrl('/ws/path', 'RepoB', 'contextspace-knowledge.md');
      expect(a).not.toBe(b);
    });
  });

  // CentralVaultAdapter is gone. It relocated every workspace file to
  // ~/.nexusflow/vault/<featureId>, but assistants read AGENTS.md and CLAUDE.md
  // from the workspace root and nowhere else, so the files it wrote were where
  // nothing would look for them. It also ignored the vaultPath users configured:
  // no configure() method, empty configFields, and a hardcoded path.

});
