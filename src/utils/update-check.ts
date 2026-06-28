/**
 * @module utils/update-check
 * Checks for updates to the NexusFlow package on the NPM registry.
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
  releaseNotes?: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string;
  assets: GitHubAsset[];
}

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
        return pkg.version;
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  } catch {
    // Fallback if filesystem access fails
  }
  return '0.1.5'; // Sensible fallback (active release)
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
    
    // Resolve platform-matching asset (e.g. Setup.exe for Windows)
    let downloadUrl: string | null = null;
    const targetAsset = data.assets.find(asset => {
      return asset.name.endsWith('.exe') && asset.name.toLowerCase().includes('setup');
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
        releaseNotes: config.latestReleaseNotes,
      };
    }
    return null;
  }
}

/**
 * Simple semver comparison (checks major.minor.patch).
 */
function isNewerVersion(current: string, latest: string): boolean {
  if (current === latest) return false;

  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const curr = currentParts[i] || 0;
    const lat = latestParts[i] || 0;
    if (lat > curr) return true;
    if (curr > lat) return false;
  }

  return false;
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

export async function getToolsStatus(force = false): Promise<ToolUpdateStatus[]> {
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
      id: 'repomix',
      name: 'Repomix (Codebase Packer)',
      command: 'repomix',
      npmPackage: 'repomix',
      updateCmd: 'npm install -g repomix',
      getCurrent: async () => {
        try {
          const res = await execa('repomix', ['--version'], {
            reject: false,
            shell: process.platform === 'win32',
          });
          if (res.exitCode === 0) return res.stdout.trim();
        } catch {}
        try {
          const res = await execa('npx', ['repomix', '--version'], {
            reject: false,
            shell: process.platform === 'win32',
          });
          if (res.exitCode === 0) return res.stdout.trim();
        } catch {}
        return '';
      }
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

  const results: ToolUpdateStatus[] = [];

  for (const t of tools) {
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

    results.push({
      id: t.id,
      name: t.name,
      command: t.command,
      installed,
      currentVersion: currentVal || 'Not Installed',
      latestVersion: latestVal,
      updateAvailable: installed && isNewerVersion(currentVal, latestVal),
      updateCmd: t.updateCmd,
    });
  }

  return results;
}

