import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { scanForRepos } from './scanner.js';
import * as gitUtils from '../utils/git.js';

vi.mock('node:fs/promises');
vi.mock('../utils/git.js');

describe('scanner core module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return repository info if the root dir is a git repo', async () => {
    vi.mocked(gitUtils.isGitRepo).mockResolvedValue(true);
    vi.mocked(gitUtils.detectDefaultBranch).mockResolvedValue('main');

    const result = await scanForRepos('/mock/dev', 2);

    expect(result).toEqual([
      { name: 'dev', path: '/mock/dev', defaultBranch: 'main' }
    ]);
    expect(gitUtils.isGitRepo).toHaveBeenCalledWith('/mock/dev');
  });

  it('should recursively scan subdirectories up to limit and return repos found', async () => {
    // Root is not a git repo
    vi.mocked(gitUtils.isGitRepo).mockImplementation(async (dir) => {
      const normalized = dir.replace(/\\/g, '/');
      return normalized === '/mock/dev/repo1' || normalized === '/mock/dev/sub/repo2';
    });
    vi.mocked(gitUtils.detectDefaultBranch).mockResolvedValue('main');

    // Root directory entries
    vi.mocked(fs.readdir).mockImplementation(async (dir: any) => {
      const normalized = dir.replace(/\\/g, '/');
      if (normalized === '/mock/dev') {
        return [
          { name: 'repo1', isDirectory: () => true },
          { name: 'sub', isDirectory: () => true },
          { name: 'ignored_file.txt', isDirectory: () => false },
          { name: 'node_modules', isDirectory: () => true },
        ] as any[];
      }
      if (normalized === '/mock/dev/sub') {
        return [
          { name: 'repo2', isDirectory: () => true },
        ] as any[];
      }
      return [];
    });

    const result = await scanForRepos('/mock/dev', 2);

    expect(result).toEqual([
      { name: 'repo1', path: path.join('/mock/dev', 'repo1'), defaultBranch: 'main' },
      { name: 'repo2', path: path.join('/mock/dev', 'sub', 'repo2'), defaultBranch: 'main' }
    ]);
  });
});
