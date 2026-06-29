import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { LocalStorageAdapter } from './local-storage.js';
import { CentralVaultAdapter } from './vault-storage.js';
import { ObsidianStorageAdapter } from './obsidian-storage.js';

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

  describe('ObsidianStorageAdapter', () => {
    it('should declare correct meta and configuration settings', () => {
      const adapter = new ObsidianStorageAdapter();
      expect(adapter.meta.name).toBe('obsidian');
      expect(adapter.meta.configFields.some(f => f.key === 'vaultPath')).toBe(true);
    });

    it('should respect custom vaultPath configuration', async () => {
      const adapter = new ObsidianStorageAdapter();
      adapter.configure({ vaultPath: '/custom/obsidian/vault' });

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeWorkspaceFile('/ws/path', 'feature-1', 'test.txt', 'hello');

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.normalize('/custom/obsidian/vault/nexusflow/workspaces/feature-1/test.txt'),
        expect.any(String),
        'utf8'
      );
    });

    it('should wrap content with YAML frontmatter by default', async () => {
      const adapter = new ObsidianStorageAdapter();
      adapter.configure({ vaultPath: '/custom/obsidian/vault', addFrontmatter: true });

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeWorkspaceFile('/ws/path', 'feature-1', 'test.txt', 'hello');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('tags: ["feature-1", "workspace"]'),
        'utf8'
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('generator: nexusflow'),
        'utf8'
      );
    });

    it('should not wrap content with frontmatter if addFrontmatter is disabled', async () => {
      const adapter = new ObsidianStorageAdapter();
      adapter.configure({ vaultPath: '/custom/obsidian/vault', addFrontmatter: false });

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await adapter.writeWorkspaceFile('/ws/path', 'feature-1', 'test.txt', 'hello');

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        'hello',
        'utf8'
      );
    });

    it('should delete workspace folder from custom vault path under nexusflow', async () => {
      const adapter = new ObsidianStorageAdapter();
      adapter.configure({ vaultPath: '/custom/obsidian/vault' });
      vi.mocked(fs.rm).mockResolvedValue(undefined);

      await adapter.deleteWorkspace('/ws/path', 'feature-1');

      expect(fs.rm).toHaveBeenCalledWith(
        path.normalize('/custom/obsidian/vault/nexusflow/workspaces/feature-1'),
        { recursive: true, force: true }
      );
    });
  });
});
