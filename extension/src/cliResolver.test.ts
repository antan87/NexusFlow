import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { extractJsFromCmdShim, findAdjacentJsEntryPoint, resolveCli } from './cliResolver.js';
import { executeCli } from './quoting.js';

describe('extension/cliResolver', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-resolver-test-'));
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
            // ignore
        }
    });

    describe('extractJsFromCmdShim', () => {
        it('extracts target JS from standard npm cmd-shim format', () => {
            const cmdContent = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js" %*
`;
            const result = extractJsFromCmdShim(cmdContent, 'C:\\Users\\test\\npm', path.win32);
            expect(result).toBe('C:\\Users\\test\\npm\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js');
        });

        it('extracts target JS from short %~dp0 format', () => {
            const cmdContent = '@node "%~dp0\\..\\@mrpatronz\\nexusflow\\dist\\index.js" %*';
            const result = extractJsFromCmdShim(cmdContent, 'C:\\project\\node_modules\\.bin', path.win32);
            expect(result).toBe('C:\\project\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js');
        });

        it('extracts target JS from forward-slash format', () => {
            const cmdContent = '"%_prog%" "%dp0%/node_modules/contextspace/dist/index.js" %*';
            const result = extractJsFromCmdShim(cmdContent, 'C:\\npm', path.win32);
            expect(result).toBe('C:\\npm\\node_modules\\contextspace\\dist\\index.js');
        });
    });

    describe('findAdjacentJsEntryPoint', () => {
        it('finds index.js in adjacent node_modules directory', () => {
            const binDir = path.join(tempDir, 'npm-bin');
            const pkgDir = path.join(binDir, 'node_modules', 'contextspace', 'dist');
            fs.mkdirSync(pkgDir, { recursive: true });
            const targetJs = path.join(pkgDir, 'index.js');
            fs.writeFileSync(targetJs, '// contextspace');

            const found = findAdjacentJsEntryPoint(binDir);
            expect(found).toBe(targetJs);
        });
    });

    describe('resolveCli fallback with no sibling dist directory', () => {
        it('resolves sibling ../dist/index.js when present (source tree mode)', () => {
            const extDir = path.join(tempDir, 'repo', 'extension');
            const siblingDist = path.join(tempDir, 'repo', 'dist');
            fs.mkdirSync(extDir, { recursive: true });
            fs.mkdirSync(siblingDist, { recursive: true });
            const entryJs = path.join(siblingDist, 'index.js');
            fs.writeFileSync(entryJs, 'console.log("hello");');

            const resolved = resolveCli(extDir);
            expect(resolved.prefixArgs).toEqual([entryJs]);
            expect(resolved.command).toBe(process.execPath);
        });

        it('resolves npm-style installation when sibling dist is absent', () => {
            // Extension directory with NO sibling dist/ directory
            const extDir = path.join(tempDir, 'installed-ext');
            fs.mkdirSync(extDir, { recursive: true });

            // Mock npm bin directory
            const npmBinDir = path.join(tempDir, 'npm-bin');
            const pkgDistDir = path.join(npmBinDir, 'node_modules', '@mrpatronz', 'nexusflow', 'dist');
            fs.mkdirSync(pkgDistDir, { recursive: true });
            const targetJs = path.join(pkgDistDir, 'index.js');
            fs.writeFileSync(targetJs, 'console.log("npm cli");');

            // Mock ctxspace.cmd shim
            const cmdPath = path.join(npmBinDir, 'ctxspace.cmd');
            fs.writeFileSync(cmdPath, `@"%~dp0\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js" %*`);

            const mockEnv: NodeJS.ProcessEnv = {
                PATH: npmBinDir,
            };

            const resolved = resolveCli(extDir, {
                env: mockEnv,
                platform: 'win32',
                pathModule: path.win32,
            });

            // Must resolve to real Node executable and target JS entry point, NOT ctxspace.cmd
            expect(resolved.command).toBe(process.execPath);
            expect(resolved.prefixArgs).toHaveLength(1);
            expect(path.resolve(resolved.prefixArgs[0])).toBe(path.resolve(targetJs));
        });

        it('resolves native .exe executable in PATH when present on Windows', () => {
            const extDir = path.join(tempDir, 'installed-ext');
            fs.mkdirSync(extDir, { recursive: true });

            const binDir = path.join(tempDir, 'bin');
            fs.mkdirSync(binDir, { recursive: true });
            const exePath = path.join(binDir, 'ctxspace.exe');
            fs.writeFileSync(exePath, 'binary content');

            const mockEnv: NodeJS.ProcessEnv = {
                PATH: binDir,
            };

            const resolved = resolveCli(extDir, {
                env: mockEnv,
                platform: 'win32',
                pathModule: path.win32,
            });

            expect(path.resolve(resolved.command)).toBe(path.resolve(exePath));
            expect(resolved.prefixArgs).toEqual([]);
        });

        it('preserves shell-free execution of special characters through resolved npm CLI entry point', async () => {
            // Extension directory with NO sibling dist/ directory
            const extDir = path.join(tempDir, 'installed-ext');
            fs.mkdirSync(extDir, { recursive: true });

            // Mock npm global installation
            const npmBinDir = path.join(tempDir, 'npm-global');
            const pkgDistDir = path.join(npmBinDir, 'node_modules', '@mrpatronz', 'nexusflow', 'dist');
            fs.mkdirSync(pkgDistDir, { recursive: true });

            // Script that outputs JSON of received arguments
            const cliScript = path.join(pkgDistDir, 'index.js');
            fs.writeFileSync(
                cliScript,
                `console.log(JSON.stringify(process.argv.slice(2)));`
            );

            // Mock ctxspace.cmd
            const cmdPath = path.join(npmBinDir, 'ctxspace.cmd');
            fs.writeFileSync(
                cmdPath,
                `@node "%~dp0\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js" %*`
            );

            const mockEnv: NodeJS.ProcessEnv = {
                ...process.env,
                PATH: `${npmBinDir}${path.delimiter}${process.env.PATH || ''}`,
            };

            const resolved = resolveCli(extDir, {
                env: mockEnv,
                platform: 'win32',
                pathModule: path.win32,
            });

            expect(resolved.command).toBe(process.execPath);
            expect(path.resolve(resolved.prefixArgs[0])).toBe(path.resolve(cliScript));

            // Test execution with literal %PATH%, !TEMP!, quotes, &, newlines
            const testArgs = [
                'commit',
                '-m',
                'fix: %PATH% and !TEMP! with " & calc & " \' & whoami & \' and line1\r\nline2\nline3',
            ];

            const proc = executeCli(resolved.command, [...resolved.prefixArgs, ...testArgs]);

            let stdout = '';
            let stderr = '';
            proc.stdout?.on('data', (d) => (stdout += d.toString()));
            proc.stderr?.on('data', (d) => (stderr += d.toString()));

            const exitCode = await new Promise<number | null>((resolve, reject) => {
                proc.on('close', resolve);
                proc.on('error', reject);
            });

            expect(exitCode).toBe(0);
            const parsed = JSON.parse(stdout.trim());
            expect(parsed).toEqual(testArgs);
            expect(parsed[2]).toBe(
                'fix: %PATH% and !TEMP! with " & calc & " \' & whoami & \' and line1\r\nline2\nline3'
            );
        });
    });

    describe.runIf(process.platform === 'win32')(
        'Windows installed-extension CLI fallback and execution',
        () => {
            it('resolves and executes installed npm CLI fallback preserving %PATH%, !TEMP!, quotes, and newlines', async () => {
                // Extension installed with no sibling dist directory
                const extDir = path.join(tempDir, 'installed-vscode-ext');
                fs.mkdirSync(extDir, { recursive: true });

                // npm global directory with cmd shim and package dist
                const npmGlobal = path.join(tempDir, 'AppData', 'Roaming', 'npm');
                const pkgDist = path.join(
                    npmGlobal,
                    'node_modules',
                    '@mrpatronz',
                    'nexusflow',
                    'dist'
                );
                fs.mkdirSync(pkgDist, { recursive: true });

                // Mock CLI script
                const cliJs = path.join(pkgDist, 'index.js');
                fs.writeFileSync(
                    cliJs,
                    `console.log(JSON.stringify(process.argv.slice(2)));`
                );

                // Mock standard npm cmd-shim
                const cmdFile = path.join(npmGlobal, 'ctxspace.cmd');
                fs.writeFileSync(
                    cmdFile,
                    `@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@mrpatronz\\nexusflow\\dist\\index.js" %*\r\n`
                );

                const mockEnv: NodeJS.ProcessEnv = {
                    ...process.env,
                    APPDATA: path.join(tempDir, 'AppData', 'Roaming'),
                    PATH: `${npmGlobal};${process.env.PATH || ''}`,
                };

                const resolved = resolveCli(extDir, { env: mockEnv });

                // Verifications:
                // 1. Must NOT return ctxspace.cmd (which would fail in spawn without shell)
                expect(resolved.command).not.toContain('.cmd');
                // 2. Must return a real Node executable
                expect(resolved.command).toBe(process.execPath);
                // 3. Prefix args must contain the resolved CLI JavaScript file
                expect(resolved.prefixArgs).toHaveLength(1);
                expect(path.normalize(resolved.prefixArgs[0])).toBe(path.normalize(cliJs));

                // 4. Execute using shell: false and verify all special characters preserved
                const testMessage =
                    'feat: %PATH% and !TEMP! with " & calc & " and \' & whoami & \'\r\nline2\nline3';
                const commitArgs = ['commit', '-m', testMessage];

                const proc = executeCli(resolved.command, [...resolved.prefixArgs, ...commitArgs]);

                let stdout = '';
                proc.stdout?.on('data', (d) => (stdout += d.toString()));

                const code = await new Promise<number | null>((resolve, reject) => {
                    proc.on('close', resolve);
                    proc.on('error', reject);
                });

                expect(code).toBe(0);
                const parsed = JSON.parse(stdout.trim());
                expect(parsed).toEqual(commitArgs);
                expect(parsed[2]).toBe(testMessage);
            });
        }
    );
});
