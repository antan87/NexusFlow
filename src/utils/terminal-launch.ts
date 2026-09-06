/**
 * @module utils/terminal-launch
 * Spawns external interactive terminal windows for workspaces and AI assistant sessions.
 */

import { execa, execaSync } from 'execa';
import * as path from 'node:path';

import { isValidSessionUuid } from '../agent/session.js';
import { TERMINAL_TITLE_PREFIX, TERMINAL_DEFAULT_TITLE } from '../core/constants.js';

export interface TerminalLaunchOptions {
  command?: string;
  assistant?: string;
  sessionId?: string;
  title?: string;
}

export const SUPPORTED_ASSISTANTS = new Set(['antigravity', 'claude', 'codex', 'copilot', 'cursor']);

/**
 * Escapes a string for PowerShell single-quoted string literal (' -> '')
 */
export function escapePsSingleQuote(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Escapes a string for POSIX single-quoted string literal (' -> '\'')
 */
export function escapePosixSingleQuote(str: string): string {
  return str.replace(/'/g, "'\\''");
}

/**
 * Checks whether an executable exists on the system PATH.
 */
export function isBinaryOnPath(bin: string): boolean {
  try {
    const checker = process.platform === 'win32' ? 'where.exe' : 'which';
    const res = execaSync(checker, [bin], { reject: false, stdio: 'ignore' });
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Builds the interactive CLI command string for starting or resuming a harness session.
 */
export function buildHarnessCliCommand(assistant: string, sessionId?: string): string {
  const normalized = assistant.trim().toLowerCase();
  if (!SUPPORTED_ASSISTANTS.has(normalized)) {
    throw new Error(`Unsupported assistant for terminal launch: "${assistant}".`);
  }

  if (sessionId) {
    if (!isValidSessionUuid(sessionId)) {
      throw new Error('Invalid session UUID format.');
    }
    switch (normalized) {
      case 'antigravity':
        return `agy --conversation ${sessionId}`;
      case 'claude':
        return `claude --resume ${sessionId}`;
      case 'codex':
        return `codex resume ${sessionId}`;
      case 'copilot':
        return `copilot --resume ${sessionId}`;
      case 'cursor':
        return `cursor-agent --resume ${sessionId}`;
    }
  }

  switch (normalized) {
    case 'antigravity':
      return 'agy';
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'copilot':
      return 'copilot';
    case 'cursor':
      return 'cursor-agent';
    default:
      return 'agy';
  }
}

/**
 * Generates and sanitizes a descriptive title for external terminal windows/tabs.
 */
export function formatTerminalTitle(
  workspacePath: string,
  options: TerminalLaunchOptions = {},
  platform = process.platform,
): string {
  if (options.title && options.title.trim()) {
    const sanitizedCustom = options.title.replace(/[^a-zA-Z0-9 _\-:()[\]]/g, '').trim();
    if (sanitizedCustom) return sanitizedCustom;
  }

  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const wsName = pathApi.basename(workspacePath) || 'Workspace';
  const parts: string[] = [TERMINAL_TITLE_PREFIX, wsName];

  if (options.assistant) {
    parts.push(`[${options.assistant}]`);
  }
  if (options.sessionId && isValidSessionUuid(options.sessionId)) {
    parts.push(`(${options.sessionId.slice(0, 8)})`);
  }

  const rawTitle = parts.join(' ');
  return rawTitle.replace(/[^a-zA-Z0-9 _\-:()[\]]/g, '').trim() || TERMINAL_DEFAULT_TITLE;
}

/**
 * Validates and sanitizes a custom command string for terminal execution.
 */
export function sanitizeTerminalCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (/[\r\n\0]/.test(trimmed)) {
    throw new Error('Terminal command contains invalid newline or null characters.');
  }
  return trimmed;
}

/**
 * Spawns an external interactive terminal at the given workspace directory.
 */
export async function launchWorkspaceTerminal(
  workspacePath: string,
  options: TerminalLaunchOptions = {},
  platform = process.platform,
): Promise<{ success: boolean; command: string }> {
  const isAbsolute = platform === 'win32'
    ? path.win32.isAbsolute(workspacePath)
    : (path.posix.isAbsolute(workspacePath) || path.win32.isAbsolute(workspacePath));
  if (!isAbsolute) {
    throw new Error('Workspace path must be an absolute directory.');
  }

  let cmdToRun = '';
  if (options.command) {
    cmdToRun = sanitizeTerminalCommand(options.command);
  } else if (options.assistant) {
    cmdToRun = buildHarnessCliCommand(options.assistant, options.sessionId);
  }

  const terminalTitle = formatTerminalTitle(workspacePath, options, platform);

  if (platform === 'win32') {
    const escapedWs = escapePsSingleQuote(workspacePath);
    const shellBin = isBinaryOnPath('pwsh.exe') ? 'pwsh.exe' : 'powershell.exe';
    const titleScript = `$host.UI.RawUI.WindowTitle = '${escapePsSingleQuote(terminalTitle)}'; `;
    const focusPrefix = '$wshell = New-Object -ComObject Wscript.Shell; try { $wshell.AppActivate($PID) } catch {}; ';
    const psScript = cmdToRun
      ? `${titleScript}${focusPrefix}Set-Location -LiteralPath '${escapedWs}'; ${cmdToRun}`
      : `${titleScript}${focusPrefix}Set-Location -LiteralPath '${escapedWs}'`;
    const encodedCmd = Buffer.from(psScript, 'utf16le').toString('base64');

    // Method 0: Windows Terminal (wt.exe) with tab attachment to current window
    if (isBinaryOnPath('wt.exe')) {
      try {
        const child = execa('wt.exe', [
          '-w', '0',
          'nt',
          '-d', workspacePath,
          '--title', terminalTitle,
          shellBin, '-NoExit', '-EncodedCommand', encodedCmd,
        ], {
          detached: true,
          stdio: 'ignore',
        });
        if (child && typeof (child as any).catch === 'function') {
          (child as any).catch(() => {});
        }
        if (child && typeof (child as any).unref === 'function') {
          (child as any).unref();
        }
        return { success: true, command: cmdToRun };
      } catch {
        // Fall back to standalone PowerShell/CMD if wt fails
      }
    }

    // Method 1: Start-Process via powershell.exe (guarantees a visible, focused native console window)
    try {
      const res = await execa('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath '${shellBin}' -ArgumentList '-NoExit', '-EncodedCommand', '${encodedCmd}' -WorkingDirectory '${escapedWs}'`,
      ], { reject: false, stdio: 'ignore' });
      if (res.exitCode === 0) {
        return { success: true, command: cmdToRun };
      }
    } catch {}

    // Method 2: cmd.exe start
    try {
      const child = execa(
        'cmd.exe',
        ['/c', 'start', '""', shellBin, '-NoExit', '-EncodedCommand', encodedCmd],
        {
          detached: true,
          stdio: 'ignore',
          shell: false,
          windowsHide: false,
        },
      );
      if (child && typeof (child as any).catch === 'function') {
        (child as any).catch(() => {});
      }
      if (child && typeof (child as any).unref === 'function') {
        (child as any).unref();
      }
      return { success: true, command: cmdToRun };
    } catch (err) {
      throw new Error(`Failed to launch terminal on Windows: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (platform === 'darwin') {
    const posixEscapedPath = escapePosixSingleQuote(workspacePath);
    const appleScriptSafePath = posixEscapedPath.replace(/[\\"]/g, '\\$&');
    const appleScriptSafeCmd = cmdToRun ? cmdToRun.replace(/[\\"]/g, '\\$&') : '';
    const safeEscapedTitle = terminalTitle.replace(/[\\"]/g, '\\$&');
    const titleCmd = `printf '\\033]0;%s\\007' '${safeEscapedTitle}'; `;
    const script = cmdToRun
      ? `tell application "Terminal" to do script "${titleCmd}cd '${appleScriptSafePath}' && ${appleScriptSafeCmd}"\ntell application "Terminal" to activate`
      : `tell application "Terminal" to do script "${titleCmd}cd '${appleScriptSafePath}'"\ntell application "Terminal" to activate`;

    try {
      const child = execa('/usr/bin/osascript', ['-e', script], {
        detached: true,
        stdio: 'ignore',
      });
      if (child && typeof (child as any).catch === 'function') {
        (child as any).catch(() => {});
      }
      if (child && typeof (child as any).unref === 'function') {
        (child as any).unref();
      }
      return { success: true, command: cmdToRun };
    } catch (err) {
      throw new Error(`Failed to launch Terminal.app on macOS: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (platform === 'linux') {
    const escapedWs = escapePosixSingleQuote(workspacePath);
    const titleEscape = `printf '\\033]0;%s\\007' '${escapePosixSingleQuote(terminalTitle)}'; `;
    const bashScript = cmdToRun
      ? `${titleEscape}cd '${escapedWs}' && ${cmdToRun}; exec bash`
      : `${titleEscape}cd '${escapedWs}'; exec bash`;

    const linuxTerminals = [
      { bin: 'ptyxis', args: ['--tab', '--working-directory', workspacePath, '-T', terminalTitle, '--', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'gnome-terminal', args: ['--tab', '--working-directory', workspacePath, '--title', terminalTitle, '--', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'kgx', args: ['--working-directory', workspacePath, '-T', terminalTitle, '-e', `bash -c "${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash"`] },
      { bin: 'konsole', args: ['--new-tab', '--workdir', workspacePath, '-p', `tabtitle=${terminalTitle}`, '-e', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'xfce4-terminal', args: ['--tab', '--working-directory', workspacePath, '--title', terminalTitle, '-e', `bash -c "${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash"`] },
      { bin: 'tilix', args: ['--new-tab', '--working-directory', workspacePath, '-e', `bash -c "${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash"`] },
      { bin: 'terminator', args: ['--new-tab', '--working-directory', workspacePath, '-e', `bash -c "${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash"`] },
      { bin: 'alacritty', args: ['--working-directory', workspacePath, '--title', terminalTitle, '-e', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'kitty', args: ['--directory', workspacePath, '--title', terminalTitle, 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'foot', args: ['-D', workspacePath, '--title', terminalTitle, 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'wezterm', args: ['start', '--cwd', workspacePath, '--', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'ghostty', args: [`--working-directory=${workspacePath}`, '-e', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'x-terminal-emulator', args: ['--working-directory', workspacePath, '--', 'bash', '-c', `${titleEscape}${cmdToRun ? cmdToRun + '; ' : ''}exec bash`] },
      { bin: 'x-terminal-emulator', args: ['-e', 'bash', '-c', bashScript] },
      { bin: 'xterm', args: ['-title', terminalTitle, '-e', 'bash', '-c', bashScript] },
    ];

    for (const term of linuxTerminals) {
      if (!isBinaryOnPath(term.bin)) continue;
      try {
        const child = execa(term.bin, term.args, {
          detached: true,
          stdio: 'ignore',
        });
        if (child && typeof (child as any).catch === 'function') {
          (child as any).catch(() => {});
        }
        if (child && typeof (child as any).unref === 'function') {
          (child as any).unref();
        }
        return { success: true, command: cmdToRun };
      } catch {
        // Try next candidate
      }
    }
    throw new Error('No supported Linux terminal emulator found on PATH (tried ptyxis, gnome-terminal, konsole, xfce4-terminal, alacritty, kitty, foot, wezterm, ghostty, x-terminal-emulator, xterm).');
  }

  throw new Error(`Terminal launching is not supported on platform: ${platform}`);
}
