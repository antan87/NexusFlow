import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packWorkspace } from './packer.js';
import * as workspace from './workspace.js';
import * as repomix from 'repomix';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock dependencies
vi.mock('./workspace.js');
vi.mock('repomix');

describe('packWorkspace', () => {
  const workspacePath = path.join(__dirname, '..', '..', 'temp-test-workspace');

  beforeEach(async () => {
    await fs.mkdir(workspacePath, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(workspacePath, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('should successfully pack a workspace and stream repomix output', async () => {
    // 1. Mock the workspace config
    const mockFeature = {
      id: 'test-feature',
      description: 'Test description',
      repos: [path.join(workspacePath, 'repo-a')]
    };
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(mockFeature as any);

    // Create fake repo directory so fs.access passes
    await fs.mkdir(path.join(workspacePath, 'repo-a'), { recursive: true });

    // 2. Mock repomix runCli
    vi.spyOn(repomix, 'runCli').mockImplementation(async (dirs, cwd, options) => {
      // Create the expected output file to simulate repomix success
      if (options && options.output) {
        await fs.writeFile(options.output as string, '<file path="test.txt">mock repomix content</file>\n', 'utf-8');
      }
      return {
        packResult: {
          totalFiles: 42,
          totalCharacters: 9001,
          totalTokens: 100,
          fileCharCounts: {},
          fileTokenCounts: {}
        },
        suspiciousFilesResults: [],
        config: {} as any
      } as any;
    });

    // 3. Run the packer
    const result = await packWorkspace(workspacePath);

    // 4. Assertions
    expect(result.totalFiles).toBe(42);
    expect(result.totalCharacters).toBe(9001);
    expect(result.fileSize).toBeGreaterThan(0);
    
    // Read the generated output file and verify streaming combination works
    const outputContent = await fs.readFile(result.outputPath, 'utf-8');
    expect(outputContent).toContain('<workspace id="test-feature">');
    expect(outputContent).toContain('<repository name="repo-a">');
    expect(outputContent).toContain('<file path="test.txt">mock repomix content</file>');
    
    // Verify repomix was called correctly
    expect(repomix.runCli).toHaveBeenCalledTimes(1);
  });

  it('should skip repos that do not exist', async () => {
    const mockFeature = {
      id: 'test-feature',
      description: 'Test description',
      repos: [path.join(workspacePath, 'non-existent-repo')]
    };
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(mockFeature as any);
    
    // We intentionally don't create the directory 'non-existent-repo'

    const result = await packWorkspace(workspacePath);

    expect(result.totalFiles).toBe(0);
    expect(result.totalCharacters).toBe(0);
    
    const outputContent = await fs.readFile(result.outputPath, 'utf-8');
    expect(outputContent).not.toContain('<repository'); // Should have no repositories
  });

  it('should throw if workspace feature config is not found', async () => {
    vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue(null);

    await expect(packWorkspace(workspacePath)).rejects.toThrow(/Workspace not found/);
  });
});
