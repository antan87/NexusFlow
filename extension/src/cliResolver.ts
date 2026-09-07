/**
 * @module extension/cliResolver
 * Resolves how to invoke the ContextSpace / NexusFlow CLI across all environments:
 * 1. Source tree / monorepo development (sibling ../dist/index.js)
 * 2. Bundled CLI inside extension package
 * 3. Installed npm-style CLI on Windows / POSIX:
 *    On Windows, inspects npm-generated .cmd shims and adjacent node_modules
 *    to resolve the real CLI JavaScript entry point, so it can be executed
 *    with a real Node executable via child_process.spawn(..., { shell: false })
 *    without hitting Windows CreateProcessW .cmd execution limitations
 *    or re-opening shell interpolation vulnerabilities.
 * 4. Native executable binaries (.exe on Windows, ELF/Mach-O on POSIX).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ResolvedCli {
    command: string;
    prefixArgs: string[];
}

export interface CliResolverOptions {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    execPath?: string;
    fsModule?: typeof fs;
    pathModule?: typeof path.win32 | typeof path.posix | typeof path;
}

const CLI_NAMES = ['ctxspace', 'contextspace', 'cs', 'nexusflow'];
const PACKAGE_NAMES = ['@mrpatronz/nexusflow', 'contextspace', 'nexusflow', '@mrpatronz/contextspace'];

function toHostPath(p: string): string {
    if (process.platform === 'win32') {
        return p.replace(/\//g, '\\');
    }
    return p.replace(/\\/g, '/');
}

function fileExists(p: string, fsImpl: typeof fs = fs): boolean {
    try {
        if (fsImpl.existsSync(p)) {
            return true;
        }
        if (process.platform !== 'win32' && p.includes('\\')) {
            return fsImpl.existsSync(p.replace(/\\/g, '/'));
        }
    } catch {
        // ignore
    }
    return false;
}

function readFileText(p: string, fsImpl: typeof fs = fs): string {
    try {
        return fsImpl.readFileSync(p, 'utf-8');
    } catch (err) {
        if (process.platform !== 'win32' && p.includes('\\')) {
            return fsImpl.readFileSync(p.replace(/\\/g, '/'), 'utf-8');
        }
        throw err;
    }
}

function splitPathDirs(rawPath: string, platform: NodeJS.Platform): string[] {
    if (!rawPath) return [];
    if (platform === 'win32') {
        if (rawPath.includes(';')) {
            return rawPath.split(';').filter(Boolean);
        }
        // Single path starting with Windows drive letter (e.g. C:\... or D:\...)
        if (/^[a-zA-Z]:/.test(rawPath)) {
            return [rawPath];
        }
        // In cross-platform tests running on POSIX with platform='win32'
        if (rawPath.includes(':')) {
            return rawPath.split(':').filter(Boolean);
        }
        return [rawPath];
    }
    return rawPath.split(':').filter(Boolean);
}

/**
 * Parses an npm-generated .cmd shim on Windows to extract the target JavaScript entry point.
 */
export function extractJsFromCmdShim(
    cmdContent: string,
    cmdDir: string,
    pathImpl: typeof path.win32 | typeof path.posix | typeof path = path.win32
): string | null {
    // 1. Look for %dp0%\... or %~dp0\... pointing to a JS/MJS/CJS file
    const dp0Match = cmdContent.match(/(?:%~?dp0%?[\\/])([^"'\r\n\t]+?\.[cm]?js)/i);
    if (dp0Match && dp0Match[1]) {
        const sep = pathImpl.sep || (process.platform === 'win32' ? '\\' : '/');
        const normalizedRel = dp0Match[1].replace(/[\\/]/g, sep);
        return pathImpl.resolve(cmdDir, normalizedRel);
    }
    // 2. Look for an absolute Windows path (e.g. C:\... or \\...)
    const absWinMatch = cmdContent.match(/["']?([a-zA-Z]:[\\/][^"'\r\n\t]+?\.[cm]?js)["']?/i);
    if (absWinMatch && absWinMatch[1]) {
        return absWinMatch[1];
    }
    // 3. Look for an absolute POSIX path (e.g. /usr/...)
    const absPosixMatch = cmdContent.match(/["']?(\/[^"'\r\n\t]+?\.[cm]?js)["']?/i);
    if (absPosixMatch && absPosixMatch[1]) {
        return absPosixMatch[1];
    }
    return null;
}

/**
 * Searches for a CLI JavaScript entry point in adjacent node_modules relative to a bin directory.
 */
export function findAdjacentJsEntryPoint(
    binDir: string,
    pathImpl: typeof path.win32 | typeof path.posix | typeof path = path,
    fsImpl: typeof fs = fs
): string | null {
    for (const pkg of PACKAGE_NAMES) {
        const pkgParts = pkg.split('/');
        const candidates = [
            pathImpl.resolve(binDir, 'node_modules', ...pkgParts, 'dist', 'index.js'),
            pathImpl.resolve(binDir, '..', 'node_modules', ...pkgParts, 'dist', 'index.js'),
            pathImpl.resolve(binDir, 'node_modules', ...pkgParts, 'bin', 'ctxspace.js'),
            pathImpl.resolve(binDir, '..', 'node_modules', ...pkgParts, 'bin', 'ctxspace.js'),
            pathImpl.resolve(binDir, 'node_modules', ...pkgParts, 'index.js'),
            pathImpl.resolve(binDir, '..', 'node_modules', ...pkgParts, 'index.js'),
        ];
        for (const c of candidates) {
            if (fileExists(c, fsImpl)) {
                return c;
            }
        }
    }
    return null;
}

/**
 * Resolves how to invoke the ContextSpace / NexusFlow CLI.
 */
export function resolveCli(
    contextOrPath?: { extensionPath: string } | string | null,
    options?: CliResolverOptions
): ResolvedCli {
    const platform = options?.platform || process.platform;
    const env = options?.env || process.env;
    const fsImpl = options?.fsModule || fs;
    const pathImpl = options?.pathModule || (platform === 'win32' ? path.win32 : path);
    const execPath = options?.execPath || (process.execPath && path.basename(process.execPath).toLowerCase().startsWith('node') ? process.execPath : 'node');

    const extensionPath = typeof contextOrPath === 'string'
        ? contextOrPath
        : contextOrPath && typeof contextOrPath === 'object' && 'extensionPath' in contextOrPath
            ? contextOrPath.extensionPath
            : null;

    // 1. Sibling ../dist/index.js (source repository / monorepo development)
    if (extensionPath) {
        const sibling = pathImpl.resolve(extensionPath, '..', 'dist', 'index.js');
        if (fileExists(sibling, fsImpl)) {
            return { command: execPath, prefixArgs: [toHostPath(sibling)] };
        }

        // 2. Bundled CLI inside extension package
        const bundledCandidates = [
            pathImpl.resolve(extensionPath, 'dist', 'cli.js'),
            pathImpl.resolve(extensionPath, 'dist', 'index.js'),
            pathImpl.resolve(extensionPath, 'bundled', 'index.js'),
        ];
        for (const bundled of bundledCandidates) {
            if (fileExists(bundled, fsImpl)) {
                return { command: execPath, prefixArgs: [toHostPath(bundled)] };
            }
        }
    }

    // 3. Search PATH and well-known npm global directories
    const pathEnvKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
    const rawPath = env[pathEnvKey] || '';
    const pathDirs = splitPathDirs(rawPath, platform);

    // On Windows, also include well-known global npm / pnpm bin directories if not already present
    if (platform === 'win32') {
        const appData = env.APPDATA;
        if (appData) {
            const npmGlobal = pathImpl.join(appData, 'npm');
            if (!pathDirs.includes(npmGlobal)) {
                pathDirs.push(npmGlobal);
            }
        }
        const localAppData = env.LOCALAPPDATA;
        if (localAppData) {
            const pnpmGlobal = pathImpl.join(localAppData, 'pnpm');
            if (!pathDirs.includes(pnpmGlobal)) {
                pathDirs.push(pnpmGlobal);
            }
        }
    }

    for (const dir of pathDirs) {
        for (const name of CLI_NAMES) {
            if (platform === 'win32') {
                const extensions = ['.cmd', '.bat', '.exe', '.js', ''];
                for (const ext of extensions) {
                    const candidate = pathImpl.join(dir, `${name}${ext}`);
                    if (!fileExists(candidate, fsImpl)) {
                        continue;
                    }

                    // Native Windows executable: can be spawned directly with shell: false
                    if (ext.toLowerCase() === '.exe') {
                        return { command: toHostPath(candidate), prefixArgs: [] };
                    }

                    // Raw JavaScript file: invoke via Node
                    if (ext.toLowerCase() === '.js') {
                        return { command: execPath, prefixArgs: [toHostPath(candidate)] };
                    }

                    // .cmd or .bat launcher: inspect shim or adjacent node_modules
                    if (ext.toLowerCase() === '.cmd' || ext.toLowerCase() === '.bat') {
                        try {
                            const content = readFileText(candidate, fsImpl);
                            const extracted = extractJsFromCmdShim(content, dir, pathImpl);
                            if (extracted && fileExists(extracted, fsImpl)) {
                                return { command: execPath, prefixArgs: [toHostPath(extracted)] };
                            }
                        } catch {
                            // ignore read errors
                        }

                        const adjacent = findAdjacentJsEntryPoint(dir, pathImpl, fsImpl);
                        if (adjacent) {
                            return { command: execPath, prefixArgs: [toHostPath(adjacent)] };
                        }
                    }

                    // Extensionless (e.g. bash wrapper on Windows)
                    if (ext === '') {
                        try {
                            const content = readFileText(candidate, fsImpl);
                            const match = content.match(/["'](\$basedir[\\/][^"'\r\n]+?\.[cm]?js)/i);
                            if (match && match[1]) {
                                const rel = match[1].replace(/^\$basedir[\\/]/, '').replace(/[\\/]/g, pathImpl.sep || '/');
                                const target = pathImpl.resolve(dir, rel);
                                if (fileExists(target, fsImpl)) {
                                    return { command: execPath, prefixArgs: [toHostPath(target)] };
                                }
                            }
                        } catch {
                            // ignore
                        }
                    }
                }
            } else {
                // POSIX: binaries/scripts in PATH can be spawned directly
                const candidate = pathImpl.join(dir, name);
                if (fileExists(candidate, fsImpl)) {
                    return { command: toHostPath(candidate), prefixArgs: [] };
                }
            }
        }
    }

    // 4. Default fallback:
    // On Windows, never return a .cmd for shell: false execution; return a real executable (Node)
    if (platform === 'win32') {
        return { command: execPath, prefixArgs: [] };
    }
    return { command: 'ctxspace', prefixArgs: [] };
}
