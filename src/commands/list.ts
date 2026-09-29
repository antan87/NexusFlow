/**
 * @module commands/list
 * Lists all existing NexusFlow workspaces.
 */

import chalk from 'chalk';

import { loadConfig } from '../core/config.js';
import { listWorkspaces } from '../core/workspace.js';
import { BRAND_NAME, CLI_NAME } from '../core/constants.js';

/**
 * Lists all existing workspaces, showing feature name, repos, and status.
 */
export async function listCommand(options?: { json?: boolean; archived?: boolean; all?: boolean }): Promise<void> {
  const config = await loadConfig();
  const everything = await listWorkspaces(config.workspacesDir);
  // Archived workspaces are records: hidden unless asked for.
  const workspaces = options?.all
    ? everything
    : everything.filter((ws) => Boolean(ws.archivedAt) === Boolean(options?.archived));
  const hiddenArchived = options?.all || options?.archived ? 0 : everything.length - workspaces.length;

  if (options?.json) {
    console.log(JSON.stringify(workspaces, null, 2));
    return;
  }

  if (workspaces.length === 0) {
    console.log(chalk.yellow(options?.archived ? '\nNo archived workspaces.' : '\nNo workspaces found.'));
    if (hiddenArchived > 0) console.log(chalk.dim(`  ${hiddenArchived} archived workspace(s) hidden; show them with "${CLI_NAME} list --archived".`));
    console.log(chalk.dim(`  Workspaces directory: ${config.workspacesDir}`));
    console.log(chalk.dim(`  Run "${CLI_NAME} create" to create your first workspace.\n`));
    return;
  }

  console.log(chalk.bold.cyan(`\n📂 ${BRAND_NAME} Workspaces (${workspaces.length})\n`));

  for (const ws of workspaces) {
    const repoCount = ws.repos.length;
    const aiList = ws.assistants.join(', ');
    const date = new Date(ws.createdAt).toLocaleDateString();
    const modeTag = ws.archivedAt
      ? chalk.magenta(` [archived ${new Date(ws.archivedAt).toLocaleDateString()}]`)
      : ws.mode === 'in-place' ? chalk.blue(' [in-place]') : '';

    console.log(
      `  ${chalk.bold(ws.branchName)}${modeTag} ${chalk.dim(`(${date})`)}`,
    );
    console.log(
      `    ${chalk.dim('Repos:')}  ${repoCount} project${repoCount !== 1 ? 's' : ''}`,
    );
    console.log(
      `    ${chalk.dim('AI:')}     ${aiList || 'none'}`,
    );
    console.log(
      `    ${chalk.dim('Path:')}   ${ws.workspacePath}`,
    );
    console.log();
  }
  if (hiddenArchived > 0) {
    console.log(chalk.dim(`  ${hiddenArchived} archived workspace(s) hidden; show them with "${CLI_NAME} list --archived".\n`));
  }
}
