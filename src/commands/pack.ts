import chalk from 'chalk';
import ora from 'ora';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig } from '../core/workspace.js';
import { packWorkspace } from '../core/packer.js';

/**
 * Packs the workspace codebase into a single token-efficient XML file.
 */
export async function packCommand(
  workspaceArg?: string,
  options: { compress?: boolean } = {}
): Promise<void> {
  console.log(chalk.bold.cyan('\n📦 NexusFlow — Codebase Context Packing\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const spinner = ora('Packing workspace repositories using Repomix...').start();
  try {
    const result = await packWorkspace(workspacePath, { compress: options.compress });
    spinner.succeed('Workspace packed successfully!');

    console.log(`\n📄 ${chalk.bold('Packed Output File:')} ${chalk.green(result.outputPath)}`);
    console.log(`📊 ${chalk.bold('Total Files:')}       ${result.totalFiles}`);
    console.log(`🔠 ${chalk.bold('Total Characters:')}  ${result.totalCharacters}`);
    console.log(`💾 ${chalk.bold('File Size:')}        ${(result.fileSize / 1024).toFixed(2)} KB\n`);
  } catch (error: any) {
    spinner.fail('Failed to pack workspace');
    console.error(chalk.red(`  Error: ${error.message}`));
  }
}

/**
 * Resolves the workspace path from argument, cwd, or list.
 */
async function resolveWorkspace(workspaceArg?: string): Promise<string | null> {
  if (workspaceArg) {
    const absolutePath = path.resolve(workspaceArg);
    try {
      await fs.access(path.join(absolutePath, 'nexusflow.json'));
      return absolutePath;
    } catch {
      console.error(chalk.red(`✖ Invalid workspace: No nexusflow.json found at ${absolutePath}`));
      return null;
    }
  }

  const cwdFeature = await loadFeatureConfig(process.cwd());
  if (cwdFeature) return process.cwd();

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await select({
    message: 'Select a workspace to pack:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
      value: ws.workspacePath,
    })),
  });

  return selected;
}
