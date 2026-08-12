import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import * as path from 'node:path';

import {
  buildWorkspaceLaunchPrompt,
  detectWorkspaceLaunchTargets,
  hasDesktopProtocol,
  launchTargetIdForEditorCommand,
  launchWorkspaceTarget,
  openDesktopUri,
} from './workspace-launch.js';

vi.mock('execa');
vi.mock('./detect-editors.js', () => ({
  detectEditors: vi.fn().mockResolvedValue([
    { name: 'VS Code', command: 'code', detected: true },
    { name: 'VS Code Insiders', command: 'code-insiders', detected: false },
  ]),
}));
vi.mock('./open-editor.js', () => ({ openInEditor: vi.fn().mockResolvedValue(undefined) }));

describe('workspace launch catalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('detects a Windows protocol association without using a shell', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

    await expect(hasDesktopProtocol({ scheme: 'codex', macAppNames: [] }, 'win32')).resolves.toBe(true);
    expect(execa).toHaveBeenCalledWith(
      'reg.exe',
      ['query', 'HKCU\\Software\\Classes\\codex'],
      { reject: false, shell: false },
    );
  });

  it('detects and activates Claude Desktop links on Linux', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'claude.desktop\n' } as any);

    await expect(hasDesktopProtocol({ scheme: 'claude', macAppNames: [] }, 'linux')).resolves.toBe(true);
    expect(execa).toHaveBeenCalledWith(
      'xdg-mime',
      ['query', 'default', 'x-scheme-handler/claude'],
      { reject: false, shell: false },
    );

    await openDesktopUri('claude://code/new?folder=%2Ftmp%2Fworkspace', 'linux');
    expect(execa).toHaveBeenCalledWith(
      'xdg-open',
      ['claude://code/new?folder=%2Ftmp%2Fworkspace'],
      { shell: false },
    );
  });

  it('does not advertise Codex Desktop on Linux', async () => {
    await expect(hasDesktopProtocol({ scheme: 'codex', macAppNames: [] }, 'linux')).resolves.toBe(false);
    expect(execa).not.toHaveBeenCalled();
  });

  it('returns unavailable targets with useful reasons', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 1 } as any);

    const targets = await detectWorkspaceLaunchTargets();

    expect(targets.find((target) => target.id === 'codex-desktop')).toMatchObject({
      kind: 'ai-app',
      available: false,
    });
    expect(targets.find((target) => target.id === 'vscode')).toMatchObject({
      kind: 'editor',
      available: true,
    });
    expect(targets.find((target) => target.id === 'vscode-insiders')).toMatchObject({
      available: false,
      unavailableReason: expect.stringMatching(/not detected/i),
    });
  });

  it('builds a once-encoded Codex URI and activates it without a shell', async () => {
    vi.mocked(execa).mockImplementation((async (command: any): Promise<any> => ({
      exitCode: command === 'reg.exe' ? 0 : 0,
    })) as any);
    const workspacePath = path.resolve('work spaces', 'one & two');
    const prompt = buildWorkspaceLaunchPrompt({ description: 'Fix launch & resume' });

    await launchWorkspaceTarget('codex-desktop', workspacePath, { kind: 'new-workspace', prompt }, 'win32');

    expect(execa).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/v:off', '/s', '/c', 'start "" "%NEXUSFLOW_DESKTOP_URI%"'],
      {
        env: {
          NEXUSFLOW_DESKTOP_URI:
            `codex://threads/new?path=${encodeURIComponent(workspacePath)}&prompt=${encodeURIComponent(prompt)}`,
        },
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
  });

  it('uses the documented Windows URI dispatcher without reparsing encoded values', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);
    const uri = 'claude://code/new?folder=C%3A%5Cwork%5Cnexus&q=Fix%20one%20%26%20two';

    await openDesktopUri(uri, 'win32');

    expect(execa).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/v:off', '/s', '/c', 'start "" "%NEXUSFLOW_DESKTOP_URI%"'],
      {
        env: { NEXUSFLOW_DESKTOP_URI: uri },
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
  });

  it('rejects an unsafe Windows desktop URI before invoking cmd.exe', async () => {
    await expect(openDesktopUri('https://example.com', 'win32')).rejects.toThrow(
      'Unsupported desktop URI',
    );
    expect(execa).not.toHaveBeenCalled();
  });

  it('does not expose a Windows desktop URI when activation fails', async () => {
    const uri = 'claude://code/new?folder=C%3A%5Cprivate-workspace&q=Private%20task';
    vi.mocked(execa).mockRejectedValue(new Error(`Command failed: cmd.exe ${uri}`));

    const result = openDesktopUri(uri, 'win32');

    await expect(result).rejects.toThrow('Windows could not open the selected desktop app');
    await expect(result).rejects.not.toThrow(/claude:\/\/|private-workspace|Private%20task/);
  });

  it('builds a once-encoded Claude URI with the workspace kickoff', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'claude.desktop\n' } as any);
    const workspacePath = path.resolve('work spaces', 'claude & nexusflow');
    const prompt = buildWorkspaceLaunchPrompt({ description: 'Continue the integration' });

    await launchWorkspaceTarget('claude-desktop', workspacePath, { kind: 'new-workspace', prompt }, 'linux');

    expect(execa).toHaveBeenCalledWith(
      'xdg-open',
      [`claude://code/new?folder=${encodeURIComponent(workspacePath)}&q=${encodeURIComponent(prompt)}`],
      { shell: false },
    );
  });

  it('keeps a truncated emoji-bearing kickoff well-formed for URI encoding', () => {
    const basePrompt = buildWorkspaceLaunchPrompt({ description: '' });
    const marker = '\n\nWorkspace task: ';
    const remaining = 1_600 - basePrompt.length - marker.length;
    const description = `${'a'.repeat(remaining - 1)}😀tail`;

    const prompt = buildWorkspaceLaunchPrompt({ description });

    expect(prompt.length).toBeLessThanOrEqual(1_600);
    expect(() => encodeURIComponent(prompt)).not.toThrow();
    expect(prompt.endsWith('a')).toBe(true);
  });

  it('opens an existing Codex thread by its validated technical id', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);
    const workspacePath = path.resolve('workspace');
    const sessionId = '0199a213-81c0-7800-8aa1-bbab2a035a53';

    await launchWorkspaceTarget(
      'codex-desktop',
      workspacePath,
      { kind: 'resume-session', sessionId },
      'win32',
    );

    expect(execa).toHaveBeenCalledWith(
      'cmd.exe',
      ['/d', '/v:off', '/s', '/c', 'start "" "%NEXUSFLOW_DESKTOP_URI%"'],
      {
        env: { NEXUSFLOW_DESKTOP_URI: `codex://threads/${sessionId}` },
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: true,
      },
    );
  });

  it('does not claim that Claude Desktop can resume a local Code session', async () => {
    vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'claude.desktop\n' } as any);

    await expect(launchWorkspaceTarget(
      'claude-desktop',
      path.resolve('workspace'),
      { kind: 'resume-session', sessionId: '0199a213-81c0-7800-8aa1-bbab2a035a53' },
      'linux',
    )).rejects.toThrow(/does not support/i);

    expect(execa).not.toHaveBeenCalledWith('xdg-open', expect.anything(), expect.anything());
  });

  it('never maps arbitrary commands to launch targets', () => {
    expect(launchTargetIdForEditorCommand('code')).toBe('vscode');
    expect(launchTargetIdForEditorCommand('code && calc.exe')).toBeNull();
  });

  it('rejects unknown targets before launching anything', async () => {
    await expect(launchWorkspaceTarget('editor:../../calc', path.resolve('workspace'))).rejects.toThrow(
      'Unknown workspace launch target',
    );
    expect(execa).not.toHaveBeenCalled();
  });
});
