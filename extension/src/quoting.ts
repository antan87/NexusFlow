/**
 * @module extension/quoting
 * Provides shell argument quoting and command line construction for VS Code terminal execution,
 * supporting POSIX shells (bash, zsh, sh), PowerShell (pwsh, powershell.exe), and Windows CMD,
 * as well as direct shell-free CLI execution.
 */

import * as path from 'path';
import * as child_process from 'child_process';

export type ShellType = 'posix' | 'powershell' | 'cmd';

/**
 * Detects shell type from a shell executable path or the host platform environment.
 */
export function detectShellType(
    shellPath?: string | null,
    platform: NodeJS.Platform = process.platform
): ShellType {
    if (shellPath) {
        const normalized = shellPath.toLowerCase().replace(/\\/g, '/');
        const filename = path.basename(normalized).replace(/\.exe$/, '');
        if (filename === 'pwsh' || filename === 'powershell') {
            return 'powershell';
        }
        if (filename === 'cmd') {
            return 'cmd';
        }
        if (['bash', 'zsh', 'sh', 'dash', 'ksh', 'fish'].includes(filename)) {
            return 'posix';
        }
        if (filename.includes('pwsh') || filename.includes('powershell')) {
            return 'powershell';
        }
        if (filename.includes('cmd')) {
            return 'cmd';
        }
        if (filename.includes('bash') || filename.includes('zsh') || filename.includes('sh')) {
            return 'posix';
        }
    }

    if (platform === 'win32') {
        const comspec = process.env.COMSPEC ? path.basename(process.env.COMSPEC).toLowerCase() : '';
        if (comspec.includes('cmd') && !process.env.PSModulePath) {
            return 'cmd';
        }
        return 'powershell';
    }

    return 'posix';
}

/**
 * Quotes an argument for POSIX shells (bash, zsh, sh, dash).
 * Uses single quotes to prevent any variable expansion, command substitution ($(), ``),
 * or globbing. Literal single quotes are escaped via '\\''.
 */
export function quoteForPosix(arg: string): string {
    if (arg === '') {
        return "''";
    }
    // Safe characters that never require quoting in POSIX shells
    if (/^[a-zA-Z0-9_./@=-]+$/.test(arg)) {
        return arg;
    }
    return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Quotes an argument for PowerShell (pwsh, powershell.exe).
 * In PowerShell, single-quoted strings are verbatim literals: no variable expansion,
 * subexpressions ($()), or escape sequences are processed. Literal single quotes are escaped via ''.
 */
export function quoteForPowerShell(arg: string): string {
    if (arg === '') {
        return "''";
    }
    // Safe alphanumeric identifiers without special shell meaning
    if (/^[a-zA-Z0-9_./:-]+$/.test(arg) && !arg.startsWith('$') && !arg.startsWith('@')) {
        return arg;
    }
    return `'${arg.replace(/'/g, "''")}'`;
}

/**
 * Quotes an argument for Windows cmd.exe according to standard CommandLineToArgvW rules.
 */
export function quoteForCmd(arg: string): string {
    if (arg === '') {
        return '""';
    }
    if (/^[a-zA-Z0-9_./:-]+$/.test(arg)) {
        return arg;
    }

    let result = '"';
    let backslashCount = 0;

    for (let i = 0; i < arg.length; i++) {
        const char = arg[i];
        if (char === '\\') {
            backslashCount++;
        } else if (char === '"') {
            // 2n + 1 backslashes before a double quote:
            // n backslashes doubled to 2n, plus 1 to escape the quote
            result += '\\'.repeat(backslashCount * 2 + 1) + '"';
            backslashCount = 0;
        } else {
            if (backslashCount > 0) {
                result += '\\'.repeat(backslashCount);
                backslashCount = 0;
            }
            result += char;
        }
    }

    if (backslashCount > 0) {
        // 2n backslashes before the closing quote
        result += '\\'.repeat(backslashCount * 2);
    }
    result += '"';

    return result;
}

/**
 * Quotes an argument for the specified shell type.
 */
export function quoteArg(arg: string, shellType: ShellType): string {
    switch (shellType) {
        case 'powershell':
            return quoteForPowerShell(arg);
        case 'cmd':
            return quoteForCmd(arg);
        case 'posix':
        default:
            return quoteForPosix(arg);
    }
}

/**
 * Builds a command line string for POSIX shells.
 */
export function buildPosixCommandLine(command: string, args: string[]): string {
    const quotedCmd = quoteForPosix(command);
    const quotedArgs = args.map(quoteForPosix);
    return quotedArgs.length > 0 ? `${quotedCmd} ${quotedArgs.join(' ')}` : quotedCmd;
}

/**
 * Builds a command line string for PowerShell.
 * Prefixes with the '&' call operator so quoted command names or paths execute properly.
 */
export function buildPowerShellCommandLine(command: string, args: string[]): string {
    const quotedCmd = quoteForPowerShell(command);
    const quotedArgs = args.map(quoteForPowerShell);
    const cmdPart = `& ${quotedCmd}`;
    return quotedArgs.length > 0 ? `${cmdPart} ${quotedArgs.join(' ')}` : cmdPart;
}

/**
 * Builds a command line string for Windows cmd.exe.
 */
export function buildCmdCommandLine(command: string, args: string[]): string {
    const quotedCmd = quoteForCmd(command);
    const quotedArgs = args.map(quoteForCmd);
    return quotedArgs.length > 0 ? `${quotedCmd} ${quotedArgs.join(' ')}` : quotedCmd;
}

/**
 * Builds a safe, shell-escaped command line string for the target shell or current environment.
 */
export function buildShellCommandLine(
    command: string,
    args: string[],
    shellPathOrType?: string | ShellType | null,
    platform: NodeJS.Platform = process.platform
): string {
    const shellType: ShellType =
        shellPathOrType === 'posix' || shellPathOrType === 'powershell' || shellPathOrType === 'cmd'
            ? shellPathOrType
            : detectShellType(shellPathOrType, platform);

    switch (shellType) {
        case 'powershell':
            return buildPowerShellCommandLine(command, args);
        case 'cmd':
            return buildCmdCommandLine(command, args);
        case 'posix':
        default:
            return buildPosixCommandLine(command, args);
    }
}

/**
 * Executes a CLI command directly without shell interpretation (shell: false).
 */
export function executeCli(
    command: string,
    args: string[],
    options?: child_process.SpawnOptions
): child_process.ChildProcess {
    return child_process.spawn(command, args, {
        ...options,
        shell: false,
    });
}
