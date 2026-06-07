import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
import { isGitRepo, gitFetch, detectDefaultBranch } from './git.js';

vi.mock('node:fs/promises');
vi.mock('execa');

describe('git utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isGitRepo', () => {
    it('should return true if .git directory exists and is accessible', async () => {
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await isGitRepo('/mock/repo');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(path.join('/mock/repo', '.git'));
    });

    it('should return false if .git directory is not accessible', async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

      const result = await isGitRepo('/mock/repo');

      expect(result).toBe(false);
    });
  });

  describe('gitFetch', () => {
    it('should run git fetch origin', async () => {
      vi.mocked(execa).mockResolvedValue({} as any);

      await gitFetch('/mock/repo');

      expect(execa).toHaveBeenCalledWith('git', ['fetch', 'origin'], { cwd: '/mock/repo' });
    });
  });

  describe('detectDefaultBranch', () => {
    it('should prefer main over master', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '  origin/master\n  origin/main\n'
      } as any);

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('main');
      expect(execa).toHaveBeenCalledWith('git', ['branch', '-r'], { cwd: '/mock/repo' });
    });

    it('should match master if main is not present', async () => {
      vi.mocked(execa).mockResolvedValue({
        stdout: '  origin/master\n  origin/feature-branch\n'
      } as any);

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('master');
    });

    it('should fallback to main if neither is present or command fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('git command failed'));

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('main');
    });
  });
});
