/**
 * @module commands/isolate
 * `nexusflow isolate` — on-demand worktree isolation for in-place workspaces.
 */

import chalk from 'chalk';
import ora from 'ora';
import { input, select } from '@inquirer/prompts';
import * as path from 'node:path';

import { loadFeatureConfig, isolateWorkspaceRepo } from '../core/workspace.js';
import { isInPlace, isRepoIsolated } from '../utils/feature.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import { BRAND_NAME } from '../core/constants.js';

interface IsolateCommandOptions {
  branch?: string;
  base?: string;
  workspace?: string;
}

export async function isolateCommand(
  repoArg?: string,
  branchArg?: string,
  options: IsolateCommandOptions = {},
): Promise<void> {
  console.log(chalk.bold.cyan(`\n⚡ ${BRAND_NAME} — Isolate Repository\n`));

  const workspacePath = await resolveWorkspaceInteractive(
    options.workspace,
    'Select an in-place workspace to isolate a repository in:',
  );
  if (!workspacePath) return;

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    console.error(chalk.red('✖ Failed to load workspace configuration.'));
    return;
  }

  if (!isInPlace(feature)) {
    console.log(chalk.yellow(`Workspace "${feature.id}" is already in worktree mode — all repositories are already isolated.`));
    return;
  }

  // 1. Resolve repository to isolate
  let repoName = repoArg;
  if (!repoName) {
    const unisolated = feature.repos.filter((r) => !isRepoIsolated(feature, r));
    if (unisolated.length === 0) {
      console.log(chalk.green('✔ All repositories in this workspace are already isolated into dedicated worktrees.\n'));
      return;
    }

    repoName = await select({
      message: 'Select repository to isolate into a worktree:',
      choices: unisolated.map((r) => ({
        name: `${path.basename(r)} ${chalk.dim(`(${r})`)}`,
        value: path.basename(r),
      })),
    });
  }

  // 2. Resolve branch name
  let branchName = branchArg || options.branch;
  if (!branchName) {
    const defaultBranchName =
      feature.branchName && feature.branchName !== feature.id
        ? feature.branchName
        : `feat/${repoName}-${feature.id}`;
    if (!process.stdin.isTTY) {
      branchName = defaultBranchName;
    } else {
      branchName = await input({
        message: `Feature branch name for "${repoName}":`,
        default: defaultBranchName,
        validate: (v) => v.trim().length > 0 || 'Branch name cannot be empty',
      });
    }
  }

  const spinner = ora(`Isolating repository "${repoName}" into a worktree...`).start();
  try {
    const result = await isolateWorkspaceRepo(workspacePath, repoName, {
      branchName,
      baseBranch: options.base,
    });

    if (result.alreadyIsolated) {
      spinner.succeed(`Repository "${repoName}" is already isolated at ${chalk.bold(result.worktreePath)} on branch "${result.branchName}".`);
    } else {
      spinner.succeed(
        `Isolated ${chalk.bold(repoName)} into dedicated worktree at:\n  ${chalk.dim(result.worktreePath)}\n  Branch: ${chalk.green(result.branchName)} (from ${result.baseBranch})`,
      );
      console.log(chalk.green('\n✔ Context files (.code-workspace, AGENTS.md) refreshed successfully.\n'));
    }
  } catch (error) {
    spinner.fail(`Failed to isolate repository: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
