/**
 * @module core/config
 * Manages NexusFlow configuration stored at ~/.nexusflow/config.json.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import chalk from 'chalk';

import type { NexusFlowConfig } from '../types.js';
import { getStorageProvider, setActiveStorageProvider } from './adapters/registry.js';
import { debugLog } from '../utils/debug.js';

/**
 * Activates the configured storage provider, falling back to local storage on
 * failure. Unless `quiet`, a failure prints a visible warning (a silent
 * fallback from e.g. the Obsidian adapter to local is a nasty surprise). The
 * quiet path exists for bootstrap, where plugin-provided adapters are not yet
 * registered and a warning would be a false alarm.
 */
function activateStorageProvider(config: NexusFlowConfig, quiet: boolean): void {
  const providerName = config.storageProvider || 'local';
  try {
    const provider = getStorageProvider(providerName);
    const adapterSettings = config.adapterConfig?.[providerName] ?? {};
    if (provider.configure) {
      provider.configure(adapterSettings);
    }
    setActiveStorageProvider(provider);
  } catch (error) {
    if (!quiet) {
      console.warn(
        chalk.yellow(`⚠ Storage adapter "${providerName}" failed to activate — falling back to local storage.`),
      );
    }
    debugLog('storage', `activate "${providerName}"`, error);
    // Deterministic fallback rather than relying on the registry's implicit default.
    try {
      setActiveStorageProvider(getStorageProvider('local'));
    } catch (fallbackError) {
      debugLog('storage', 'local fallback failed', fallbackError);
    }
  }
}

/** Name of the config directory under the user's home folder. */
const CONFIG_DIR_NAME = '.nexusflow';

/** Name of the config file. */
const CONFIG_FILE_NAME = 'config.json';

/**
 * Returns the absolute path to the NexusFlow config directory (~/.nexusflow).
 */
export function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Returns a NexusFlowConfig populated with sensible defaults.
 */
export function getDefaultConfig(): NexusFlowConfig {
  return {
    version: '1.0.0',
    devDir: path.join(os.homedir(), 'dev'),
    workspacesDir: path.join(os.homedir(), 'dev', 'workspaces'),
    defaultAssistant: null,
    defaultEditor: null,
    scanDepth: 2,
    excludePatterns: [
      '**/node_modules/**',
      '**/bin/**',
      '**/obj/**',
      '**/dist/**',
      '**/out/**',
      '**/.git/**',
      '**/*.lock',
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/yarn.lock',
      '**/*.png',
      '**/*.jpg',
      '**/*.jpeg',
      '**/*.gif',
      '**/*.svg',
      '**/*.ico',
      '**/*.pdf',
      '**/*.zip',
      '**/*.tar.gz',
      '**/.vs/**',
      '**/.vscode/**',
      '**/.idea/**',
    ],
    localLlm: {
      enabled: false,
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      model: 'qwen2.5-coder:1.5b',
    },
  };
}

/**
 * Ensures the ~/.nexusflow directory exists, creating it if necessary.
 */
export async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
}

/**
 * Loads the NexusFlow config from disk.
 * Returns default values when the config file does not exist yet.
 *
 * @returns The loaded or default configuration.
 */
export async function loadConfig(options: { quiet?: boolean } = {}): Promise<NexusFlowConfig> {
  const configPath = path.join(getConfigDir(), CONFIG_FILE_NAME);
  const quiet = options.quiet ?? false;

  let merged: NexusFlowConfig = getDefaultConfig();

  let raw: string | null = null;
  try {
    raw = await fs.readFile(configPath, 'utf-8');
  } catch {
    // File doesn't exist (first run) or is unreadable — defaults are correct.
    raw = null;
  }

  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<NexusFlowConfig>;
      // Merge with defaults so newly-added keys are always present.
      merged = { ...getDefaultConfig(), ...parsed };
      if (parsed.localLlm) {
        merged.localLlm = { ...getDefaultConfig().localLlm, ...parsed.localLlm };
      }
    } catch (error) {
      // A corrupted config is worth surfacing — silently reverting devDir /
      // workspacesDir / storageProvider to defaults is a nasty failure mode.
      if (!quiet) {
        console.warn(chalk.yellow('⚠ ~/.nexusflow/config.json is invalid JSON — using defaults for this run.'));
      }
      debugLog('config', 'parse config.json', error);
      merged = getDefaultConfig();
    }
  }

  activateStorageProvider(merged, quiet);
  return merged;
}

/**
 * Persists the given configuration to ~/.nexusflow/config.json.
 * Creates the config directory if it doesn't exist.
 *
 * @param config - The configuration to save.
 */
export async function saveConfig(config: NexusFlowConfig): Promise<void> {
  await ensureConfigDir();

  const configPath = path.join(getConfigDir(), CONFIG_FILE_NAME);
  const data = JSON.stringify(config, null, 2) + '\n';
  await fs.writeFile(configPath, data, 'utf-8');

  // Re-activate the storage provider based on the saved configuration.
  activateStorageProvider(config, false);
}
