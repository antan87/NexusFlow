import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateRepoMap, pruneEmptySections } from './map-generator.js';
import type { Language, Framework, ProjectAnalysis } from '../types.js';
import * as globby from 'globby';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

vi.mock('node:fs/promises');
vi.mock('globby');

describe('pruneEmptySections', () => {
  it('drops a section that only reports an absence', () => {
    const out = pruneEmptySections([
      '## 📄 AI Assistant Configurations', '',
      '_No pre-existing AI configurations found in this repository._', '',
    ]);

    expect(out).toEqual([]);
  });

  it('drops an empty subsection while keeping its useful sibling', () => {
    // The case that shipped: pruning only at `## ` granularity kept
    // "Static Analysis Findings" because the parent had a real dependency list.
    const out = pruneEmptySections([
      '## 💡 Detected Architectural Patterns & Usages', '',
      '### Static Analysis Findings',
      '_No architectural usage patterns detected via static analysis._', '',
      '### Packages Present (Dependencies)', '- `@acme/core-lib` (^1.0.0)', '',
    ]).join('\n');

    expect(out).not.toContain('Static Analysis Findings');
    expect(out).toContain('Detected Architectural Patterns');
    expect(out).toContain('`@acme/core-lib` (^1.0.0)');
  });

  it('drops a parent left empty by pruning all of its subsections', () => {
    const out = pruneEmptySections([
      '## 💡 Detected Architectural Patterns & Usages', '',
      '### Static Analysis Findings', '_No patterns detected._', '',
      '### Packages Present (Dependencies)', '- None recorded yet.', '',
      '## 🧪 Test Landscape', '', '- **Frameworks**: Vitest', '',
    ]).join('\n');

    expect(out).not.toContain('Detected Architectural Patterns');
    expect(out).toContain('Vitest');
  });

  it('treats template guidance comments as carrying no fact', () => {
    const out = pruneEmptySections([
      '## 📝 Discovered Conventions', '',
      '### Coding Patterns',
      '<!-- E.g., Use ErrorContent structure for errors instead of plain strings -->', '',
      '- None recorded yet.', '',
    ]);

    expect(out).toEqual([]);
  });

  it('keeps a section whose comment sits beside a real fact', () => {
    const out = pruneEmptySections([
      '## 📝 Discovered Conventions', '',
      '<!-- E.g., prefer ErrorContent -->', '',
      '- Errors use the ErrorContent structure, never plain strings.', '',
    ]).join('\n');

    expect(out).toContain('ErrorContent structure, never plain strings');
  });

  it('inspects a multi-line block pushed as one element', () => {
    // An emitter pushing a whole block as a single array entry used to read as
    // one heading line, so a section with real content was deleted.
    const out = pruneEmptySections([
      '## 📝 Discovered Conventions', '',
      '### Coding Patterns\n\n- Errors use ErrorContent, never plain strings.', '',
    ]).join('\n');

    expect(out).toContain('Discovered Conventions');
    expect(out).toContain('- Errors use ErrorContent, never plain strings.');
  });

  it('keeps content above the first heading', () => {
    const out = pruneEmptySections([
      '# Repository Architecture Map — web', '',
      '> **Repository Path**: `C:\\repos\\web`', '',
      '## 🧪 Test Landscape', '', '- **Frameworks**: Vitest',
    ]);

    expect(out[0]).toBe('# Repository Architecture Map — web');
    expect(out).toContain('> **Repository Path**: `C:\\repos\\web`');
  });
});

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
    // The map states how to verify the repo — a fact an assistant cannot get
    // from the source alone.
    expect(content).toContain('Test Landscape & Command');

    // Sections with nothing to report are omitted entirely. This fixture has no
    // runConfig, no skills and no existing AI configs, and a heading over
    // "_No … detected._" is worse than absent: it costs tokens and the context
    // file tells the agent to read this map before touching the repo.
    expect(content).not.toContain('Running Locally');
    expect(content).not.toContain('_No ');
    // Sections that DO have something stay — this fixture has a skill.
    expect(content).toContain('Custom Agent Skills');

    // It no longer guesses at routes or message topology. Those sections were
    // regex hits on call syntax: header reads and Map lookups reported as HTTP
    // endpoints, Set insertions reported as queue publishers.
    expect(content).not.toContain('API Endpoints');
    expect(content).not.toContain('Messaging Topology');
  });

  it('should render run config and skills', async () => {
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
      dependencies: [
        { name: 'my-internal-package', type: 'npm' as const },
        { name: 'eslint', type: 'npm' as const }
      ],
      ports: [],
      readmeSummary: 'A test repository.',
      existingAIConfigs: [],
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

    // What the map is still for: how to run the repo, and warnings about state
    // outside it that no amount of reading the source would reveal.
    expect(content).toContain('## ▶️ Running Locally');
    expect(content).toContain('### Entry Points');
    expect(content).toContain('npm run dev');
    expect(content).toContain('### ⚠️ Shared Infrastructure Warnings');
    expect(content).toContain('SHARED INFRA warning');

    // Only packages another repo in the workspace produces are listed; ordinary
    // third-party dependencies are already visible in the manifest.
    expect(content).toContain('my-internal-package');
    expect(content).not.toContain('eslint');
  });
});
