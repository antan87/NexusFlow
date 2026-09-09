/**
 * @module utils/user-paths
 * Resolves standard user binary and tool directories across operating systems.
 * Provides augmented PATH strings and executable lookup so GUI-spawned processes
 * and CLI adapters can discover developer tools (Node, NVM, npm global packages,
 * Cargo, Homebrew, Claude Code, Antigravity, Codex, etc.).
 */

import * as fsSync from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Returns candidate directory paths where developer CLI tools and package managers
 * commonly install binaries.
 */
export function getUserCandidatePaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string[] {
  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const candidates: string[] = [];

  if (platform === 'darwin') {
    candidates.push(
      '/opt/homebrew/bin',
      '/usr/local/bin',
      p.join(homeDir, '.local', 'bin'),
      p.join(homeDir, '.cargo', 'bin'),
      p.join(homeDir, '.npm-global', 'bin'),
    );
  } else if (platform === 'linux') {
    candidates.push(
      '/usr/local/bin',
      p.join(homeDir, '.local', 'bin'),
      p.join(homeDir, '.npm-global', 'bin'),
      p.join(homeDir, '.cargo', 'bin'),
    );
  } else if (isWin) {
    if (env.APPDATA) candidates.push(p.join(env.APPDATA, 'npm'));
    if (env.LOCALAPPDATA) {
      candidates.push(
        p.join(env.LOCALAPPDATA, 'Programs'),
        p.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'),
      );
    }
    candidates.push(p.join(homeDir, '.cargo', 'bin'));
  }

  // Node runtime directory (where global npm tools for the active Node live)
  if (process.execPath && !process.execPath.toLowerCase().includes('electron')) {
    const nodeBinDir = path.dirname(process.execPath);
    candidates.push(nodeBinDir);
  }

  // NVM node versions (Linux & macOS)
  if (platform !== 'win32') {
    const nvmDir = env.NVM_DIR || p.join(homeDir, '.nvm');
    const nvmNodeDir = p.join(nvmDir, 'versions', 'node');
    try {
      if (fsSync.existsSync(nvmNodeDir)) {
        const versions = fsSync.readdirSync(nvmNodeDir).sort().reverse();
        for (const version of versions) {
          const binPath = p.join(nvmNodeDir, version, 'bin');
          candidates.push(binPath);
        }
      }
    } catch {
      // Ignore unreadable nvm directories
    }

    // FNM, Volta, Bun, pnpm
    candidates.push(
      p.join(homeDir, '.local', 'share', 'fnm', 'current', 'bin'),
      p.join(homeDir, '.fnm', 'current', 'bin'),
      p.join(homeDir, '.volta', 'bin'),
      p.join(homeDir, '.bun', 'bin'),
      p.join(homeDir, '.local', 'share', 'pnpm'),
    );
  }

  return candidates;
}

/**
 * Returns an augmented PATH string containing existing PATH entries plus any
 * existing candidate directories on the host.
 */
export function getAugmentedPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
): string {
  const isWin = platform === 'win32';
  const pathSep = isWin ? ';' : ':';
  const rawPath = env.PATH ?? env.Path ?? '';
  const existingDirs = rawPath ? rawPath.split(pathSep).map((d) => d.replace(/^"|"$/g, '').trim()).filter(Boolean) : [];
  const existingSet = new Set(existingDirs);

  const extraDirs: string[] = [];
  const candidates = getUserCandidatePaths(platform, env, homeDir);
  for (const dir of candidates) {
    if (!existingSet.has(dir)) {
      try {
        if (fsSync.existsSync(dir)) {
          extraDirs.push(dir);
          existingSet.add(dir);
        }
      } catch {
        // Skip unreadable paths
      }
    }
  }

  return [...existingDirs, ...extraDirs].join(pathSep);
}

/**
 * Resolves an executable on PATH the way a shell would, honoring PATHEXT on
 * Windows and file permissions on POSIX.
 */
export function findExecutable(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const isWin = platform === 'win32';
  const pathValue = env.PATH ?? env.Path ?? '';
  if (!pathValue) return null;

  const separator = isWin ? ';' : ':';
  const p = isWin ? path.win32 : path.posix;
  const extensions = isWin
    ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];

  for (const dir of pathValue.split(separator).filter(Boolean)) {
    const cleanDir = dir.replace(/^"|"$/g, '').trim();
    if (!cleanDir) continue;
    const base = p.join(cleanDir, name);
    const candidates = [
      base,
      ...extensions.map((ext) => base + (ext.startsWith('.') ? ext : `.${ext}`).toLowerCase()),
    ];
    for (const candidate of candidates) {
      try {
        const stat = fsSync.statSync(candidate);
        if (stat.isFile()) {
          if (!isWin) {
            fsSync.accessSync(candidate, fsSync.constants.X_OK);
          }
          return candidate;
        }
      } catch {
        // Not here or not executable; keep looking.
      }
    }
  }

  return null;
}
