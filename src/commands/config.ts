/**
 * @module commands/config
 * CLI command to view and update NexusFlow configuration.
 *
 * Usage:
 *   nexusflow config                           # Show current config
 *   nexusflow config set storageProvider local  # Set a config key
 *   nexusflow config get storageProvider        # Get a specific key
 */

import { loadConfig, saveConfig } from '../core/config.js';
import { BRAND_NAME } from '../core/constants.js';

/**
 * Displays the current NexusFlow configuration.
 */
export async function configShowCommand(): Promise<void> {
  const config = await loadConfig();
  console.log(`\n⚙️  ${BRAND_NAME} Configuration\n`);
  console.log(JSON.stringify(config, null, 2));
  console.log();
}

/**
 * Gets a specific configuration key.
 */
export async function configGetCommand(key: string): Promise<void> {
  const config = await loadConfig();
  const value = (config as unknown as Record<string, unknown>)[key];

  if (value === undefined) {
    console.log(`  Key "${key}" is not set.`);
  } else {
    console.log(`  ${key} = ${typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}`);
  }
}

/**
 * Sets a specific configuration key.
 */
export async function configSetCommand(key: string, value: string): Promise<void> {
  const config = await loadConfig();

  // Parse booleans and numbers
  let parsed: unknown = value;
  if (value === 'true') parsed = true;
  else if (value === 'false') parsed = false;
  else if (!isNaN(Number(value)) && value.trim() !== '') parsed = Number(value);

  (config as unknown as Record<string, unknown>)[key] = parsed;
  await saveConfig(config);
  console.log(`  ✔ Set ${key} = ${String(parsed)}`);
}
