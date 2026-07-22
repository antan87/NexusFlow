import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { getConfigDir, getDefaultConfig, ensureConfigDir, loadConfig, saveConfig } from './config.js';

vi.mock('node:fs/promises');
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe('config core module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
  });

  describe('getConfigDir', () => {
    it('should return path based on home directory', () => {
      const dir = getConfigDir();
      expect(dir).toContain('.nexusflow');
    });
  });

  describe('getDefaultConfig', () => {
    it('should return config with defaults populated', () => {
      const config = getDefaultConfig();
      expect(config.version).toBe('1.0.0');
      expect(config.scanDepth).toBe(2);
    });
  });

  describe('ensureConfigDir', () => {
    it('should invoke fs.mkdir with correct options', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);

      await ensureConfigDir();

      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.nexusflow'), { recursive: true });
    });
  });

  describe('loadConfig', () => {
    it('should load config if file exists', async () => {
      const savedConfig = {
        devDir: '/custom/dev',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(savedConfig));

      const config = await loadConfig();

      expect(config.devDir).toBe('/custom/dev');

      // Should merge with defaults
      expect(config.scanDepth).toBe(2);
    });

    it('should return default config if read fails', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const config = await loadConfig();

      expect(config.version).toBe('1.0.0');
    });

    it('warns and falls back to local on an unknown storage provider', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ storageProvider: 'bogus' }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await loadConfig();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('bogus'));
      expect(config.storageProvider).toBe('bogus');
      warn.mockRestore();
    });

    it('suppresses the storage-fallback warning when quiet', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ storageProvider: 'bogus' }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await loadConfig({ quiet: true });

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('warns and returns defaults on invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{ this is not valid json ');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const config = await loadConfig();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
      expect(config.version).toBe('1.0.0');
      warn.mockRestore();
    });
  });

  describe('saveConfig', () => {
    it('should create directory and save configuration', async () => {
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const config = getDefaultConfig();
      config.devDir = '/custom/saved/dev';

      await saveConfig(config);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('/custom/saved/dev'),
        'utf-8'
      );
    });
  });
});
