/**
 * @module commands/open
 * Re-opens an existing NexusFlow workspace in an editor.
 */

import chalk from 'chalk';
import { execa } from 'execa';
import { select } from '@inquirer/prompts';

import { loadConfig } from '../core/config.js';
import { listWorkspaces } from '../core/workspace.js';
import { detectEditors } from '../utils/detect-editors.js';
import { promptSelectEditor } from '../utils/prompts.js';

/**
 * Lets the user pick an existing workspace and open it in an editor.
 */
export async function openCommand(): Promise<void> {
  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('\nNo workspaces found.'));
    console.log(chalk.dim('  Run "nexusflow create" to create your first workspace.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n📂 Open Workspace\n'));

  // Let user pick a workspace
  const selected = await select({
    message: 'Select a workspace to open:',
    choices: workspaces.map((ws) => ({
      name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos, ${ws.assistants.join(', ')})`)}`,
      value: ws.workspacePath,
    })),
  });

  // Let user pick an editor
  const detectedEditors = await detectEditors();
  const editor = await promptSelectEditor(detectedEditors);

  if (editor) {
    try {
      await execa(editor.command, [selected], { stdio: 'ignore' });
      console.log(chalk.green(`\n✅ Opened ${selected} in ${editor.name}\n`));
    } catch {
      console.log(chalk.yellow(`\n⚠️  Could not open editor. Navigate manually:`));
      console.log(chalk.dim(`  cd "${selected}"\n`));
    }
  } else {
    console.log(chalk.dim(`\n  To navigate: cd "${selected}"\n`));
  }
}
