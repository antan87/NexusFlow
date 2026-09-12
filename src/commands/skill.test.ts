import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as skillsCatalog from '../utils/skills-catalog.js';
import * as resolveUtil from '../utils/resolve-workspace.js';
import * as refreshCore from '../core/refresh.js';
import { skillListCommand, skillCreateCommand, skillDeleteCommand, skillShowCommand } from './skill.js';

vi.mock('../utils/skills-catalog.js');
vi.mock('../utils/resolve-workspace.js');
vi.mock('../core/refresh.js');

describe('skill CLI commands', () => {
  const mockWsPath = '/workspaces/test-workspace';
  const sampleSkills: skillsCatalog.SkillItem[] = [
    {
      id: 'local-test-skill',
      name: 'local-test-skill',
      title: 'Local Test Skill',
      description: 'Skill scoped to workspace',
      content: 'Instructions for local',
      category: 'testing',
      scope: 'workspace',
      tags: ['test', 'local'],
    },
    {
      id: 'global-standard-skill',
      name: 'global-standard-skill',
      title: 'Global Standard Skill',
      description: 'Company-wide standard',
      content: 'Instructions for global',
      category: 'standards',
      scope: 'global',
      tags: ['company', 'standards'],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveUtil.resolveWorkspaceInteractive).mockResolvedValue(mockWsPath);
    vi.mocked(resolveUtil.resolveWorkspaceQuiet).mockImplementation(async (arg?: string) => (arg ? mockWsPath : null));
    vi.mocked(skillsCatalog.getAllSkills).mockResolvedValue([...sampleSkills]);
    vi.mocked(skillsCatalog.saveSkill).mockImplementation(async (skill: any) => ({
      ...skill,
      path: `/mock/path/${skill.id}/SKILL.md`,
    }));
    vi.mocked(skillsCatalog.deleteSkill).mockResolvedValue(undefined);
    vi.mocked(refreshCore.refreshWorkspace).mockResolvedValue({} as any);
  });

  describe('skillListCommand', () => {
    it('outputs skills in JSON format', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillListCommand(mockWsPath, { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.length).toBe(2);
      expect(output[0].id).toBe('local-test-skill');
      consoleSpy.mockRestore();
    });

    it('filters by scope', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillListCommand(mockWsPath, { json: true, scope: 'workspace' });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.length).toBe(1);
      expect(output[0].id).toBe('local-test-skill');
      consoleSpy.mockRestore();
    });

    it('filters by tag', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillListCommand(mockWsPath, { json: true, tag: 'company' });

      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.length).toBe(1);
      expect(output[0].id).toBe('global-standard-skill');
      consoleSpy.mockRestore();
    });

    it('prints human readable output grouping workspace and global skills', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillListCommand(mockWsPath, {});

      const calls = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(calls).toContain('Agent Skills');
      expect(calls).toContain('Workspace-Specific Skills');
      expect(calls).toContain('Global Company Skills');
      expect(calls).toContain('local-test-skill');
      expect(calls).toContain('global-standard-skill');
      consoleSpy.mockRestore();
    });

    it('lists skills quietly without interactive prompt when outside workspace', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillListCommand(undefined, {});

      expect(resolveUtil.resolveWorkspaceInteractive).not.toHaveBeenCalled();
      expect(skillsCatalog.getAllSkills).toHaveBeenCalledWith(undefined);
      consoleSpy.mockRestore();
    });
  });

  describe('skillCreateCommand', () => {
    it('creates a workspace-scoped skill and triggers workspace refresh', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillCreateCommand('invoice-calc', mockWsPath, {
        title: 'Invoice Calculator',
        description: 'Calculates invoices accurately',
        content: '# Invoice Calc\nRun math.',
        tags: ['billing'],
        scope: 'workspace',
      });

      expect(skillsCatalog.saveSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'invoice-calc',
          title: 'Invoice Calculator',
          tags: ['billing'],
        }),
        expect.objectContaining({
          scope: 'workspace',
          workspacePath: mockWsPath,
        }),
      );
      expect(refreshCore.refreshWorkspace).toHaveBeenCalledWith(mockWsPath, { force: true });
      consoleSpy.mockRestore();
    });

    it('creates a global skill without workspace refresh', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillCreateCommand('company-lint', undefined, {
        title: 'Company Linter',
        scope: 'global',
      });

      expect(skillsCatalog.saveSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'company-lint',
          title: 'Company Linter',
        }),
        expect.objectContaining({
          scope: 'global',
        }),
      );
      expect(refreshCore.refreshWorkspace).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('skillDeleteCommand', () => {
    it('deletes a skill and refreshes workspace if workspace path is present', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillDeleteCommand('local-test-skill', mockWsPath, { scope: 'workspace' });

      expect(skillsCatalog.deleteSkill).toHaveBeenCalledWith(
        'local-test-skill',
        expect.objectContaining({
          scope: 'workspace',
          workspacePath: mockWsPath,
        }),
      );
      expect(refreshCore.refreshWorkspace).toHaveBeenCalledWith(mockWsPath, { force: true });
      consoleSpy.mockRestore();
    });

    it('deletes a global skill without workspace or prompt when scope is global', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillDeleteCommand('global-standard-skill', undefined, { scope: 'global' });

      expect(resolveUtil.resolveWorkspaceInteractive).not.toHaveBeenCalled();
      expect(skillsCatalog.deleteSkill).toHaveBeenCalledWith(
        'global-standard-skill',
        expect.objectContaining({
          scope: 'global',
        }),
      );
      expect(refreshCore.refreshWorkspace).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('skillShowCommand', () => {
    it('outputs skill details in JSON format', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillShowCommand('local-test-skill', mockWsPath, { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.id).toBe('local-test-skill');
      expect(output.title).toBe('Local Test Skill');
      expect(output.description).toBe('Skill scoped to workspace');
      consoleSpy.mockRestore();
    });

    it('prints human-readable skill details including metadata and content', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillShowCommand('local-test-skill', mockWsPath, {});

      const calls = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(calls).toContain('Local Test Skill');
      expect(calls).toContain('local-test-skill');
      expect(calls).toContain('Workspace-local');
      expect(calls).toContain('Skill scoped to workspace');
      expect(calls).toContain('Instructions for local');
      consoleSpy.mockRestore();
    });

    it('shows global skill quietly without workspace or prompt when outside workspace', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await skillShowCommand('global-standard-skill', undefined, {});

      expect(resolveUtil.resolveWorkspaceInteractive).not.toHaveBeenCalled();
      expect(skillsCatalog.getAllSkills).toHaveBeenCalledWith(undefined);
      const calls = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(calls).toContain('Global Standard Skill');
      consoleSpy.mockRestore();
    });

    it('handles skill not found with error message and exitCode 1', async () => {
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        await skillShowCommand('non-existent-skill', mockWsPath, {});
        expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
        consoleErrSpy.mockRestore();
      }
    });

    it('handles empty skill id with error and exitCode 1', async () => {
      const consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const originalExitCode = process.exitCode;
      try {
        await skillShowCommand('   ', mockWsPath, {});
        expect(consoleErrSpy).toHaveBeenCalledWith(expect.stringContaining('Skill ID is required'));
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
        consoleErrSpy.mockRestore();
      }
    });
  });
});
