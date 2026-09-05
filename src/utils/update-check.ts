/**
 * @module utils/update-check
 * Checks for the latest NexusFlow desktop release on GitHub. The server only
 * reports read-only metadata; native downloads/installs belong to Electron or
 * the explicit `nexusflow desktop install` command.
 */

import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';

import { loadConfig, saveConfig } from '../core/config.js';

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl?: string | null;
  releaseUrl?: string | null;
  releaseNotes?: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url?: string;
  body: string;
  assets: GitHubAsset[];
}

const RELEASE_PAGE_URL = 'https://github.com/antan87/NexusFlow/releases/latest';

/**
 * Resolves the current package version by searching for package.json upward
 * from the directory of the executing code.
 */
export function getCurrentVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    let currentDir = __dirname;
    for (let i = 0; i < 5; i++) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  } catch {
    // Fallback if filesystem access fails
  }
  return '0.0.0';
}

/**
 * Checks for updates from the GitHub Releases API (antan87/NexusFlow).
 * Employs a 24-hour cache unless forced.
 *
 * @param force - If true, ignores the 24-hour cache and fetches immediately.
 * @returns The update status, or null if the check fails (e.g. offline).
 */
export async function checkForUpdates(force = false): Promise<UpdateStatus | null> {
  const currentVersion = getCurrentVersion();
  const config = await loadConfig();

  const now = Date.now();
  const lastCheck = config.lastUpdateCheck ? new Date(config.lastUpdateCheck).getTime() : 0;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Use cached result if within 24 hours and not forced
  if (!force && lastCheck && (now - lastCheck < ONE_DAY_MS) && config.latestVersion) {
    return {
      currentVersion,
      latestVersion: config.latestVersion,
      updateAvailable: isNewerVersion(currentVersion, config.latestVersion),
      downloadUrl: config.latestDownloadUrl,
      releaseUrl: RELEASE_PAGE_URL,
      releaseNotes: config.latestReleaseNotes,
    };
  }

  try {
    const response = await fetch('https://api.github.com/repos/antan87/NexusFlow/releases/latest', {
      headers: { 'User-Agent': 'NexusFlow-Updater' },
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`GitHub API returned status ${response.status}`);
    }

    const data = await response.json() as GitHubRelease;
    const latestVersion = data.tag_name.replace(/^v/, '');
    
    // Resolve a platform-matching release asset for read-only browser links.
    // electron-updater handles packaged desktop downloads independently.
    let downloadUrl: string | null = null;
    const targetAsset = (data.assets ?? []).find((asset) => {
      const name = asset.name.toLowerCase();
      if (process.platform === 'win32') return name.endsWith('.exe') && name.includes('setup');
      if (process.platform === 'linux') return name.endsWith('.appimage');
      if (process.platform === 'darwin') return name.endsWith('.dmg');
      return false;
    });
    if (targetAsset) {
      downloadUrl = targetAsset.browser_download_url;
    }

    const releaseNotes = data.body || '';

    // Cache results
    config.lastUpdateCheck = new Date().toISOString();
    config.latestVersion = latestVersion;
    config.latestDownloadUrl = downloadUrl;
    config.latestReleaseNotes = releaseNotes;
    await saveConfig(config);

    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(currentVersion, latestVersion),
      downloadUrl,
      releaseUrl: data.html_url || RELEASE_PAGE_URL,
      releaseNotes,
    };
  } catch {
    // Fallback: If offline or check fails, return cached version status if available
    if (config.latestVersion) {
      return {
        currentVersion,
        latestVersion: config.latestVersion,
        updateAvailable: isNewerVersion(currentVersion, config.latestVersion),
        downloadUrl: config.latestDownloadUrl,
        releaseUrl: RELEASE_PAGE_URL,
        releaseNotes: config.latestReleaseNotes,
      };
    }
    return null;
  }
}

/**
 * Semver comparison over major.minor.patch. Compares only the numeric core so
 * a prerelease/build suffix (e.g. `1.8.0-rc.1`) can't poison a segment into
 * NaN — the previous `.map(Number)` produced NaN for such a part, and every
 * NaN comparison is false, so a real update was silently reported as "up to
 * date". A stable release supersedes a prerelease of the same numeric core.
 */
export function isNewerVersion(current: string, latest: string): boolean {
  if (!current || !latest || current === latest || current === '0.0.0' || current === 'unknown') {
    return false;
  }

  const core = (v: string): number[] =>
    v.trim().replace(/^v/, '').split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const currentParts = core(current);
  const latestParts = core(latest);

  for (let i = 0; i < 3; i++) {
    const curr = currentParts[i] ?? 0;
    const lat = latestParts[i] ?? 0;
    if (lat > curr) return true;
    if (curr > lat) return false;
  }

  // Equal numeric core: a stable `latest` supersedes a prerelease `current`.
  return current.includes('-') && !latest.includes('-');
}

/**
 * Prints a clean, premium terminal notification banner if an update is available.
 */
export function printUpdateBanner(status: UpdateStatus): void {
  if (!status.updateAvailable) return;

  const msg = `Update available: ${chalk.red(status.currentVersion)} → ${chalk.green(status.latestVersion)}`;
  const runMsg = `Run ${chalk.cyan('npm install -g @mrpatronz/nexusflow')} to update!`;

  const cleanMsg = `Update available: ${status.currentVersion} → ${status.latestVersion}`;
  const cleanRunMsg = `Run npm install -g @mrpatronz/nexusflow to update!`;
  const width = Math.max(cleanMsg.length, cleanRunMsg.length) + 2;

  const padMsg = ' '.repeat(width - cleanMsg.length);
  const padRunMsg = ' '.repeat(width - cleanRunMsg.length);

  const border = '─'.repeat(width);
  console.log();
  console.log(chalk.yellow(`┌${border}┐`));
  console.log(chalk.yellow(`│ ${msg}${padMsg} │`));
  console.log(chalk.yellow(`│ ${runMsg}${padRunMsg} │`));
  console.log(chalk.yellow(`└${border}┘`));
  console.log();
}

import { execa } from 'execa';

export interface ToolUpdateStatus {
  id: string;
  name: string;
  command: string;
  installed: boolean;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  updateCmd: string;
}

let cachedToolsStatus: { timestamp: number; data: ToolUpdateStatus[] } | null = null;
const TOOLS_CACHE_TTL = 60_000; // 1 minute

export async function getToolsStatus(force = false): Promise<ToolUpdateStatus[]> {
  if (!force && cachedToolsStatus && Date.now() - cachedToolsStatus.timestamp < TOOLS_CACHE_TTL) {
    return cachedToolsStatus.data;
  }

  const currentVersion = getCurrentVersion();
  const tools = [
    {
      id: 'nexusflow',
      name: 'NexusFlow Engine',
      command: 'nexusflow',
      npmPackage: '@mrpatronz/nexusflow',
      updateCmd: 'npm install -g @mrpatronz/nexusflow',
      getCurrent: async () => currentVersion,
    },
    {
      id: 'antigravity',
      name: 'Antigravity CLI',
      command: 'agy',
      npmPackage: '',
      updateCmd: 'agy update',
      getCurrent: async () => {
        try {
          const res = await execa('agy', ['--version'], {
            reject: false,
            shell: process.platform === 'win32',
          });
          if (res.exitCode === 0) return res.stdout.trim();
        } catch {}
        return '';
      }
    },
    {
      id: 'claude',
      name: 'Claude Code CLI',
      command: 'claude',
      npmPackage: '@anthropic-ai/claude-code',
      updateCmd: 'npm install -g @anthropic-ai/claude-code',
      getCurrent: async () => {
        try {
          const res = await execa('claude', ['--version'], {
            reject: false,
            shell: process.platform === 'win32',
          });
          if (res.exitCode === 0) return res.stdout.trim();
        } catch {}
        return '';
      }
    }
  ];

  const results = await Promise.all(
    tools.map(async (t): Promise<ToolUpdateStatus> => {
      let installed = false;
      let currentVal = '';
      let latestVal = '';

      try {
        currentVal = await t.getCurrent();
        installed = currentVal !== '';
      } catch {}

      if (installed && t.npmPackage) {
        try {
          const response = await fetch(`https://registry.npmjs.org/${t.npmPackage}/latest`, {
            signal: AbortSignal.timeout(2000),
          });
          if (response.ok) {
            const data = await response.json() as { version: string };
            latestVal = data.version;
          }
        } catch {}
      }

      if (!latestVal) {
        latestVal = currentVal || '1.0.0';
      }

      return {
        id: t.id,
        name: t.name,
        command: t.command,
        installed,
        currentVersion: currentVal || 'Not Installed',
        latestVersion: latestVal,
        updateAvailable: installed && isNewerVersion(currentVal, latestVal),
        updateCmd: t.updateCmd,
      };
    })
  );

  cachedToolsStatus = { timestamp: Date.now(), data: results };
  return results;
}
