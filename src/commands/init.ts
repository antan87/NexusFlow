/**
 * @module commands/init
 * Initializes the NexusFlow configuration.
 */

import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import path from 'node:path';
import os from 'node:os';

import { loadConfig, saveConfig, ensureConfigDir, getConfigDir } from '../core/config.js';
import { commitWorkspaceArtifacts, ensureWorkspaceGitRepository } from '../core/workspace-git.js';
import { BRAND_NAME, CLI_NAME } from '../core/constants.js';

/**
 * Initializes ContextSpace configuration interactively.
 * Creates ~/.contextspace/config.json with user preferences.
 */
export async function initCommand(options: { workspace?: string | boolean } = {}): Promise<void> {
  if (options.workspace) {
    const workspacePath = path.resolve(typeof options.workspace === 'string' ? options.workspace : process.cwd());
    await ensureWorkspaceGitRepository(workspacePath);
    const result = await commitWorkspaceArtifacts(workspacePath, `chore(${CLI_NAME}): adopt workspace artifacts`);
    console.log(chalk.green(result.committed ? `✔ Initialized and committed workspace artifacts at ${workspacePath}.` : `✔ Workspace artifact repository is already clean at ${workspacePath}.`));
    return;
  }
  console.log(chalk.bold.cyan(`\n⚙️  ${BRAND_NAME} — Initialize\n`));

  await ensureConfigDir();
  const existing = await loadConfig();

  // ── 1. Basic Directories ──────────────────────────────────────────────
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
  console.log(chalk.dim(`  Config file: ${path.join(getConfigDir(), 'config.json')}`));
  console.log(chalk.dim(`  Dev dir:     ${config.devDir}`));
  console.log(chalk.dim(`  Workspaces:  ${config.workspacesDir}`));
  console.log(chalk.dim(`  Scan depth:  ${config.scanDepth}`));
  console.log(chalk.dim(`\n  Run "${CLI_NAME} create" to create your first workspace.\n`));
}
