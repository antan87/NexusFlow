import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as workspace from '../core/workspace.js';
import * as refreshCore from '../core/refresh.js';
import * as resolveUtil from '../utils/resolve-workspace.js';
import { tagListCommand, tagAddCommand, tagRemoveCommand, tagShowCommand } from './tag.js';
import { verifyCommand } from './verify.js';
import * as verifyCore from '../core/verify.js';

vi.mock('../core/workspace.js');
vi.mock('../core/refresh.js');
vi.mock('../utils/resolve-workspace.js');
vi.mock('../core/verify.js');

describe('tag CLI commands', () => {
  const mockWsPath = '/workspaces/test-ws';
  const mockFeature = {
    id: 'test-ws',
    branchName: 'feat/payroll',
    description: 'Payroll Swedish collective agreement support',
    repos: ['/repo1'],
    organizationId: 'acme',
    domainPacks: ['hr/payroll'],
    workspacePath: mockWsPath,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveUtil.resolveWorkspaceInteractive).mockResolvedValue(mockWsPath);
    vi.mocked(workspace.loadFeatureConfig).mockResolvedValue({ ...mockFeature });
    vi.mocked(workspace.saveFeatureConfig).mockResolvedValue(undefined);
    vi.mocked(refreshCore.refreshWorkspace).mockResolvedValue({} as any);
  });

  describe('tagListCommand', () => {
    it('outputs tags in JSON format', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagListCommand(mockWsPath, { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.assigned).toContain('hr/payroll');
      expect(output.resolved.compositeVerifyCommand).toContain('npm test -- payroll');
      expect(output.allPacks.length).toBeGreaterThan(0);
      consoleSpy.mockRestore();
    });

    it('prints human-readable hierarchy with verticals and traits', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagListCommand(mockWsPath, {});

      expect(consoleSpy).toHaveBeenCalled();
      const calls = consoleSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(calls).toContain('Enterprise Categories & Traits');
      expect(calls).toContain('Subsystem Verticals');
      expect(calls).toContain('Horizontal Traits');
      expect(calls).toContain('GDPR & Privacy Guard');
      consoleSpy.mockRestore();
    });
  });

  describe('tagAddCommand', () => {
    it('adds a valid tag and regenerates workspace configs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagAddCommand('gdpr', mockWsPath);

      expect(workspace.saveFeatureConfig).toHaveBeenCalledWith(
        mockWsPath,
        expect.objectContaining({
          domainPacks: expect.arrayContaining(['hr/payroll', 'gdpr']),
        }),
      );
      expect(refreshCore.refreshWorkspace).toHaveBeenCalledWith(mockWsPath, { force: true });
      consoleSpy.mockRestore();
    });

    it('skips duplicate tag addition gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagAddCommand('hr/payroll', mockWsPath);

      expect(workspace.saveFeatureConfig).not.toHaveBeenCalled();
      expect(refreshCore.refreshWorkspace).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('tagRemoveCommand', () => {
    it('removes an assigned tag and regenerates configs', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagRemoveCommand('hr/payroll', mockWsPath);

      expect(workspace.saveFeatureConfig).toHaveBeenCalledWith(
        mockWsPath,
        expect.objectContaining({
          domainPacks: [],
        }),
      );
      expect(refreshCore.refreshWorkspace).toHaveBeenCalledWith(mockWsPath, { force: true });
      consoleSpy.mockRestore();
    });
  });

  describe('tagShowCommand', () => {
    it('shows tag details in JSON format', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await tagShowCommand('hr/payroll', { json: true });

      expect(consoleSpy).toHaveBeenCalled();
      const output = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(output.id).toBe('hr/payroll');
      expect(output.parent).toBe('hr');
      expect(output.microservices[0].name).toBe('payroll-engine');
      consoleSpy.mockRestore();
    });
  });

  describe('verifyCommand with tag integration', () => {
    it('passes tag option to verifyWorkspace', async () => {
      vi.mocked(verifyCore.verifyWorkspace).mockResolvedValue({
        workspacePath: mockWsPath,
        overallStatus: 'pass',
        canProgress: true,
        verifiedAt: new Date().toISOString(),
        durationMs: 120,
        repos: [],
      });

      await verifyCommand(mockWsPath, { tag: 'hr/payroll', json: true });

      expect(verifyCore.verifyWorkspace).toHaveBeenCalledWith(
        mockWsPath,
        expect.objectContaining({
          tag: 'hr/payroll',
        }),
      );
    });
  });
});
