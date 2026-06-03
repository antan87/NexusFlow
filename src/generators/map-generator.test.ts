import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRepoMap } from './map-generator.js';
import type { Language, Framework, ProjectAnalysis } from '../types.js';
import * as globby from 'globby';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

vi.mock('node:fs/promises');
vi.mock('globby');

describe('generateRepoMap', () => {
  const workspacePath = path.join(__dirname, '..', '..', 'temp-test-workspace');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate a markdown map file with correct structure and links', async () => {
    // 1. Mock inputs
    const mockRepo = {
      name: 'test-repo',
      path: '/original/path/test-repo',
      defaultBranch: 'main',
    };

    const mockAnalysis: ProjectAnalysis = {
      name: 'test-repo',
      path: '/original/path/test-repo',
      techStack: {
        languages: ['typescript' as Language],
        frameworks: ['react' as Framework],
        buildTools: ['vite'],
        projectType: 'frontend' as const,
      },
      endpoints: [
        { method: 'GET', path: '/api/v1/users', source: 'src/controllers/users.ts' }
      ],
      dependencies: [
        { name: 'react', type: 'npm' as const }
      ],
      ports: [],
      readmeSummary: 'A test repository.',
      existingAIConfigs: [],
    };

    // Mock globby returns
    vi.spyOn(globby, 'globby').mockImplementation(async (pattern: any) => {
      const pat = typeof pattern === 'string' ? pattern : (pattern[0] || '');
      if (pat.includes('**/*.sln')) return [];
      if (pat.includes('**/*.csproj')) return [];
      if (pat.includes('package.json')) return ['package.json'];
      if (pat.includes('SKILL.md')) return ['skills/my-skill/SKILL.md'];
      return [];
    });

    const writtenFiles: Record<string, string> = {};
    vi.spyOn(fs, 'writeFile').mockImplementation(async (filePath: any, content: any) => {
      writtenFiles[filePath as string] = content as string;
      return Promise.resolve();
    });

    // 2. Run generator
    await generateRepoMap(mockRepo, mockAnalysis, workspacePath);

    // 3. Assertions
    const expectedOutPath = path.join(workspacePath, 'nexusflow-map-test-repo.md');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(writtenFiles[expectedOutPath]).toBeDefined();

    const content = writtenFiles[expectedOutPath]!;
    expect(content).toContain('# Repository Architecture Map — test-repo');
    expect(content).toContain('package.json');
    expect(content).toContain('my-skill');
    expect(content).toContain('GET');
    expect(content).toContain('/api/v1/users');
  });
});
