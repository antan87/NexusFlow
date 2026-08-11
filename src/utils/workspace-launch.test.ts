import { beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';

import {
  detectWorkspaceLaunchTargets,
  hasDesktopProtocol,
  launchTargetIdForEditorCommand,
  launchWorkspaceTarget,
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
    const workspacePath = 'C:\\dev\\work spaces\\one & two';

    await launchWorkspaceTarget('codex-desktop', workspacePath);

    expect(execa).toHaveBeenCalledWith(
      'explorer.exe',
      [`codex://threads/new?path=${encodeURIComponent(workspacePath)}`],
      { shell: false },
    );
  });

  it('never maps arbitrary commands to launch targets', () => {
    expect(launchTargetIdForEditorCommand('code')).toBe('vscode');
    expect(launchTargetIdForEditorCommand('code && calc.exe')).toBeNull();
  });

  it('rejects unknown targets before launching anything', async () => {
    await expect(launchWorkspaceTarget('editor:../../calc', 'C:\\dev\\workspace')).rejects.toThrow(
      'Unknown workspace launch target',
    );
    expect(execa).not.toHaveBeenCalled();
  });
});
