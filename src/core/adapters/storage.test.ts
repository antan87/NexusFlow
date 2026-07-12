import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LocalStorageAdapter } from './local-storage.js';
import { CentralVaultAdapter } from './vault-storage.js';

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

      await adapter.writeBaseFile('/ws/path', 'RepoName', 'nexusflow-knowledge.md', 'base');

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.normalize('/ws/path/.nexusflow/base/RepoName/nexusflow-knowledge.md'),
        'base',
        'utf8'
      );
    });

    it('should not collide base and workspace files that share a filename (A1.2)', () => {
      const wsUrl = adapter.resolveWorkspaceFileUrl('/ws/path', 'feature-1', 'nexusflow-knowledge.md');
      const baseUrl = adapter.resolveBaseFileUrl('/ws/path', 'RepoName', 'nexusflow-knowledge.md');
      expect(wsUrl).not.toBe(baseUrl);
      expect(wsUrl).toContain('/ws/path/nexusflow-knowledge.md');
      expect(baseUrl).toContain('/ws/path/.nexusflow/base/RepoName/nexusflow-knowledge.md');
    });

    it('should isolate per-repo base files from each other', () => {
      const a = adapter.resolveBaseFileUrl('/ws/path', 'RepoA', 'nexusflow-knowledge.md');
      const b = adapter.resolveBaseFileUrl('/ws/path', 'RepoB', 'nexusflow-knowledge.md');
      expect(a).not.toBe(b);
    });
  });

  describe('CentralVaultAdapter', () => {
    const adapter = new CentralVaultAdapter();

    it('should declare correct meta', () => {
      expect(adapter.meta.name).toBe('central-vault');
    });

    it('should write workspace files to ~/.nexusflow/vault/<featureId>', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeWorkspaceFile('/ws/path', 'feature-1', 'test.txt', 'hello');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(path.normalize('.nexusflow/vault/feature-1/test.txt')),
        'hello',
        'utf8'
      );
    });

    it('should write base files to ~/.nexusflow/vault/_base/<repoName>', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeBaseFile('/ws/path', 'RepoName', 'map.md', 'content');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(path.normalize('.nexusflow/vault/_base/RepoName/map.md')),
        'content',
        'utf8'
      );
    });

    it('should delete workspace folder from ~/.nexusflow/vault', async () => {
      vi.mocked(fs.rm).mockResolvedValue(undefined);
      await adapter.deleteWorkspace('/ws/path', 'feature-1');
      expect(fs.rm).toHaveBeenCalledWith(
        expect.stringContaining(path.normalize('.nexusflow/vault/feature-1')),
        { recursive: true, force: true }
      );
    });
  });

});
