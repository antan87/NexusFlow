import { describe, it, expect } from 'vitest';
import * as child_process from 'child_process';
import {
    detectShellType,
    quoteForPosix,
    quoteForPowerShell,
    quoteForCmd,
    quoteArg,
    buildPosixCommandLine,
    buildPowerShellCommandLine,
    buildCmdCommandLine,
    buildShellCommandLine,
    executeCli,
} from './quoting.js';

describe('extension/quoting', () => {
    describe('detectShellType', () => {
        it('detects POSIX shells correctly', () => {
            expect(detectShellType('/bin/bash')).toBe('posix');
            expect(detectShellType('/usr/bin/zsh')).toBe('posix');
            expect(detectShellType('/bin/sh')).toBe('posix');
            expect(detectShellType('/bin/dash')).toBe('posix');
            expect(detectShellType('/usr/local/bin/fish')).toBe('posix');
        });

        it('detects PowerShell shells correctly', () => {
            expect(detectShellType('pwsh')).toBe('powershell');
            expect(detectShellType('powershell.exe')).toBe('powershell');
            expect(detectShellType('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('powershell');
            expect(detectShellType('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe('powershell');
            expect(detectShellType('/usr/bin/pwsh')).toBe('powershell');
        });

        it('detects Windows CMD correctly', () => {
            expect(detectShellType('cmd.exe')).toBe('cmd');
            expect(detectShellType('C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
        });

        it('falls back appropriately based on platform when no shell path is provided', () => {
            expect(detectShellType(undefined, 'linux')).toBe('posix');
            expect(detectShellType(undefined, 'darwin')).toBe('posix');
            expect(detectShellType(undefined, 'win32')).toBe('powershell');
        });
    });

    describe('quoteForPosix', () => {
        it('leaves safe alphanumeric and standard path characters unquoted', () => {
            expect(quoteForPosix('commit')).toBe('commit');
            expect(quoteForPosix('-m')).toBe('-m');
            expect(quoteForPosix('--all')).toBe('--all');
            expect(quoteForPosix('path/to/file.ts')).toBe('path/to/file.ts');
        });

        it('quotes empty string as two single quotes', () => {
            expect(quoteForPosix('')).toBe("''");
        });

        it('preserves literal dollar substitutions without shell evaluation', () => {
            expect(quoteForPosix('$(whoami)')).toBe("'$(whoami)'");
            expect(quoteForPosix('$USER')).toBe("'$USER'");
            expect(quoteForPosix('${HOME}')).toBe("'${HOME}'");
            expect(quoteForPosix('$((1 + 1))')).toBe("'$((1 + 1))'");
        });

        it('preserves backticks without command execution', () => {
            expect(quoteForPosix('`id`')).toBe("'`id`'");
            expect(quoteForPosix('hello `calc` world')).toBe("'hello `calc` world'");
        });

        it('preserves single and double quotes', () => {
            expect(quoteForPosix('"double quoted"')).toBe('\'"double quoted"\'');
            expect(quoteForPosix("it's a test")).toBe("'it'\\''s a test'");
            expect(quoteForPosix('mixed "double" and \'single\'')).toBe('\'mixed "double" and \'\\\'\'single\'\\\'\'\'');
        });

        it('preserves backslashes', () => {
            expect(quoteForPosix('C:\\Users\\test')).toBe("'C:\\Users\\test'");
            expect(quoteForPosix('path\\with\\backslashes')).toBe("'path\\with\\backslashes'");
        });

        it('preserves newlines', () => {
            expect(quoteForPosix('line1\nline2')).toBe("'line1\nline2'");
            expect(quoteForPosix('multi\nline\r\nmessage')).toBe("'multi\nline\r\nmessage'");
        });
    });

    describe('quoteForPowerShell', () => {
        it('leaves safe identifiers unquoted', () => {
            expect(quoteForPowerShell('commit')).toBe('commit');
            expect(quoteForPowerShell('-m')).toBe('-m');
            expect(quoteForPowerShell('doctor')).toBe('doctor');
        });

        it('quotes empty string as two single quotes', () => {
            expect(quoteForPowerShell('')).toBe("''");
        });

        it('preserves literal dollar substitutions in PowerShell verbatim single-quotes', () => {
            expect(quoteForPowerShell('$(Get-Process)')).toBe("'$(Get-Process)'");
            expect(quoteForPowerShell('$env:PATH')).toBe("'$env:PATH'");
            expect(quoteForPowerShell('$foo')).toBe("'$foo'");
            expect(quoteForPowerShell('$(whoami)')).toBe("'$(whoami)'");
        });

        it('preserves backticks verbatim without escape semantics', () => {
            expect(quoteForPowerShell('`n')).toBe("'`n'");
            expect(quoteForPowerShell('`calc`')).toBe("'`calc`'");
        });

        it('escapes single quotes by doubling them according to PowerShell specification', () => {
            expect(quoteForPowerShell("Don't do it")).toBe("'Don''t do it'");
            expect(quoteForPowerShell('"double" and \'single\'')).toBe('\'"double" and \'\'single\'\'\'');
        });

        it('preserves backslashes verbatim', () => {
            expect(quoteForPowerShell('C:\\Program Files\\NexusFlow\\')).toBe("'C:\\Program Files\\NexusFlow\\'");
        });

        it('preserves newlines', () => {
            expect(quoteForPowerShell('line1\nline2')).toBe("'line1\nline2'");
        });
    });

    describe('quoteForCmd', () => {
        it('leaves safe characters unquoted', () => {
            expect(quoteForCmd('commit')).toBe('commit');
            expect(quoteForCmd('-m')).toBe('-m');
        });

        it('quotes empty string as two double quotes', () => {
            expect(quoteForCmd('')).toBe('""');
        });

        it('preserves double quotes and escapes backslashes according to CommandLineToArgvW', () => {
            expect(quoteForCmd('hello "world"')).toBe('"hello \\"world\\""');
            // Backslash preceding a double quote is doubled: \" -> \\\"
            expect(quoteForCmd('path\\"test"')).toBe('"path\\\\\\"test\\""');
            // Trailing backslash is doubled so it does not escape the closing quote
            expect(quoteForCmd('C:\\path\\')).toBe('"C:\\path\\\\"');
        });

        it('preserves dollar substitutions and backticks verbatim in cmd', () => {
            expect(quoteForCmd('$(whoami)')).toBe('"$(whoami)"');
            expect(quoteForCmd('`calc`')).toBe('"`calc`"');
        });

        it('preserves newlines in cmd', () => {
            expect(quoteForCmd('line1\nline2')).toBe('"line1\nline2"');
        });
    });

    describe('quoteArg', () => {
        it('quotes appropriately per shell type', () => {
            expect(quoteArg('$(whoami)', 'posix')).toBe("'$(whoami)'");
            expect(quoteArg('$(whoami)', 'powershell')).toBe("'$(whoami)'");
            expect(quoteArg('$(whoami)', 'cmd')).toBe('"$(whoami)"');
        });
    });

    describe('buildPowerShellCommandLine', () => {
        it('builds command line with & prefix and arguments', () => {
            expect(buildPowerShellCommandLine('nexusflow', ['status'])).toBe('& nexusflow status');
        });
    });

    describe('buildCmdCommandLine', () => {
        it('builds command line for cmd', () => {
            expect(buildCmdCommandLine('nexusflow', ['status'])).toBe('nexusflow status');
        });
    });

    describe('buildShellCommandLine', () => {
        it('builds a POSIX command line with safe quoting', () => {
            const cmd = buildShellCommandLine('nexusflow', ['commit', '-m', 'feat: update $(whoami) `date`'], 'posix');
            expect(cmd).toBe("nexusflow commit -m 'feat: update $(whoami) `date`'");
        });

        it('builds a PowerShell command line with call operator (&) and literal quoting', () => {
            const cmd = buildShellCommandLine('nexusflow', ['commit', '-m', 'feat: update $(whoami) `date`'], 'powershell');
            expect(cmd).toBe("& nexusflow commit -m 'feat: update $(whoami) `date`'");
        });

        it('builds a CMD command line', () => {
            const cmd = buildShellCommandLine('nexusflow', ['commit', '-m', 'feat: update "test"'], 'cmd');
            expect(cmd).toBe('nexusflow commit -m "feat: update \\"test\\""');
        });
    });

    describe.runIf(process.platform !== 'win32')('End-to-end POSIX shell execution verification', () => {
        it('verifies that /bin/sh preserves literal dollar substitutions, backticks, quotes, backslashes, and newlines', () => {
            // Run a real POSIX shell executing node, receiving the quoted arguments via argv.
            // Node prints the received argv as JSON to stdout.
            const testArgs = [
                '$(whoami)',
                '`id`',
                '$FOO_BAR_VAR',
                '${BAZ_VAR}',
                '$((10 + 5))',
                '"double-quotes"',
                "'single-quotes'",
                'mixed "both" \'quotes\'',
                'back\\slash\\path',
                'C:\\Program Files\\NexusFlow',
                'line1\nline2\nline3',
                'normal-arg',
            ];

            const nodeBin = process.execPath;
            // Script that outputs process.argv.slice(1) (all args following node -e script)
            const nodeScript = 'console.log(JSON.stringify(process.argv.slice(1)))';
            const fullCommandLine = buildPosixCommandLine(nodeBin, ['-e', nodeScript, ...testArgs]);

            const output = child_process.execFileSync('/bin/sh', ['-c', fullCommandLine], {
                encoding: 'utf-8',
            });

            const parsed = JSON.parse(output.trim());
            expect(parsed).toEqual(testArgs);
            expect(parsed[0]).toBe('$(whoami)');
            expect(parsed[1]).toBe('`id`');
            expect(parsed[2]).toBe('$FOO_BAR_VAR');
            expect(parsed[3]).toBe('${BAZ_VAR}');
            expect(parsed[4]).toBe('$((10 + 5))');
            expect(parsed[5]).toBe('"double-quotes"');
            expect(parsed[6]).toBe("'single-quotes'");
            expect(parsed[7]).toBe("mixed \"both\" 'quotes'");
            expect(parsed[8]).toBe('back\\slash\\path');
            expect(parsed[9]).toBe('C:\\Program Files\\NexusFlow');
            expect(parsed[10]).toBe('line1\nline2\nline3');
            expect(parsed[11]).toBe('normal-arg');
        });
    });

    describe('executeCli (shell-free execution)', () => {
        it('executes command without shell interpretation preserving all special characters', async () => {
            const testArgs = [
                '$(whoami)',
                '`calc`',
                '$VAR',
                '${VAR}',
                '%PATH%',
                '%USERPROFILE%',
                '!NAME!',
                '!TEMP!',
                '" & calc & "',
                "' & whoami & '",
                '"quotes"',
                "'single'",
                'back\\slash',
                'C:\\Program Files\\ContextSpace\\',
                'line1\nline2\r\nline3',
            ];

            const nodeBin = process.execPath;
            const proc = executeCli(nodeBin, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...testArgs]);

            let stdout = '';
            proc.stdout?.on('data', (d) => {
                stdout += d.toString();
            });

            await new Promise<void>((resolve, reject) => {
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exited with code ${code}`));
                });
                proc.on('error', reject);
            });

            const parsed = JSON.parse(stdout.trim());
            expect(parsed).toEqual(testArgs);
            expect(parsed[4]).toBe('%PATH%');
            expect(parsed[5]).toBe('%USERPROFILE%');
            expect(parsed[6]).toBe('!NAME!');
            expect(parsed[7]).toBe('!TEMP!');
            expect(parsed[8]).toBe('" & calc & "');
            expect(parsed[9]).toBe("' & whoami & '");
            expect(parsed[14]).toBe('line1\nline2\r\nline3');
        });

        it('preserves percent variables and delayed expansion without Windows environment substitution', async () => {
            // Specifically verify that percent variables and exclamation marks are not evaluated
            const testArgs = [
                'commit',
                '-m',
                'fix: document %PATH% and !TEMP! handling with "quoted" & calc & more',
            ];

            const nodeBin = process.execPath;
            const proc = executeCli(nodeBin, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...testArgs]);

            let stdout = '';
            proc.stdout?.on('data', (d) => {
                stdout += d.toString();
            });

            await new Promise<void>((resolve, reject) => {
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exited with code ${code}`));
                });
                proc.on('error', reject);
            });

            const parsed = JSON.parse(stdout.trim());
            expect(parsed).toEqual(testArgs);
            expect(parsed[2]).toBe('fix: document %PATH% and !TEMP! handling with "quoted" & calc & more');
        });
    });

    describe.runIf(process.platform === 'win32')('Windows CMD execution verification', () => {
        it('executes safe commands in cmd.exe preserving arguments', () => {
            const cmd = process.env.COMSPEC || 'cmd.exe';
            const nodeBin = process.execPath;
            const commandLine = buildCmdCommandLine(nodeBin, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'commit', 'status', 'test-arg']);
            const output = child_process.execFileSync(cmd, ['/d', '/s', '/c', `"${commandLine}"`], {
                windowsVerbatimArguments: true,
                encoding: 'utf-8',
            });
            const parsed = JSON.parse(output.trim());
            expect(parsed).toEqual(['commit', 'status', 'test-arg']);
        });

        it('verifies that executeCli on Windows preserves %PATH%, !TEMP!, embedded quotes with &, and newlines without shell interpretation', async () => {
            const testArgs = [
                'commit',
                '-m',
                'fix: %PATH% and !TEMP! with " & calc & " line1\nline2',
            ];

            const nodeBin = process.execPath;
            const proc = executeCli(nodeBin, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...testArgs]);

            let stdout = '';
            proc.stdout?.on('data', (d) => {
                stdout += d.toString();
            });

            await new Promise<void>((resolve, reject) => {
                proc.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Exited with code ${code}`));
                });
                proc.on('error', reject);
            });

            const parsed = JSON.parse(stdout.trim());
            expect(parsed).toEqual(testArgs);
            expect(parsed[2]).toBe('fix: %PATH% and !TEMP! with " & calc & " line1\nline2');
        });
    });
});
