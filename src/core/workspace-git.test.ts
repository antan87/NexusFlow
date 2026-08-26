import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import fse from 'fs-extra';
import { execa } from 'execa';

import {
  addWorkspaceRemote,
  commitWorkspaceArtifacts,
  commitExactWorkspaceArtifacts,
  ensureWorkspaceGitRepository,
  pullWorkspaceArtifacts,
  pushWorkspaceArtifacts,
} from './workspace-git.js';

describe('workspace artifact git', () => {
  let workspacePath: string;
  let remotePath: string;

  beforeEach(async () => {
    workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-artifacts-'));
    remotePath = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusflow-artifacts-remote-'));
    await execa('git', ['init', '--bare'], { cwd: remotePath });
    await ensureWorkspaceGitRepository(workspacePath);
  });

  afterEach(async () => {
    await fse.remove(workspacePath);
    await fse.remove(remotePath);
  });

  it('commits only the explicitly owned path', async () => {
    await fs.writeFile(path.join(workspacePath, 'nexusflow-knowledge.md'), '# Knowledge\n');
    await fs.writeFile(path.join(workspacePath, 'unrelated.txt'), 'mine\n');
    const result = await commitExactWorkspaceArtifacts(workspacePath, 'remember', ['nexusflow-knowledge.md']);
    expect(result.committed).toBe(true);
    const tracked = await execa('git', ['ls-files'], { cwd: workspacePath });
    expect(tracked.stdout).toContain('nexusflow-knowledge.md');
    expect(tracked.stdout).not.toContain('unrelated.txt');
  });

  it('leaves unrelated pre-staged files out of automatic refresh commits', async () => {
    await fs.writeFile(path.join(workspacePath, 'AGENTS.md'), '# Context\n');
    await fs.writeFile(path.join(workspacePath, 'unrelated.txt'), 'mine\n');
    await execa('git', ['add', 'unrelated.txt'], { cwd: workspacePath });

    await commitWorkspaceArtifacts(workspacePath, 'refresh');

    const committed = await execa('git', ['show', '--name-only', '--format='], { cwd: workspacePath });
    expect(committed.stdout).toContain('AGENTS.md');
    expect(committed.stdout).not.toContain('unrelated.txt');
    const staged = await execa('git', ['diff', '--cached', '--name-only'], { cwd: workspacePath });
    expect(staged.stdout).toContain('unrelated.txt');
  });

  it('pushes history and refuses to pull over dirty workspace artifacts', async () => {
    await fs.writeFile(path.join(workspacePath, 'nexusflow-knowledge.md'), '# Knowledge\n');
    await commitExactWorkspaceArtifacts(workspacePath, 'remember', ['nexusflow-knowledge.md']);
    await addWorkspaceRemote(workspacePath, remotePath);
    await pushWorkspaceArtifacts(workspacePath);
    const refs = await execa('git', ['show-ref'], { cwd: remotePath });
    expect(refs.stdout).toContain('refs/heads/');

    await fs.appendFile(path.join(workspacePath, 'nexusflow-knowledge.md'), 'dirty\n');
    await expect(pullWorkspaceArtifacts(workspacePath)).rejects.toThrow(/uncommitted changes/);
  });
});
