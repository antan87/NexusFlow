/**
 * @module commands/init
 * Initializes the NexusFlow configuration.
 */

import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import path from 'node:path';
import os from 'node:os';

import { loadConfig, saveConfig, ensureConfigDir } from '../core/config.js';

/**
 * Initializes NexusFlow configuration interactively.
 * Creates ~/.nexusflow/config.json with user preferences.
 */
export async function initCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n⚙️  NexusFlow — Initialize\n'));

  await ensureConfigDir();
  const existing = await loadConfig();

  const devDir = await input({
    message: 'Development directory (where your repos live):',
    default: existing.devDir || path.join(os.homedir(), 'dev'),
  });

  const workspacesDir = await input({
    message: 'Workspaces directory (where feature workspaces are created):',
    default: existing.workspacesDir || path.join(devDir, 'workspaces'),
  });

  const scanDepth = await input({
    message: 'How deep to scan for repos (directory levels):',
    default: String(existing.scanDepth || 2),
    validate: (value: string) => {
      const num = parseInt(value, 10);
      if (isNaN(num) || num < 1 || num > 10) return 'Enter a number between 1 and 10';
      return true;
    },
  });

  const config = {
    ...existing,
    devDir: devDir.trim(),
    workspacesDir: workspacesDir.trim(),
    scanDepth: parseInt(scanDepth, 10),
  };

  await saveConfig(config);

  console.log(chalk.green('\n✅ Configuration saved!\n'));
  console.log(chalk.dim('  Config file: ~/.nexusflow/config.json'));
  console.log(chalk.dim(`  Dev dir:     ${config.devDir}`));
  console.log(chalk.dim(`  Workspaces:  ${config.workspacesDir}`));
  console.log(chalk.dim(`  Scan depth:  ${config.scanDepth}`));
  console.log(chalk.dim('\n  Run "nexusflow create" to create your first workspace.\n'));
}
