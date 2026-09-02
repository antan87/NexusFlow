/**
 * @module commands/diff
 * Displays diff summaries across all repositories in a workspace, including
 * commits that exist locally but have not been pushed yet.
 */

import chalk from 'chalk';

import { loadFeatureConfig } from '../core/workspace.js';
import { getWorkspaceDiffReport } from '../core/diff.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import { BRAND_NAME } from '../core/constants.js';

interface DiffOptions {
  /** Restrict the diff to these repos (by directory name). */
  repo?: string[];
  /** Output raw JSON format. */
  json?: boolean;
}

/**
 * Executes the diff command.
 *
 * @param workspaceArg - Optional workspace path.
 * @param options - Optional flags.
 */
export async function diffCommand(workspaceArg?: string, options?: DiffOptions): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace to view diff:');
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    if (options?.json) {
      console.log(JSON.stringify({ error: 'Failed to load workspace configuration' }));
      return;
    }
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  let results;
  try {
    results = await getWorkspaceDiffReport(workspacePath, options?.repo);
  } catch (error) {
    if (options?.json) {
      console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    console.error(chalk.red(`✖ ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  if (options?.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  console.log(chalk.bold.cyan(`\n🔍 ${BRAND_NAME} — Workspace Diff Summary\n`));

  if (results.length === 0) {
    console.log(chalk.green('✅ All repositories are clean and pushed.\n'));
    return;
  }

  // Print unified table. Size the name column to the actual repo names so
  // long names (common in real workspaces) don't overrun the other columns.
  const nameW = Math.max(10, ...results.map((r) => r.name.length)) + 1;
  console.log(chalk.bold(
    'Repository'.padEnd(nameW) + ' | ' +
    'Files'.padEnd(6) + ' | ' +
    'Additions'.padEnd(10) + ' | ' +
    'Deletions'.padEnd(10) + ' | ' +
    'Unpushed'.padEnd(8)
  ));
  console.log(chalk.dim('─'.repeat(nameW + 45)));

  for (const res of results) {
    const fileStr = res.filesChanged.toString().padEnd(6);
    const addStr = `+${res.additions}`.padEnd(10);
    const delStr = `-${res.deletions}`.padEnd(10);
    const unpushedStr = res.unpushed === null ? '?'.padEnd(8) : String(res.unpushed).padEnd(8);
    console.log(
      chalk.bold(res.name.padEnd(nameW)) + ' | ' +
      fileStr + ' | ' +
      chalk.green(addStr) + ' | ' +
      chalk.red(delStr) + ' | ' +
      (res.unpushed ? chalk.yellow(unpushedStr) : chalk.dim(unpushedStr))
    );
  }

  console.log('\n' + chalk.bold('Detailed Diff Stats:'));
  for (const res of results) {
    console.log(`\n📂 ${chalk.bold.cyan(res.name)}:`);
    console.log(chalk.dim(res.summary.split('\n').map(l => `  ${l}`).join('\n')));
    if (res.unpushed && res.unpushed > 0) {
      console.log(chalk.yellow(`  ⬆ ${res.unpushed} commit${res.unpushed === 1 ? '' : 's'} not pushed to origin — run "nexusflow commit" or "git push"`));
    }
  }

  console.log();
}
