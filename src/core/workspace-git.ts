/** Git history and optional remote synchronization for the workspace artifact repo. */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

import { readGenerationLock } from './generation-lock.js';
import { acquireLock } from './locks.js';

const CORE_ARTIFACTS = [
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
  'WORKSPACE.md',
  'nexusflow.json',
  'nexusflow.lock',
  'nexusflow-knowledge.md',
  'nexusflow-plan.md',
  '.nexusflow/resources.json',
  '.nexusflow/resources.lock.json',
  '.vscode/settings.json',
  '.cursor/mcp.json',
];

async function exists(workspacePath: string, relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(workspacePath, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function ensureWorkspaceGitRepository(workspacePath: string): Promise<void> {
  const probe = await execa('git', ['rev-parse', '--show-toplevel'], { cwd: workspacePath, reject: false });
  if (probe.exitCode !== 0 || path.resolve(probe.stdout.trim()) !== path.resolve(workspacePath)) {
    await execa('git', ['init'], { cwd: workspacePath });
  }
  const name = await execa('git', ['config', '--local', 'user.name'], { cwd: workspacePath, reject: false });
  if (name.exitCode !== 0 || !name.stdout.trim()) {
    await execa('git', ['config', '--local', 'user.name', 'NexusFlow'], { cwd: workspacePath });
  }
  const email = await execa('git', ['config', '--local', 'user.email'], { cwd: workspacePath, reject: false });
  if (email.exitCode !== 0 || !email.stdout.trim()) {
    await execa('git', ['config', '--local', 'user.email', 'nexusflow@local'], { cwd: workspacePath });
  }
}

export async function managedWorkspaceArtifacts(workspacePath: string, extra: string[] = []): Promise<string[]> {
  const lock = await readGenerationLock(workspacePath);
  const workspaceFile = `${path.basename(workspacePath)}.code-workspace`;
  const candidates = new Set([...CORE_ARTIFACTS, workspaceFile, ...Object.keys(lock?.outputs ?? {}), ...extra]);
  const safe = [...candidates].filter((item) =>
    item && !path.isAbsolute(item) && !item.replace(/\\/g, '/').split('/').includes('..'),
  );
  const present: string[] = [];
  for (const item of safe) if (await exists(workspacePath, item)) present.push(item.replace(/\\/g, '/'));
  return present.sort();
}

export async function commitWorkspaceArtifacts(
  workspacePath: string,
  message: string,
  extra: string[] = [],
): Promise<{ committed: boolean; sha?: string }> {
  const release = await acquireLock(path.join(workspacePath, '.nexusflow', 'workspace-git.lock'), {
    staleMs: 60_000, timeoutMs: 30_000,
    timeoutMessage: 'Another NexusFlow operation is updating the workspace artifact repository.',
  });
  try {
    await ensureWorkspaceGitRepository(workspacePath);
    const artifacts = await managedWorkspaceArtifacts(workspacePath, extra);
    if (!artifacts.length) return { committed: false };
    await execa('git', ['add', '--', ...artifacts], { cwd: workspacePath });
    const diff = await execa('git', ['diff', '--cached', '--quiet', '--', ...artifacts], { cwd: workspacePath, reject: false });
    if (diff.exitCode === 0) return { committed: false };
    if (diff.exitCode !== 1) throw new Error('Could not inspect staged workspace artifacts.');
    await execa('git', ['commit', '-m', message, '--', ...artifacts], { cwd: workspacePath });
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: workspacePath });
    return { committed: true, sha: stdout.trim() };
  } finally {
    await release();
  }
}

export async function commitExactWorkspaceArtifacts(
  workspacePath: string,
  message: string,
  relativePaths: string[],
): Promise<{ committed: boolean; sha?: string }> {
  const release = await acquireLock(path.join(workspacePath, '.nexusflow', 'workspace-git.lock'), {
    staleMs: 60_000, timeoutMs: 30_000,
    timeoutMessage: 'Another NexusFlow operation is updating the workspace artifact repository.',
  });
  try {
    await ensureWorkspaceGitRepository(workspacePath);
    const artifacts = (await managedWorkspaceArtifacts(workspacePath, relativePaths))
      .filter((item) => relativePaths.map((candidate) => candidate.replace(/\\/g, '/')).includes(item));
    if (!artifacts.length) return { committed: false };
    await execa('git', ['add', '--', ...artifacts], { cwd: workspacePath });
    const diff = await execa('git', ['diff', '--cached', '--quiet', '--', ...artifacts], { cwd: workspacePath, reject: false });
    if (diff.exitCode === 0) return { committed: false };
    if (diff.exitCode !== 1) throw new Error('Could not inspect staged workspace artifacts.');
    await execa('git', ['commit', '-m', message, '--', ...artifacts], { cwd: workspacePath });
    const { stdout } = await execa('git', ['rev-parse', 'HEAD'], { cwd: workspacePath });
    return { committed: true, sha: stdout.trim() };
  } finally {
    await release();
  }
}

export async function addWorkspaceRemote(workspacePath: string, url: string): Promise<void> {
  await ensureWorkspaceGitRepository(workspacePath);
  const existing = await execa('git', ['remote', 'get-url', 'origin'], { cwd: workspacePath, reject: false });
  if (existing.exitCode === 0) throw new Error(`Workspace remote "origin" already exists (${existing.stdout.trim()}).`);
  await execa('git', ['remote', 'add', 'origin', url], { cwd: workspacePath });
}

async function currentBranch(workspacePath: string): Promise<string> {
  const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: workspacePath });
  const branch = stdout.trim();
  if (!branch) throw new Error('Workspace artifact repository is in detached HEAD state.');
  return branch;
}

export async function pushWorkspaceArtifacts(workspacePath: string): Promise<void> {
  await ensureWorkspaceGitRepository(workspacePath);
  const branch = await currentBranch(workspacePath);
  await execa('git', ['push', '-u', 'origin', branch], { cwd: workspacePath });
}

export async function pullWorkspaceArtifacts(workspacePath: string): Promise<void> {
  await ensureWorkspaceGitRepository(workspacePath);
  const dirty = await execa('git', ['status', '--porcelain'], { cwd: workspacePath });
  if (dirty.stdout.trim()) throw new Error('Workspace artifact repository has uncommitted changes; commit them before pulling.');
  const branch = await currentBranch(workspacePath);
  await execa('git', ['pull', '--rebase', 'origin', branch], { cwd: workspacePath });
}
