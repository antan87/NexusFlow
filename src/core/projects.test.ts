import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  getProjectsFilePath,
  slugifyProjectName,
  loadProjects,
  getProject,
  createProject,
  updateProject,
  removeProject,
} from './projects.js';
import * as git from '../utils/git.js';

vi.mock('node:fs/promises');
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    homedir: vi.fn(),
  };
});
vi.mock('../utils/git.js', () => ({
  isGitRepo: vi.fn(),
  detectDefaultBranch: vi.fn(),
}));

/** Returns the JSON written by the last saveProjects call. */
function lastWrittenRegistry(): { version: number; projects: unknown[] } {
  const calls = vi.mocked(fs.writeFile).mock.calls;
  const registryWrites = calls.filter(([target]) => String(target).includes('projects.json'));
  expect(registryWrites.length).toBeGreaterThan(0);
  return JSON.parse(String(registryWrites[registryWrites.length - 1][1]));
}

function mockRegistryContent(projects: unknown[]): void {
  vi.mocked(fs.readFile).mockResolvedValue(
    JSON.stringify({ version: 1, projects }),
  );
}

const existingProject = {
  id: 'billing',
  name: 'Billing',
  repos: [{ path: '/mock/dev/api', defaultBranch: 'main' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('projects core module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue('/mock/home');
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(git.isGitRepo).mockResolvedValue(true);
    vi.mocked(git.detectDefaultBranch).mockResolvedValue('main');
  });

  describe('getProjectsFilePath', () => {
    it('lives inside ~/.nexusflow', () => {
      expect(getProjectsFilePath().replace(/\\/g, '/')).toContain('.nexusflow/projects.json');
    });
  });

  describe('slugifyProjectName', () => {
    it('lowercases and hyphenates', () => {
      expect(slugifyProjectName('Hogia Billing')).toBe('hogia-billing');
    });

    it('collapses consecutive separators and trims edges', () => {
      expect(slugifyProjectName('  My -- Great__Project!  ')).toBe('my-great-project');
    });

    it('returns empty string for names with no usable characters', () => {
      expect(slugifyProjectName('!!!')).toBe('');
    });
  });

  describe('loadProjects', () => {
    it('returns empty list when the registry file is missing', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      expect(await loadProjects()).toEqual([]);
    });

    it('returns registered projects', async () => {
      mockRegistryContent([existingProject]);
      const projects = await loadProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('billing');
    });

    it('treats corrupted JSON as empty and warns', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('{not json');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await loadProjects()).toEqual([]);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('getProject', () => {
    it('finds a project by id', async () => {
      mockRegistryContent([existingProject]);
      expect((await getProject('billing'))?.name).toBe('Billing');
    });

    it('returns null for unknown ids', async () => {
      mockRegistryContent([existingProject]);
      expect(await getProject('nope')).toBeNull();
    });
  });

  describe('createProject', () => {
    beforeEach(() => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
    });

    it('creates a project with resolved repos and timestamps', async () => {
      const project = await createProject('My App', ['/mock/dev/api', '/mock/dev/web']);

      expect(project.id).toBe('my-app');
      expect(project.repos).toEqual([
        { path: expect.stringContaining('api'), defaultBranch: 'main' },
        { path: expect.stringContaining('web'), defaultBranch: 'main' },
      ]);
      expect(project.createdAt).toBe(project.updatedAt);

      const written = lastWrittenRegistry();
      expect(written.version).toBe(1);
      expect(written.projects).toHaveLength(1);
    });

    it('writes via temp file then renames (atomic)', async () => {
      await createProject('My App', ['/mock/dev/api']);
      const writtenTo = String(vi.mocked(fs.writeFile).mock.calls.at(-1)![0]);
      expect(writtenTo.endsWith('.tmp')).toBe(true);
      expect(fs.rename).toHaveBeenCalledWith(
        writtenTo,
        expect.stringContaining('projects.json'),
      );
    });

    it('dedupes repeated repo paths', async () => {
      const project = await createProject('My App', ['/mock/dev/api', '/mock/dev/api']);
      expect(project.repos).toHaveLength(1);
    });

    it('rejects an empty name', async () => {
      await expect(createProject('   ', ['/mock/dev/api'])).rejects.toThrow('empty');
    });

    it('rejects a duplicate id', async () => {
      mockRegistryContent([existingProject]);
      await expect(createProject('Billing', ['/mock/dev/api'])).rejects.toThrow('already exists');
    });

    it('rejects a non-git repo path', async () => {
      vi.mocked(git.isGitRepo).mockResolvedValue(false);
      await expect(createProject('My App', ['/mock/dev/not-a-repo'])).rejects.toThrow('Not a git repository');
    });

    it('rejects an empty repo list', async () => {
      await expect(createProject('My App', [])).rejects.toThrow('at least one repository');
    });
  });

  describe('updateProject', () => {
    beforeEach(() => {
      mockRegistryContent([existingProject]);
    });

    it('renames without changing the id', async () => {
      const updated = await updateProject('billing', { name: 'Billing v2' });
      expect(updated.id).toBe('billing');
      expect(updated.name).toBe('Billing v2');
      expect(updated.updatedAt).not.toBe(existingProject.updatedAt);
    });

    it('replaces the repo list when repoPaths given', async () => {
      vi.mocked(git.detectDefaultBranch).mockResolvedValue('master');
      const updated = await updateProject('billing', { repoPaths: ['/mock/dev/other'] });
      expect(updated.repos).toEqual([
        { path: expect.stringContaining('other'), defaultBranch: 'master' },
      ]);
    });

    it('throws for an unknown id', async () => {
      await expect(updateProject('nope', { name: 'X' })).rejects.toThrow('No project');
    });
  });

  describe('removeProject', () => {
    it('removes an existing project', async () => {
      mockRegistryContent([existingProject]);
      expect(await removeProject('billing')).toBe(true);
      expect(lastWrittenRegistry().projects).toHaveLength(0);
    });

    it('returns false when the project does not exist', async () => {
      mockRegistryContent([existingProject]);
      expect(await removeProject('nope')).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
});
