import { execa } from 'execa';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import type { WorkspaceContext } from '../types.js';
import { getActiveStorageProvider } from '../core/adapters/registry.js';

/**
 * Generates an incremental task context file listing only changed files on the branch.
 *
 * @returns Whether any repo had changes. The caller uses this to decide whether
 *          the generated context should point at the file at all: on a fresh
 *          branch it says only "no changed files detected", so a pointer buys the
 *          assistant a read that teaches it nothing.
 */
export async function generateDiffContext(
  ctx: WorkspaceContext,
  workspacePath: string
): Promise<boolean> {
  let content = `# Incremental Task Context (Git Diff)\n\n`;
  content += `This file lists the files modified or added on this feature branch compared to the base branch. Use this to focus the AI's attention.\n\n`;

  let hasDiff = false;

  for (const repo of ctx.repos) {
    // RepoInfo.path is already mode-correct: the worktree inside the
    // workspace, or the source repository for in-place features.
    const repoPath = repo.path;
    try {
      await fs.access(repoPath);
    } catch {
      continue;
    }

    const defaultBranch = repo.defaultBranch || 'main';

    let diffFiles: string[] = [];
    try {
      const { stdout } = await execa('git', ['diff', `origin/${defaultBranch}...HEAD`, '--name-only'], {
        cwd: repoPath,
        shell: process.platform === 'win32',
      });
      diffFiles = stdout.split('\n').map(f => f.trim()).filter(Boolean);
    } catch {
      try {
        const { stdout } = await execa('git', ['diff', `${defaultBranch}...HEAD`, '--name-only'], {
          cwd: repoPath,
          shell: process.platform === 'win32',
        });
        diffFiles = stdout.split('\n').map(f => f.trim()).filter(Boolean);
      } catch {
        try {
          const { stdout } = await execa('git', ['status', '--porcelain'], {
            cwd: repoPath,
            shell: process.platform === 'win32',
          });
          diffFiles = stdout.split('\n')
            .map(line => line.slice(3).trim())
            .filter(Boolean);
        } catch {
          // git command failed or not a repo
        }
      }
    }

    if (diffFiles.length > 0) {
      hasDiff = true;
      content += `## Repository: ${repo.name}\n\n`;
      for (const file of diffFiles) {
        const absoluteFilePath = path.join(repoPath, file).replace(/\\/g, '/');
        content += `*   [${file}](file:///${absoluteFilePath})\n`;
      }
      content += `\n`;
    }
  }

  if (!hasDiff) {
    content += `*No changed files detected on this branch yet.*\n`;
  }

  const storage = getActiveStorageProvider();
  await storage.writeWorkspaceFile(workspacePath, ctx.feature.id, 'nexusflow-diff-context.md', content);

  return hasDiff;
}
