import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildHarnessCliCommand,
  launchWorkspaceTerminal,
  formatTerminalTitle,
  escapePsSingleQuote,
  escapePosixSingleQuote,
  SUPPORTED_ASSISTANTS,
} from './terminal-launch.js';
import { execa, execaSync } from 'execa';

vi.mock('execa');

describe('terminal-launch utility', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('escaping helpers', () => {
    it('escapes single quotes for PowerShell', () => {
      expect(escapePsSingleQuote("C:\\Bob's Workspace\\repo")).toBe("C:\\Bob''s Workspace\\repo");
    });

    it('escapes single quotes for POSIX shell', () => {
      expect(escapePosixSingleQuote("/home/bob's-workspace/repo")).toBe("/home/bob'\\''s-workspace/repo");
    });
  });

  describe('formatTerminalTitle', () => {
    it('formats a clean title with workspace, assistant, and short session ID', () => {
      const title = formatTerminalTitle('/home/user/workspaces/my-feature', {
        assistant: 'antigravity',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      });
      expect(title).toBe('NexusFlow: my-feature [antigravity] (3a14e9f7)');
    });

    it('respects and sanitizes custom title when provided', () => {
      const title = formatTerminalTitle('/home/user/workspaces/my-feature', {
        title: 'Custom Title $; rm -rf /',
      });
      expect(title).toBe('Custom Title  rm -rf');
    });

    it('handles root workspace path gracefully', () => {
      const title = formatTerminalTitle('/', { assistant: 'claude' });
      expect(title).toBe('NexusFlow: Workspace [claude]');
    });
  });

  describe('buildHarnessCliCommand', () => {
    it('builds start commands for known assistants', () => {
      expect(buildHarnessCliCommand('antigravity')).toBe('agy');
      expect(buildHarnessCliCommand('claude')).toBe('claude');
      expect(buildHarnessCliCommand('codex')).toBe('codex');
      expect(buildHarnessCliCommand('copilot')).toBe('copilot');
      expect(buildHarnessCliCommand('cursor')).toBe('cursor-agent');
    });

    it('builds resume commands when a valid UUID is provided', () => {
      const uuid = '3a14e9f7-628b-4d51-87b4-1065a7df4921';
      expect(buildHarnessCliCommand('antigravity', uuid)).toBe(`agy --conversation ${uuid}`);
      expect(buildHarnessCliCommand('claude', uuid)).toBe(`claude --resume ${uuid}`);
      expect(buildHarnessCliCommand('codex', uuid)).toBe(`codex resume ${uuid}`);
      expect(buildHarnessCliCommand('copilot', uuid)).toBe(`copilot --resume ${uuid}`);
      expect(buildHarnessCliCommand('cursor', uuid)).toBe(`cursor-agent --resume ${uuid}`);
    });

    it('throws on invalid session UUID', () => {
      expect(() => buildHarnessCliCommand('claude', 'invalid-id')).toThrow('Invalid session UUID format');
    });

    it('throws on unsupported assistant', () => {
      expect(() => buildHarnessCliCommand('unsupported-ai')).toThrow('Unsupported assistant');
    });
  });

  describe('launchWorkspaceTerminal', () => {
    it('throws on relative workspace path', async () => {
      await expect(launchWorkspaceTerminal('relative/path')).rejects.toThrow('must be an absolute directory');
    });

    it('launches in Windows Terminal (wt.exe) as a tab when available on Windows', async () => {
      const mockUnref = vi.fn();
      vi.mocked(execaSync).mockImplementation((_cmd: any, args?: any) => {
        if (Array.isArray(args) && args[0] === 'wt.exe') return { exitCode: 0 } as any;
        if (Array.isArray(args) && args[0] === 'pwsh.exe') return { exitCode: 0 } as any;
        return { exitCode: 1 } as any;
      });
      vi.mocked(execa).mockReturnValue({ unref: mockUnref, catch: vi.fn() } as any);

      const res = await launchWorkspaceTerminal("C:\\workspaces\\bob's-app", {
        assistant: 'antigravity',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      }, 'win32');

      expect(res.success).toBe(true);
      expect(res.command).toBe('agy --conversation 3a14e9f7-628b-4d51-87b4-1065a7df4921');
      expect(execa).toHaveBeenCalledWith(
        'wt.exe',
        [
          '-w', '0',
          'nt',
          '-d', "C:\\workspaces\\bob's-app",
          '--title', "NexusFlow: bobs-app [antigravity] (3a14e9f7)",
          'pwsh.exe', '-NoExit', '-EncodedCommand', expect.any(String),
        ],
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      expect(mockUnref).toHaveBeenCalled();
    });

    it('falls back to PowerShell Start-Process when wt.exe is absent on Windows', async () => {
      vi.mocked(execaSync).mockImplementation((_cmd: any, args?: any) => {
        if (Array.isArray(args) && args[0] === 'wt.exe') return { exitCode: 1 } as any;
        if (Array.isArray(args) && args[0] === 'pwsh.exe') return { exitCode: 0 } as any;
        return { exitCode: 1 } as any;
      });
      vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as any);

      const res = await launchWorkspaceTerminal("C:\\workspaces\\bob's-app", {
        assistant: 'antigravity',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      }, 'win32');

      expect(res.success).toBe(true);
      expect(res.command).toBe('agy --conversation 3a14e9f7-628b-4d51-87b4-1065a7df4921');
      expect(execa).toHaveBeenCalledWith(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', expect.stringContaining('Start-Process')],
        { reject: false, stdio: 'ignore' },
      );
    });

    it('falls back to cmd.exe start when Start-Process fails on Windows', async () => {
      const mockUnref = vi.fn();
      vi.mocked(execaSync).mockImplementation((_cmd: any, args?: any) => {
        if (Array.isArray(args) && args[0] === 'wt.exe') return { exitCode: 1 } as any;
        if (Array.isArray(args) && args[0] === 'pwsh.exe') return { exitCode: 0 } as any;
        return { exitCode: 1 } as any;
      });
      vi.mocked(execa).mockImplementation((cmd: any) => {
        if (cmd === 'powershell.exe') {
          return Promise.resolve({ exitCode: 1 } as any);
        }
        return { unref: mockUnref, catch: vi.fn() } as any;
      });

      const res = await launchWorkspaceTerminal("C:\\workspaces\\bob's-app", {
        assistant: 'antigravity',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      }, 'win32');

      expect(res.success).toBe(true);
      expect(res.command).toBe('agy --conversation 3a14e9f7-628b-4d51-87b4-1065a7df4921');
      expect(execa).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'start', '""', 'pwsh.exe', '-NoExit', '-EncodedCommand', expect.any(String)],
        expect.objectContaining({ detached: true, shell: false, windowsHide: false }),
      );
      expect(mockUnref).toHaveBeenCalled();
    });

    it('launches Terminal.app on macOS via osascript with ANSI title', async () => {
      const mockUnref = vi.fn();
      vi.mocked(execa).mockReturnValue({ unref: mockUnref, catch: vi.fn() } as any);

      const res = await launchWorkspaceTerminal('/Users/user/workspace', {
        assistant: 'codex',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      }, 'darwin');

      expect(res.success).toBe(true);
      expect(res.command).toBe('codex resume 3a14e9f7-628b-4d51-87b4-1065a7df4921');
      expect(execa).toHaveBeenCalledWith(
        '/usr/bin/osascript',
        ['-e', expect.stringContaining('tell application "Terminal"')],
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      expect(mockUnref).toHaveBeenCalled();
    });

    it('searches and launches terminal emulator on Linux (e.g. ptyxis or xfce4-terminal)', async () => {
      const mockUnref = vi.fn();
      vi.mocked(execaSync).mockImplementation((_cmd: any, args?: any) => {
        if (Array.isArray(args) && (args[0] === 'ptyxis' || args[0] === 'gnome-terminal' || args[0] === 'konsole')) return { exitCode: 1 } as any;
        if (Array.isArray(args) && args[0] === 'xfce4-terminal') return { exitCode: 0 } as any;
        return { exitCode: 1 } as any;
      });
      vi.mocked(execa).mockReturnValue({ unref: mockUnref, catch: vi.fn() } as any);

      const res = await launchWorkspaceTerminal('/home/user/workspace', {
        assistant: 'claude',
      }, 'linux');

      expect(res.success).toBe(true);
      expect(res.command).toBe('claude');
      expect(execa).toHaveBeenCalledWith(
        'xfce4-terminal',
        ['--tab', '--working-directory', '/home/user/workspace', '--title', 'NexusFlow: workspace [claude]', '-e', expect.stringContaining('claude; exec bash')],
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      expect(mockUnref).toHaveBeenCalled();
    });

    it('launches ptyxis as a tab on Linux when available', async () => {
      const mockUnref = vi.fn();
      vi.mocked(execaSync).mockImplementation((_cmd: any, args?: any) => {
        if (Array.isArray(args) && args[0] === 'ptyxis') return { exitCode: 0 } as any;
        return { exitCode: 1 } as any;
      });
      vi.mocked(execa).mockReturnValue({ unref: mockUnref, catch: vi.fn() } as any);

      const res = await launchWorkspaceTerminal('/home/user/workspace', {
        assistant: 'antigravity',
        sessionId: '3a14e9f7-628b-4d51-87b4-1065a7df4921',
      }, 'linux');

      expect(res.success).toBe(true);
      expect(res.command).toBe('agy --conversation 3a14e9f7-628b-4d51-87b4-1065a7df4921');
      expect(execa).toHaveBeenCalledWith(
        'ptyxis',
        [
          '--tab',
          '--working-directory', '/home/user/workspace',
          '-T', 'NexusFlow: workspace [antigravity] (3a14e9f7)',
          '--', 'bash', '-c',
          expect.stringContaining('agy --conversation 3a14e9f7-628b-4d51-87b4-1065a7df4921; exec bash'),
        ],
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
      expect(mockUnref).toHaveBeenCalled();
    });
  });
});
