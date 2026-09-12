/**
 * @module commands/verify
 * CLI command `ctxspace verify` — executes mechanical verification gates
 * across repositories in a workspace and records cryptographic/SHA-anchored proof.
 */

import chalk from 'chalk';

import { verifyWorkspace, type VerifyWorkspaceOptions } from '../core/verify.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import { BRAND_NAME } from '../core/constants.js';

export interface VerifyCommandOptions {
  repo?: string;
  tag?: string;
  filter?: string;
  command?: string;
  timeout?: string;
  allowDirty?: boolean;
  json?: boolean;
}

export async function verifyCommand(
  workspaceArg: string | undefined,
  options: VerifyCommandOptions = {},
): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace to verify:');
  if (!workspacePath) return;

  const verifyOpts: VerifyWorkspaceOptions = {
    repoName: options.repo,
    tag: options.tag,
    filter: options.filter,
    command: options.command,
    allowDirty: options.allowDirty,
    timeoutMs: options.timeout ? parseInt(options.timeout, 10) * 1000 : undefined,
  };

  if (!options.json) {
    console.log(chalk.bold.cyan(`\n🧪 ${BRAND_NAME} — Mechanical Verification Gate\n`));
    console.log(chalk.dim('Executing test gates and recording verification proof in workspace state...'));
  }

  const report = await verifyWorkspace(workspacePath, verifyOpts);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.overallStatus === 'fail' || report.overallStatus === 'timeout') {
      process.exitCode = 1;
    }
    return;
  }

  console.log();
  for (const repo of report.repos) {
    const timeStr = `${(repo.durationMs / 1000).toFixed(1)}s`;
    const shaStr = repo.headSha && repo.headSha !== 'unknown' ? `@ ${repo.headSha.slice(0, 7)}` : '';

    switch (repo.status) {
      case 'pass':
        console.log(chalk.green(`  ✔ ${chalk.bold(repo.repoName)}: \`${repo.command}\` passed in ${timeStr} ${chalk.dim(shaStr)}`));
        break;

      case 'pass_dirty':
        console.log(chalk.yellow(`  ⚠ ${chalk.bold(repo.repoName)}: \`${repo.command}\` passed in ${timeStr}, but working tree is ${chalk.bold('DIRTY')} (${repo.dirtyFiles?.length ?? 0} uncommitted files)`));
        console.log(chalk.dim(`    Commit these changes before 'ctxspace finish' to anchor proof to HEAD commit.`));
        break;

      case 'fail':
        console.log(chalk.red(`  ✖ ${chalk.bold(repo.repoName)}: \`${repo.command}\` failed (exit code ${repo.exitCode ?? 1}) in ${timeStr}`));
        if (repo.stderr || repo.stdout) {
          const outputSnippet = (repo.stderr || repo.stdout || '')
            .split('\n')
            .filter(Boolean)
            .slice(-10)
            .join('\n    ');
          if (outputSnippet) {
            console.log(chalk.dim(`    Output:\n    ${outputSnippet}`));
          }
        }
        break;

      case 'timeout':
        console.log(chalk.red(`  ✖ ${chalk.bold(repo.repoName)}: \`${repo.command}\` TIMED OUT after ${timeStr}`));
        break;

      case 'no-tests':
        console.log(chalk.dim(`  ○ ${chalk.bold(repo.repoName)}: no test runner detected (skipped)`));
        break;

      case 'skipped':
        console.log(chalk.dim(`  ○ ${chalk.bold(repo.repoName)}: skipped`));
        break;
    }
  }

  console.log();
  switch (report.overallStatus) {
    case 'pass':
      console.log(chalk.bold.green(`✅ Verification Gate PASSED. All suites succeeded on clean commits.\n`));
      break;
    case 'pass_dirty':
      console.log(chalk.bold.yellow(`⚠️ Verification Gate PASSED with uncommitted changes.\n`));
      break;
    case 'fail':
      console.log(chalk.bold.red(`❌ Verification Gate FAILED. Fix failing tests before finishing.\n`));
      process.exitCode = 1;
      break;
    case 'timeout':
      console.log(chalk.bold.red(`❌ Verification Gate TIMED OUT.\n`));
      process.exitCode = 1;
      break;
    case 'no-tests':
      console.log(chalk.yellow(`ℹ No tests detected across workspace repositories.\n`));
      break;
  }
}
