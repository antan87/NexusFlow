import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { detectExistingAIConfigs } from './detect-existing.js';

describe('detectExistingAIConfigs', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'detect-existing-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('detects root CLAUDE.md and CLAUDE.local.md', async () => {
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# Claude Config');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.local.md'), '# Claude Local');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toEqual(
      expect.arrayContaining([
        {
          assistant: 'claude',
          relativePath: 'CLAUDE.md',
          contentPreview: '# Claude Config',
        },
        {
          assistant: 'claude',
          relativePath: 'CLAUDE.local.md',
          contentPreview: '# Claude Local',
        },
      ]),
    );
  });

  it('detects .claude/CLAUDE.md and .claude/CLAUDE.local.md', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Dot Claude Config');
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.local.md'), '# Dot Claude Local Config');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toEqual(
      expect.arrayContaining([
        {
          assistant: 'claude',
          relativePath: '.claude/CLAUDE.md',
          contentPreview: '# Dot Claude Config',
        },
        {
          assistant: 'claude',
          relativePath: '.claude/CLAUDE.local.md',
          contentPreview: '# Dot Claude Local Config',
        },
      ]),
    );
  });

  it('detects only .claude/CLAUDE.md when no root CLAUDE.md exists', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '# Only Dot Claude');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual({
      assistant: 'claude',
      relativePath: '.claude/CLAUDE.md',
      contentPreview: '# Only Dot Claude',
    });
  });

  it('detects only .claude/CLAUDE.local.md when no other config exists', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.local.md'), '# Only Dot Claude Local');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual({
      assistant: 'claude',
      relativePath: '.claude/CLAUDE.local.md',
      contentPreview: '# Only Dot Claude Local',
    });
  });

  it('handles empty config file with empty contentPreview', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), '');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual({
      assistant: 'claude',
      relativePath: '.claude/CLAUDE.md',
      contentPreview: '',
    });
  });

  it('detects all standard AI config locations together', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    const githubDir = path.join(tempDir, '.github');
    const cursorRulesDir = path.join(tempDir, '.cursor', 'rules');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.mkdir(githubDir, { recursive: true });
    await fs.mkdir(cursorRulesDir, { recursive: true });

    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), 'root claude');
    await fs.writeFile(path.join(tempDir, 'CLAUDE.local.md'), 'root claude local');
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.md'), 'nested claude');
    await fs.writeFile(path.join(claudeDir, 'CLAUDE.local.md'), 'nested claude local');
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), 'root agents');
    await fs.writeFile(path.join(githubDir, 'copilot-instructions.md'), 'copilot instructions');
    await fs.writeFile(path.join(tempDir, '.cursorrules'), 'cursorrules');
    await fs.writeFile(path.join(cursorRulesDir, 'rule1.mdc'), 'mdc rule 1');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toHaveLength(8);

    const relativePaths = configs.map((c) => c.relativePath);
    expect(relativePaths).toEqual([
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.claude/CLAUDE.md',
      '.claude/CLAUDE.local.md',
      'AGENTS.md',
      '.github/copilot-instructions.md',
      '.cursorrules',
      '.cursor/rules/rule1.mdc',
    ]);
  });

  it('ignores .claude directory containing unrelated files', async () => {
    const claudeDir = path.join(tempDir, '.claude');
    await fs.mkdir(claudeDir, { recursive: true });
    await fs.writeFile(path.join(claudeDir, 'settings.json'), '{}');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toEqual([]);
  });

  it('handles .claude existing as a file rather than directory without error', async () => {
    await fs.writeFile(path.join(tempDir, '.claude'), 'not a directory');

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toEqual([]);
  });

  it('truncates content preview to 500 characters', async () => {
    const longContent = 'A'.repeat(1000);
    await fs.writeFile(path.join(tempDir, 'AGENTS.md'), longContent);

    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toHaveLength(1);
    expect(configs[0].contentPreview).toHaveLength(500);
    expect(configs[0].contentPreview).toBe('A'.repeat(500));
  });

  it('returns empty array if no config files exist', async () => {
    const configs = await detectExistingAIConfigs(tempDir);
    expect(configs).toEqual([]);
  });

  it('returns empty array for non-existent path without throwing', async () => {
    const nonExistent = path.join(tempDir, 'non', 'existent', 'dir');
    const configs = await detectExistingAIConfigs(nonExistent);
    expect(configs).toEqual([]);
  });
});
