import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { handoffCommand } from './handoff.js';
import { refreshCommand } from './refresh.js';
import { doctorCommand } from './doctor.js';
import * as workspace from '../core/workspace.js';
import * as multiGit from '../utils/multi-git.js';
import * as analyzers from '../analyzers/index.js';
import * as generators from '../generators/index.js';

vi.mock('node:fs/promises');
vi.mock('execa');
vi.mock('../core/workspace.js');
vi.mock('../utils/multi-git.js');
vi.mock('../analyzers/index.js');
vi.mock('../generators/index.js');

describe('NexusFlow CLI New Commands unit tests', () => {
  const mockWorkspacePath = path.resolve('/mock/workspace');
  const repo1Path = path.join(mockWorkspacePath, 'repo-1');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handoffCommand', () => {
    it('should generate a handoff bundle with repository status, branch and suggested files', async () => {
      const mockFeature = {
        id: 'test-feature',
        branchName: 'test-feature-branch',
        description: 'Test Feature description',
        repos: [repo1Path],
        originalRepos: [path.resolve('/mock/repo-1')],
        assistants: ['claude' as const],
        workspacePath: mockWorkspacePath,
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(mockFeature);
      vi.spyOn(multiGit, 'getRepoStatus').mockResolvedValue({
        hasChanges: true,
        changedFiles: ['src/file1.ts'],
        files: [{ code: ' M', path: 'src/file1.ts' }],
        summary: '1 file changed',
      });

      const mockAnalysis = new Map();
      mockAnalysis.set(repo1Path, {
        name: 'repo-1',
        path: repo1Path,
        techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'backend' },
        endpoints: [],
        dependencies: [],
        ports: [],
        readmeSummary: 'README summary',
        existingAIConfigs: [],
      });
      vi.spyOn(analyzers, 'analyzeAllReposCached').mockResolvedValue({
        analysis: mockAnalysis,
        analyzed: ['repo-1'],
        reused: [],
      });

      const writtenFiles: Record<string, string> = {};
      vi.spyOn(fs, 'writeFile').mockImplementation(async (filePath: any, content: any) => {
        writtenFiles[path.resolve(filePath as string)] = content as string;
        return Promise.resolve();
      });

      // Run handoff command
      await handoffCommand(mockWorkspacePath);

      const expectedHandoffPath = path.resolve(path.join(mockWorkspacePath, 'nexusflow-handoff.md'));
      expect(fs.writeFile).toHaveBeenCalled();
      expect(writtenFiles[expectedHandoffPath]).toBeDefined();

      const content = writtenFiles[expectedHandoffPath]!;
      expect(content).toContain('# NexusFlow Handoff Bundle — test-feature-branch');
      expect(content).toContain('repo-1');
      expect(content).toContain('1 file changed');
      expect(content).toContain('src/file1.ts');
    });
  });

  describe('refreshCommand', () => {
    it('should trigger context regeneration and optional repack', async () => {
      const mockFeature = {
        id: 'test-feature',
        branchName: 'test-feature-branch',
        description: 'Test Feature description',
        repos: [repo1Path],
        originalRepos: [path.resolve('/mock/repo-1')],
        assistants: ['claude' as const],
        workspacePath: mockWorkspacePath,
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(mockFeature);
      vi.spyOn(analyzers, 'analyzeAllReposCached').mockResolvedValue({
        analysis: new Map(),
        analyzed: ['repo-1'],
        reused: [],
      });
      vi.spyOn(generators, 'generateContextFiles').mockResolvedValue(undefined);

      // Run refresh command with repo filter
      await refreshCommand({ repo: 'repo-1' }, mockWorkspacePath);

      expect(analyzers.analyzeAllReposCached).toHaveBeenCalled();
      expect(generators.generateContextFiles).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Array),
        mockWorkspacePath,
        'repo-1',
        undefined,
        ['repo-1']
      );
    });
  });

  describe('doctorCommand', () => {
    it('should complete health check successfully', async () => {
      const mockFeature = {
        id: 'test-feature',
        branchName: 'test-feature-branch',
        description: 'Test Feature description',
        repos: [repo1Path],
        originalRepos: [path.resolve('/mock/repo-1')],
        assistants: ['claude' as const],
        workspacePath: mockWorkspacePath,
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(mockFeature);
      vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true } as any);
      vi.spyOn(multiGit, 'getRepoStatus').mockResolvedValue({
        hasChanges: false,
        changedFiles: [],
        files: [],
        summary: 'Clean',
      });

      const mockAnalysis = new Map();
      mockAnalysis.set(repo1Path, {
        name: 'repo-1',
        path: repo1Path,
        techStack: { languages: ['typescript'], frameworks: [], buildTools: [], projectType: 'backend' },
        endpoints: [],
        dependencies: [],
        ports: [],
        readmeSummary: 'README summary',
        existingAIConfigs: [],
      });
      vi.spyOn(analyzers, 'analyzeAllReposCached').mockResolvedValue({
        analysis: mockAnalysis,
        analyzed: ['repo-1'],
        reused: [],
      });
      vi.spyOn(fs, 'access').mockResolvedValue(undefined); // covers .code-workspace + artifact checks
      vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({ "search.useIgnoreFiles": false }));

      // Run doctor command
      await doctorCommand(mockWorkspacePath);

      expect(workspace.loadFeatureConfig).toHaveBeenCalledWith(mockWorkspacePath);
      expect(fs.stat).toHaveBeenCalledWith(repo1Path);
      expect(analyzers.analyzeAllReposCached).toHaveBeenCalled();
    });
  });
});
