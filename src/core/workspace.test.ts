import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { saveFeatureConfig, loadFeatureConfig } from './workspace.js';
import type { Feature } from '../types.js';

vi.mock('node:fs/promises');

describe('feature manifest persistence (A1.6)', () => {
  const workspacePath = path.resolve('/mock/workspaces/feat');
  const manifestPath = path.join(workspacePath, 'nexusflow.json');

  const feature: Feature = {
    id: 'feat',
    branchName: 'feat',
    description: 'test',
    repos: [path.join(workspacePath, 'repo-1')],
    originalRepos: [path.resolve('/dev/repo-1')],
    assistants: ['claude'],
    workspacePath,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the manifest directly to the workspace root, not via an adapter', async () => {
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    await saveFeatureConfig(workspacePath, feature);

    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, contents] = vi.mocked(fs.writeFile).mock.calls[0]!;
    expect(writtenPath).toBe(manifestPath);
    // Plain JSON — no YAML frontmatter that would break JSON.parse.
    expect(String(contents).trimStart().startsWith('{')).toBe(true);
    expect(JSON.parse(String(contents)).id).toBe('feat');
  });

  it('loads the manifest from the workspace root', async () => {
    vi.mocked(fs.readFile).mockImplementation(async (p: any) => {
      if (p === manifestPath) return JSON.stringify(feature);
      throw new Error('ENOENT');
    });

    const loaded = await loadFeatureConfig(workspacePath);
    expect(loaded?.id).toBe('feat');
  });
});
