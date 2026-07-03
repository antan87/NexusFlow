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
    // Per-repo maps are base-namespace files (local adapter → per-repo subdir).
    const expectedOutPath = path.join(workspacePath, '.nexusflow', 'base', 'test-repo', 'nexusflow-map-test-repo.md');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    expect(writtenFiles[expectedOutPath]).toBeDefined();

    const content = writtenFiles[expectedOutPath]!;
    expect(content).toContain('# Repository Architecture Map — test-repo');
    expect(content).toContain('package.json');
    expect(content).toContain('my-skill');
    expect(content).toContain('GET');
    expect(content).toContain('/api/v1/users');
  });

  it('should render messaging topology, run config, and group endpoints by module', async () => {
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
        { method: 'GET', path: '/api/v1/users', source: 'src/routes/users.ts' },
        { method: 'POST', path: '/api/v1/users', source: 'src/routes/users.ts' }
      ],
      dependencies: [
        { name: 'my-internal-package', type: 'npm' as const },
        { name: 'eslint', type: 'npm' as const }
      ],
      ports: [],
      readmeSummary: 'A test repository.',
      existingAIConfigs: [],
      messaging: {
        publishers: [
          { contractType: 'OrderCreated', topicOrQueue: 'order-events', publisherFile: 'src/services/order.ts' }
        ],
        subscribers: [
          { contractType: 'OrderCreated', handlerFile: 'src/handlers/order.ts', registrationFile: 'src/index.ts' }
        ]
      },
      runConfig: {
        entryPoints: [
          { projectPath: 'package.json', type: 'node', command: 'npm run dev' }
        ],
        databases: [
          { provider: 'PostgreSQL', host: 'localhost', configFile: '.env' }
        ],
        sharedInfraWarnings: [
          { resource: 'Database', host: 'staging-db.org', configFile: '.env', warning: '⚠️ SHARED INFRA warning' }
        ],
        committedSecrets: [
          { file: '.env', lineHint: 'DATABASE_PASSWORD' }
        ],
        externalDependencies: []
      }
    };

    vi.spyOn(globby, 'globby').mockImplementation(async () => []);

    const writtenFiles: Record<string, string> = {};
    vi.spyOn(fs, 'writeFile').mockImplementation(async (filePath: any, content: any) => {
      writtenFiles[filePath as string] = content as string;
      return Promise.resolve();
    });
    vi.spyOn(fs, 'readFile').mockImplementation(async () => '## custom rule here');

    await generateRepoMap(mockRepo, mockAnalysis, workspacePath, new Set(['my-internal-package']));

    // Per-repo maps are base-namespace files (local adapter → per-repo subdir).
    const expectedOutPath = path.join(workspacePath, '.nexusflow', 'base', 'test-repo', 'nexusflow-map-test-repo.md');
    const content = writtenFiles[expectedOutPath]!;

    expect(content).toContain('## 📨 Messaging Topology');
    expect(content).toContain('OrderCreated');
    expect(content).toContain('order-events');
    expect(content).toContain('## ▶️ Running Locally');
    expect(content).toContain('### Entry Points');
    expect(content).toContain('### ⚠️ Shared Infrastructure Warnings');
    expect(content).toContain('my-internal-package');
    expect(content).not.toContain('eslint');
    expect(content).toContain('Endpoint Group (Router/Module/File)');
    expect(content).toContain('users');
  });
});
