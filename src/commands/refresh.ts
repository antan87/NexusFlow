import chalk from 'chalk';
import { search } from '@inquirer/prompts';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

import { loadConfig } from '../core/config.js';
import { listWorkspaces, loadFeatureConfig, saveFeatureConfig } from '../core/workspace.js';
import { refreshWorkspace } from '../core/refresh.js';
import { getWorkflowTemplates } from '../utils/workflows.js';
import { suggestWorkflow } from '../utils/workflow-advisor.js';

/**
 * Runs the refresh command.
 * Regenerates the workspace context files — re-analyzing only repos whose
 * content changed since the last run (use --force to re-analyze everything).
 *
 * @param options - CLI options, e.g. { force: true, strategy: 'solo-developer' }.
 * @param workspaceArg - Optional workspace path.
 */
export async function refreshCommand(
  options: { force?: boolean; strategy?: string },
  workspaceArg?: string,
): Promise<void> {
  console.log(chalk.bold.cyan('\n🔄 NexusFlow — Refresh Workspace Context\n'));

  const workspacePath = await resolveWorkspace(workspaceArg);
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration. Ensure nexusflow.json exists.'));
    return;
  }

  // Handle --strategy flag: update teamworkInstructions before regenerating
  if (options.strategy) {
    const strategyId = options.strategy;

    if (strategyId === 'auto') {
      const config = await loadConfig();
      const { resolveRepoInfos } = await import('../core/workspace.js');
      const repos = await resolveRepoInfos(feature.repos);
      try {
        const suggestion = await suggestWorkflow(feature.description, repos);
        feature.teamworkInstructions = suggestion.customInstructions;
        console.log(chalk.green(`  ✔ Auto-updated strategy for ${chalk.bold(suggestion.difficulty)} difficulty task`));
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Failed to auto-suggest strategy: ${err instanceof Error ? err.message : String(err)}`));
      }
    } else {
      const templates = await getWorkflowTemplates();
      const template = templates.find((t) => t.id === strategyId);
      if (template) {
        feature.teamworkInstructions = template.content;
        console.log(chalk.green(`  ✔ Updated strategy to: ${chalk.bold(template.name)}`));
      } else {
        console.error(chalk.red(`  ✖ Strategy template "${strategyId}" not found. Use "nexusflow strategy list" to see available templates.`));
        return;
      }
    }

    // Persist the updated feature config
    await saveFeatureConfig(workspacePath, feature);
  }

  console.log('Refreshing context for all repositories...');
  if (options.force) {
    console.log(chalk.dim('Force mode: ignoring analysis cache.'));
  }

  let report;
  try {
    report = await refreshWorkspace(workspacePath, { force: options.force });
  } catch (error) {
    console.error(chalk.red(`✖ Failed to refresh: ${error instanceof Error ? error.message : String(error)}`));
    return;
  }

  if (report.reusedRepos.length > 0) {
    console.log(
      chalk.dim(
        `\n♻️  Token-efficient refresh: ${report.reusedRepos.length} unchanged repo(s) reused cached analysis` +
        (report.analyzedRepos.length > 0 ? `, ${report.analyzedRepos.length} re-analyzed.` : '.'),
      ),
    );
  }
  console.log(chalk.bold.green('\n✅ Workspace context successfully refreshed!\n'));
}

/**
 * Resolves a workspace path.
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
  if (cwdFeature) return cwdFeature.workspacePath;

  const config = await loadConfig();
  const workspaces = await listWorkspaces(config.workspacesDir);

  if (workspaces.length === 0) {
    console.log(chalk.yellow('No workspaces found.\n'));
    return null;
  }

  const selected = await search({
    message: 'Search and select a workspace to refresh:',
    source: async (input) => {
      const query = (input || '').toLowerCase();
      const filtered = workspaces.filter(
        (ws) =>
          ws.branchName.toLowerCase().includes(query) ||
          ws.workspacePath.toLowerCase().includes(query)
      );
      return filtered.map((ws) => ({
        name: `${ws.branchName} ${chalk.dim(`(${ws.repos.length} repos)`)}`,
        value: ws.workspacePath,
      }));
    },
  });

  return selected;
}
