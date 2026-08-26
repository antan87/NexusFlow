import chalk from 'chalk';

import { getWorkspaceProgress } from '../core/progress.js';
import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';

function yesNo(value: boolean | undefined): string {
  if (value === undefined) return '—';
  return value ? 'yes' : 'no';
}

export async function progressCommand(workspaceArg?: string, options: { json?: boolean } = {}): Promise<void> {
  const workspacePath = await resolveWorkspaceInteractive(workspaceArg, 'Select a workspace:');
  if (!workspacePath) return;
  const report = await getWorkspaceProgress(workspacePath);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(chalk.bold.cyan('\n📈 NexusFlow — Live Implementation Progress\n'));
  console.log('Repo\tBranch\tExpected\tAligned\tClean\tPushed\tPR');
  for (const repo of report.repos) {
    console.log([
      repo.name,
      repo.branch ?? '—',
      repo.expectedBranch,
      yesNo(repo.onExpectedBranch && repo.branchExists),
      yesNo(repo.clean),
      yesNo(repo.pushed),
      repo.pullRequest?.state ?? '—',
    ].join('\t'));
  }
  console.log();
}
