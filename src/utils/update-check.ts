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
  return '0.1.3'; // Sensible fallback (active release)
}

/**
 * Checks for updates from the NPM registry.
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
    };
  }

  try {
    // Query NPM registry latest endpoint
    const response = await fetch('https://registry.npmjs.org/@mrpatronz/nexusflow/latest', {
      signal: AbortSignal.timeout(3000), // 3-second timeout to prevent blocking CLI/server
    });

    if (!response.ok) {
      throw new Error(`NPM registry returned status ${response.status}`);
    }

    const data = await response.json() as { version: string };
    const latestVersion = data.version;

    // Cache results
    config.lastUpdateCheck = new Date().toISOString();
    config.latestVersion = latestVersion;
    await saveConfig(config);

    return {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(currentVersion, latestVersion),
    };
  } catch {
    // Fallback: If offline or check fails, return cached version status if available
    if (config.latestVersion) {
      return {
        currentVersion,
        latestVersion: config.latestVersion,
        updateAvailable: isNewerVersion(currentVersion, config.latestVersion),
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
