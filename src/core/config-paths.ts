import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND_NAME } from './constants.js';

/**
 * Checks the two folders a first run asks for. The schema only proves a path
 * is absolute; this proves it is usable, so setup can explain a bad path
 * before saving instead of failing later when a workspace is created.
 */
export type FolderStatus = 'ok' | 'missing' | 'not-directory' | 'not-readable' | 'not-writable' | 'invalid';

export interface FolderCheck {
  /** Absolute, `~`-expanded path that would be saved. */
  path: string;
  status: FolderStatus;
  message: string;
  /** A missing folder whose nearest existing parent is writable. */
  canCreate?: boolean;
  /** Git repositories found in the code folder (code folder only). */
  repoCount?: number;
}

export interface ConfigPathsReport {
  ok: boolean;
  devDir?: FolderCheck;
  workspacesDir?: FolderCheck;
}

export function expandHome(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') return os.homedir();
  if (/^~[\\/]/.test(trimmed)) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

async function nearestExistingAncestor(target: string): Promise<string | null> {
  let current = path.dirname(target);
  for (;;) {
    try {
      if ((await fs.stat(current)).isDirectory()) return current;
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function isWritable(directory: string) {
  try {
    await fs.access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function checkFolder(input: string, needWrite: boolean): Promise<FolderCheck> {
  const expanded = expandHome(input);
  if (!expanded) return { path: '', status: 'invalid', message: 'Enter a folder path.' };
  if (!path.isAbsolute(expanded)) {
    return { path: expanded, status: 'invalid', message: `Use a full path, for example ${path.join(os.homedir(), 'dev')}.` };
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) {
    return { path: resolved, status: 'invalid', message: 'Choose a folder, not the root of a drive.' };
  }
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      const parent = code === 'ENOENT' ? await nearestExistingAncestor(resolved) : null;
      const canCreate = Boolean(parent && await isWritable(parent));
      return { path: resolved, status: 'missing', message: "This folder doesn't exist.", canCreate };
    }
    return { path: resolved, status: 'not-readable', message: `${BRAND_NAME} can't open this folder. Check its permissions.` };
  }
  if (!stat.isDirectory()) return { path: resolved, status: 'not-directory', message: 'This is a file, not a folder.' };
  try {
    await fs.access(resolved, constants.R_OK | constants.X_OK);
  } catch {
    return { path: resolved, status: 'not-readable', message: `${BRAND_NAME} can't open this folder. Check its permissions.` };
  }
  if (needWrite && !await isWritable(resolved)) {
    return { path: resolved, status: 'not-writable', message: `${BRAND_NAME} can't create workspaces here. Choose a folder you can write to.` };
  }
  return { path: resolved, status: 'ok', message: '' };
}

function samePath(a: string, b: string) {
  return process.platform === 'win32' || process.platform === 'darwin' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function checkConfigPaths(
  input: { devDir?: string; workspacesDir?: string },
  options: { countRepos?: (devDir: string) => Promise<number> } = {},
): Promise<ConfigPathsReport> {
  const report: ConfigPathsReport = { ok: true };
  if (input.devDir !== undefined) {
    report.devDir = await checkFolder(input.devDir, false);
    if (report.devDir.status === 'ok' && options.countRepos) {
      try {
        report.devDir.repoCount = await options.countRepos(report.devDir.path);
      } catch {
        // Counting is informational; an unreadable subfolder must not block setup.
      }
    }
  }
  if (input.workspacesDir !== undefined) {
    report.workspacesDir = await checkFolder(input.workspacesDir, true);
    if (report.devDir?.path && report.workspacesDir.path && samePath(report.devDir.path, report.workspacesDir.path)) {
      report.workspacesDir = {
        ...report.workspacesDir,
        status: 'invalid',
        message: 'Use a separate folder so generated workspaces stay apart from your repositories.',
        canCreate: undefined,
      };
    }
  }
  report.ok = [report.devDir, report.workspacesDir].every((check) => !check || check.status === 'ok');
  return report;
}
