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
    /**
     * Routes each mocked `git` call by subcommand so a test declares only the
     * outputs it cares about; anything unspecified throws (so a strategy that
     * has no configured answer falls through to the next one).
     */
    interface BranchMockOpts {
      symbolicHeadRef?: string; // stdout of `git symbolic-ref refs/remotes/origin/HEAD`
      remoteBranches?: string; // stdout of `git branch -r`
      localBranches?: string; // stdout of `git branch --list main master`
      currentBranch?: string; // stdout of `git symbolic-ref --short HEAD`
    }

    function mockBranchGit(opts: BranchMockOpts): void {
      vi.mocked(execa).mockImplementation(((_file: any, args: any): any => {
        const a = args as string[];
        if (a[0] === 'symbolic-ref' && a[1] === 'refs/remotes/origin/HEAD') {
          if (opts.symbolicHeadRef === undefined) throw new Error('no origin/HEAD');
          return Promise.resolve({ stdout: opts.symbolicHeadRef });
        }
        if (a[0] === 'branch' && a[1] === '-r') {
          if (opts.remoteBranches === undefined) throw new Error('no remote');
          return Promise.resolve({ stdout: opts.remoteBranches });
        }
        if (a[0] === 'branch' && a[1] === '--list') {
          return Promise.resolve({ stdout: opts.localBranches ?? '' });
        }
        if (a[0] === 'symbolic-ref' && a[1] === '--short') {
          if (opts.currentBranch === undefined) throw new Error('detached HEAD');
          return Promise.resolve({ stdout: opts.currentBranch });
        }
        return Promise.resolve({ stdout: '' });
      }) as any);
    }

    it('prefers origin/HEAD symbolic-ref over everything else', async () => {
      mockBranchGit({
        symbolicHeadRef: 'refs/remotes/origin/develop\n',
        remoteBranches: '  origin/main\n  origin/develop\n',
      });

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('develop');
    });

    it('falls back to origin/main scan when origin/HEAD is unset', async () => {
      mockBranchGit({ remoteBranches: '  origin/master\n  origin/main\n' });

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('main');
      expect(execa).toHaveBeenCalledWith('git', ['branch', '-r'], { cwd: '/mock/repo' });
    });

    it('matches origin/master when origin/main is absent', async () => {
      mockBranchGit({ remoteBranches: '  origin/master\n  origin/feature-branch\n' });

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('master');
    });

    it('uses a local main/master branch when there is no remote', async () => {
      mockBranchGit({ localBranches: '* master\n' });

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('master');
    });

    it('falls back to the current branch for a remote-less repo with no main/master', async () => {
      mockBranchGit({ currentBranch: 'trunk\n' });

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('trunk');
    });

    it('falls back to main when every strategy fails', async () => {
      vi.mocked(execa).mockRejectedValue(new Error('git command failed'));

      const branch = await detectDefaultBranch('/mock/repo');

      expect(branch).toBe('main');
    });
  });
});
