import { apiFetch, ApiError } from '../../lib/api/client.js';
import type { ContextSpaceConfig } from '../../types.js';

/** Mirrors src/core/config-paths.ts. */
export type FolderStatus = 'ok' | 'missing' | 'not-directory' | 'not-readable' | 'not-writable' | 'invalid';

export interface FolderCheck {
  path: string;
  status: FolderStatus;
  message: string;
  canCreate?: boolean;
  repoCount?: number;
}

export interface ConfigPathsReport {
  ok: boolean;
  devDir?: FolderCheck;
  workspacesDir?: FolderCheck;
}

export type FolderKey = 'devDir' | 'workspacesDir';

export function checkFolders(folders: Partial<Record<FolderKey, string>>, signal?: AbortSignal) {
  return apiFetch<ConfigPathsReport>('/api/config/validate', { method: 'POST', body: JSON.stringify(folders), signal });
}

export function saveConfig(config: ContextSpaceConfig, options: { createWorkspacesDir?: boolean } = {}) {
  return apiFetch<{ success: boolean; config: ContextSpaceConfig }>('/api/config', {
    method: 'POST',
    body: JSON.stringify({ ...config, ...(options.createWorkspacesDir ? { createWorkspacesDir: true } : {}) }),
  });
}

/** Field-level folder problems from a refused save (HTTP 422), if any. */
export function folderErrors(error: unknown): ConfigPathsReport | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  const fields = (error.body as { fields?: ConfigPathsReport } | null)?.fields;
  return fields && typeof fields === 'object' ? fields : null;
}

/** Example paths for the server's platform (not the browser's). */
export function folderExamples(platform: string | undefined) {
  if (platform === 'win32') return { devDir: 'C:\\Users\\you\\dev', workspacesDir: 'C:\\Users\\you\\dev\\workspaces' };
  if (platform === 'darwin') return { devDir: '/Users/you/dev', workspacesDir: '/Users/you/dev/workspaces' };
  return { devDir: '/home/you/dev', workspacesDir: '/home/you/dev/workspaces' };
}

export function repoSummary(count: number | undefined) {
  if (count === undefined) return 'Folder found.';
  if (count === 0) return 'Folder found, but it has no Git repositories yet.';
  return `${count} Git ${count === 1 ? 'repository' : 'repositories'} found.`;
}

export function desktopFolderPicker() {
  const bridge = typeof window !== 'undefined' ? (window.contextspaceBridge ?? window.nexusBridge) : undefined;
  return bridge?.pickDirectory;
}
