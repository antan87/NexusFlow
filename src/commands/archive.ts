/**
 * @module commands/archive
 * `ctxspace archive` and `ctxspace unarchive`: complete a workspace without
 * losing its record, and restore it later.
 */

import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';

import { archiveWorkspace, planArchive, unarchiveWorkspace, type ArchiveReport } from '../core/archive.js';
import { CLI_NAME } from '../core/constants.js';
import { resolveWorkspaceInteractive, resolveWorkspaceQuiet } from '../utils/resolve-workspace.js';

/** Options for {@link archiveCommand}. */
export interface ArchiveCommandOptions {
  park?: boolean;
  keepBranches?: boolean;
  deleteRemoteBranches?: boolean;
  dryRun?: boolean;
  json?: boolean;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

function repoLine(repo: ArchiveReport['repos'][number]): string {
  const label = {
    'remove-worktree': chalk.green('remove worktree'),
    'already-removed': chalk.dim('worktree removed'),
    untouched: chalk.dim('untouched'),
    blocked: chalk.red('blocked'),
  }[repo.action];
  const sha = repo.headSha ? chalk.dim(` @ ${repo.headSha.slice(0, 7)}`) : '';
  return `  ${chalk.bold(repo.name)}: ${label}${sha} — ${repo.reason}`;
}

function branchLine(plan: ArchiveReport['branches'][number]): string {
  const local = plan.result?.local ?? plan.local;
  const remote = plan.result?.remote ?? plan.remote;
  const localLabel = { delete: chalk.green('delete'), deleted: chalk.green('deleted'), keep: chalk.dim('keep'), kept: chalk.dim('kept'), absent: chalk.dim('already gone'), failed: chalk.red('failed') }[local];
  const remoteLabel = remote === 'not-requested' ? '' : `, origin: ${{ delete: 'delete', deleted: 'deleted', keep: 'keep (moved)', kept: 'kept', absent: 'not there', failed: chalk.red('failed'), 'not-checked': 'not checked' }[remote]}`;
  return `  ${chalk.bold(plan.repo)} ${plan.branch}: ${localLabel}${remoteLabel} — ${plan.reason}`;
}

/** Prints an archive plan or result for people. */
export function printArchiveReport(report: ArchiveReport): void {
  for (const repo of report.repos) console.log(repoLine(repo));
  if (report.branches.length > 0) {
    console.log(chalk.bold('\n  Branches'));
    for (const plan of report.branches) console.log(branchLine(plan));
  }
  if (report.kept.length > 0) {
    console.log(chalk.dim(`\n  Kept in ${report.workspacePath}: ${report.kept.join(', ')}`));
  }
  for (const note of report.notes) console.log(chalk.yellow(`  ⚠ ${note}`));
  for (const error of report.errors) console.log(chalk.red(`  ✖ ${error}`));
  console.log();
}

/** Prints the outcome of an archive run and sets the exit code. Returns true when archived. */
export function reportArchiveOutcome(report: ArchiveReport): boolean {
  if (report.alreadyArchived) {
    console.log(chalk.yellow(`"${report.workspaceId}" was already archived on ${report.archivedAt}.\n`));
    return false;
  }
  printArchiveReport(report);
  if (!report.ready) {
    console.log(chalk.red('✖ Archive refused; nothing was removed.'));
    for (const blocker of report.blockers) console.log(chalk.red(`  - ${blocker}`));
    console.log();
    process.exitCode = 1;
    return false;
  }
  if (report.dryRun) {
    console.log(chalk.yellow('Dry run — nothing was changed.\n'));
    return false;
  }
  if (report.errors.length > 0) {
    console.log(chalk.red(`✖ Archive stopped part-way. Re-run \`${CLI_NAME} archive ${report.workspaceId}\` to resume.\n`));
    process.exitCode = 1;
    return false;
  }
  console.log(chalk.green(`✅ Archived "${report.workspaceId}". Its record stays readable; \`${CLI_NAME} unarchive ${report.workspaceId}\` restores it.\n`));
  return true;
}

/**
 * Archives a workspace: removes its worktrees once their work is delivered,
 * keeps the record, and marks it archived.
 */
export async function archiveCommand(workspaceArg: string | undefined, options: ArchiveCommandOptions = {}): Promise<void> {
  const workspacePath = options.json
    ? await resolveWorkspaceQuiet(workspaceArg)
    : await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace to archive:');
  if (!workspacePath) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No workspace given or detected from the current directory.' }));
      process.exitCode = 1;
    }
    return;
  }

  if (options.json) {
    const report = await archiveWorkspace(workspacePath, archiveOptions(options));
    console.log(JSON.stringify(report, null, 2));
    if ((!report.ready && !report.alreadyArchived) || report.errors.length > 0) process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    reportArchiveOutcome(await planArchive(workspacePath, archiveOptions(options)));
    return;
  }

  const plan = await planArchive(workspacePath, { ...archiveOptions(options), dryRun: true });
  if (plan.alreadyArchived || !plan.ready) {
    reportArchiveOutcome(plan);
    return;
  }
  printArchiveReport(plan);
  if (!options.yes) {
    const proceed = await confirm({
      message: `Archive "${plan.workspaceId}"? Its worktrees and the branches marked delete are removed; notes, knowledge and documents are kept.`,
      default: true,
    });
    if (!proceed) {
      console.log(chalk.yellow('Cancelled.\n'));
      return;
    }
  }
  reportArchiveOutcome(await archiveWorkspace(workspacePath, { ...archiveOptions(options), dryRun: false }));
}

function archiveOptions(options: ArchiveCommandOptions) {
  return {
    park: options.park,
    dryRun: options.dryRun,
    keepBranches: options.keepBranches,
    deleteRemoteBranches: options.deleteRemoteBranches,
  };
}

/** Restores an archived workspace as active. */
export async function unarchiveCommand(workspaceArg: string | undefined, options: { json?: boolean } = {}): Promise<void> {
  const workspacePath = options.json
    ? await resolveWorkspaceQuiet(workspaceArg)
    : await resolveWorkspaceInteractive(workspaceArg, 'Select an archived workspace to restore:', { archived: 'only' });
  if (!workspacePath) {
    if (options.json) {
      console.log(JSON.stringify({ error: 'No workspace given or detected from the current directory.' }));
      process.exitCode = 1;
    }
    return;
  }
  const report = await unarchiveWorkspace(workspacePath);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!report.restored) {
    console.log(chalk.yellow(`"${report.workspaceId}" is not archived.\n`));
    return;
  }
  for (const note of report.notes) console.log(chalk.yellow(`  ⚠ ${note}`));
  console.log(chalk.green(`✅ Restored "${report.workspaceId}". Its repositories are read-only references; prepare one for editing with \`${CLI_NAME} isolate <repo>\`.\n`));
}
