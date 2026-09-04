/**
 * @module commands/migrate
 * CLI command for migrating legacy NexusFlow workspaces and global config to ContextSpace.
 */

import chalk from 'chalk';
import path from 'node:path';
import { BRAND_NAME } from '../core/constants.js';
import { loadConfig } from '../core/config.js';
import { listWorkspaces, findWorkspaceRoot } from '../core/workspace.js';
import { migrateWorkspace, migrateGlobalConfig, isLegacyWorkspace } from '../core/migrate.js';

export interface MigrateCommandOptions {
  all?: boolean;
  dryRun?: boolean;
  refresh?: boolean;
  global?: boolean;
}

export async function migrateCommand(
  target?: string,
  options: MigrateCommandOptions = {},
): Promise<void> {
  const dryRun = options.dryRun ?? false;
  const doRefresh = options.refresh ?? true;

  console.log(chalk.bold.cyan(`\n📦 ${BRAND_NAME} Migration Engine\n`));

  if (dryRun) {
    console.log(chalk.yellow('  [DRY RUN] No files will be modified on disk.\n'));
  }

  // 1. Check/Migrate global config if requested or running with --all
  if (options.global || options.all) {
    console.log(chalk.bold('  Global Configuration Migration:'));
    const globalReport = await migrateGlobalConfig({ dryRun });
    if (globalReport.migratedConfig) {
      console.log(`    ${chalk.green('✔')} Migrated ~/.nexusflow/config.json -> ~/.contextspace/config.json`);
    }
    if (globalReport.migratedProjects) {
      console.log(`    ${chalk.green('✔')} Migrated ~/.nexusflow/projects.json -> ~/.contextspace/projects.json`);
    }
    if (globalReport.migratedWorkflows > 0) {
      console.log(`    ${chalk.green('✔')} Migrated ${globalReport.migratedWorkflows} workflow template(s)`);
    }
    if (!globalReport.migratedConfig && !globalReport.migratedProjects && globalReport.migratedWorkflows === 0) {
      console.log(chalk.dim('    Global configuration is already up to date.'));
    }
    console.log();
  }

  // 2. Migrate All Workspaces
  if (options.all) {
    const config = await loadConfig();
    const workspaces = await listWorkspaces(config.workspacesDir);

    if (workspaces.length === 0) {
      console.log(chalk.dim('  No workspaces found in ' + config.workspacesDir + '\n'));
      return;
    }

    console.log(chalk.bold(`  Scanning ${workspaces.length} workspace(s) for legacy artifacts:\n`));

    let migratedCount = 0;
    for (const ws of workspaces) {
      const isLegacy = await isLegacyWorkspace(ws.workspacePath);
      if (isLegacy) {
        console.log(`  Upgrading: ${chalk.bold(ws.branchName || path.basename(ws.workspacePath))}`);
        const rep = await migrateWorkspace(ws.workspacePath, { dryRun, refresh: doRefresh });
        for (const f of rep.renamedFiles) {
          if (f.status === 'renamed') {
            console.log(`    ${chalk.green('✔')} Renamed: ${f.from} -> ${f.to}`);
          } else if (f.status === 'skipped') {
            console.log(`    ${chalk.dim('ℹ')} Skipped: ${f.from} (${f.error || 'already exists'})`);
          } else {
            console.log(`    ${chalk.red('✖')} Failed: ${f.from} (${f.error})`);
          }
        }
        migratedCount++;
      }
    }

    if (migratedCount === 0) {
      console.log(chalk.green('  ✔ All workspaces are already on ContextSpace standards.\n'));
    } else {
      console.log(chalk.bold.green(`\n  ✔ Successfully processed ${migratedCount} workspace(s).\n`));
    }
    return;
  }

  // 3. Migrate Single Target Workspace (or Current Directory)
  let workspaceDir = target ? path.resolve(target) : process.cwd();
  const detectedRoot = await findWorkspaceRoot(workspaceDir);
  if (detectedRoot) {
    workspaceDir = detectedRoot;
  }

  const isLegacy = await isLegacyWorkspace(workspaceDir);
  console.log(`  Inspecting workspace at: ${chalk.dim(workspaceDir)}`);

  if (!isLegacy) {
    console.log(chalk.green('\n  ✔ Workspace is already on ContextSpace standards (no legacy artifacts detected).\n'));
    return;
  }

  console.log(chalk.bold('\n  Upgrading legacy NexusFlow artifacts to ContextSpace...\n'));
  const rep = await migrateWorkspace(workspaceDir, { dryRun, refresh: doRefresh });

  for (const f of rep.renamedFiles) {
    if (f.status === 'renamed') {
      console.log(`    ${chalk.green('✔')} Renamed: ${f.from} -> ${f.to}`);
    } else if (f.status === 'skipped') {
      console.log(`    ${chalk.dim('ℹ')} Skipped: ${f.from} (${f.error || 'already exists'})`);
    } else {
      console.log(`    ${chalk.red('✖')} Failed: ${f.from} (${f.error})`);
    }
  }

  if (rep.updatedSentinels.length > 0) {
    console.log(`    ${chalk.green('✔')} Updated sentinels in: ${rep.updatedSentinels.join(', ')}`);
  }

  if (rep.refreshedContext) {
    console.log(`    ${chalk.green('✔')} Refreshed context manifests & AI instructions`);
  }

  for (const warn of rep.warnings) {
    console.log(`    ${chalk.yellow('⚠')} ${warn}`);
  }

  console.log(chalk.bold.green(`\n  ✔ Migration complete! Workspace is now fully native ContextSpace.\n`));
}
