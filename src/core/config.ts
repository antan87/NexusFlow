/**
 * @module core/config
 * Manages NexusFlow configuration stored at ~/.nexusflow/config.json.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import type { NexusFlowConfig } from '../types.js';

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
    packContextXml: false,
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
export async function loadConfig(): Promise<NexusFlowConfig> {
  const configPath = path.join(getConfigDir(), CONFIG_FILE_NAME);

  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NexusFlowConfig>;

    // Merge with defaults so newly-added keys are always present.
    const merged = { ...getDefaultConfig(), ...parsed };
    if (parsed.localLlm) {
      merged.localLlm = { ...getDefaultConfig().localLlm, ...parsed.localLlm };
    }
    return merged;
  } catch {
    // File doesn't exist or is unreadable — return defaults.
    return getDefaultConfig();
  }
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
}
