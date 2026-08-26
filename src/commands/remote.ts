import chalk from 'chalk';

import { resolveWorkspaceInteractive } from '../utils/resolve-workspace.js';
import {
  addWorkspaceRemote,
  pullWorkspaceArtifacts,
  pushWorkspaceArtifacts,
} from '../core/workspace-git.js';

async function workspace(workspaceArg: string | undefined): Promise<string | null> {
  return resolveWorkspaceInteractive(workspaceArg, 'Select a workspace artifact repository:');
}

export async function remoteAddCommand(url: string, workspaceArg?: string): Promise<void> {
  const workspacePath = await workspace(workspaceArg);
  if (!workspacePath) return;
  await addWorkspaceRemote(workspacePath, url);
  console.log(chalk.green('✔ Added workspace artifact remote origin.'));
}

export async function remotePushCommand(workspaceArg?: string): Promise<void> {
  const workspacePath = await workspace(workspaceArg);
  if (!workspacePath) return;
  await pushWorkspaceArtifacts(workspacePath);
  console.log(chalk.green('✔ Pushed workspace artifact history.'));
}

export async function remotePullCommand(workspaceArg?: string): Promise<void> {
  const workspacePath = await workspace(workspaceArg);
  if (!workspacePath) return;
  await pullWorkspaceArtifacts(workspacePath);
  console.log(chalk.green('✔ Pulled workspace artifact history with rebase.'));
}
