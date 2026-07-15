// Types matched with src/types.ts

export interface StorageAdapterMeta {
  name: string;
  displayName: string;
  description: string;
  configFields?: any[];
}

export interface NexusFlowConfig {
  version: string;
  devDir: string;
  workspacesDir: string;
  defaultAssistant: string | null;
  defaultEditor?: string | null;
  scanDepth: number;
  storageProvider?: string;
  adapterConfig?: Record<string, Record<string, any>>;
  localLlm?: {
    enabled: boolean;
    provider: 'ollama' | 'openai-compatible';
    endpoint: string;
    model: string;
    apiKey?: string;
  };
}

export interface DetectedAI {
  name: string;
  displayName: string;
  detected: boolean;
  command?: string;
}

export interface DetectedEditor {
  name: string;
  command: string;
  detected: boolean;
}

export interface RepoInfo {
  name: string;
  path: string;
  defaultBranch: string;
}

/** How a feature attaches to its repos (mirrors src/types.ts). */
export type WorkspaceMode = 'worktree' | 'in-place';

export interface Feature {
  id: string;
  /** Absent on manifests written before modes existed — treat as 'worktree'. */
  mode?: WorkspaceMode;
  /** Id of the project this feature was created from, if any. */
  projectId?: string;
  branchName: string;
  description: string;
  repos: string[];
  assistants: string[];
  workspacePath: string;
  createdAt: string;
}

/**
 * The directory an agent session should run in (mirrors utils/feature.ts):
 * in-place single-repo features run in the repo root, everything else in the
 * workspace dir.
 */
export function getSessionCwd(ws: Feature): string {
  if (ws.mode === 'in-place' && ws.repos.length === 1) {
    return ws.repos[0];
  }
  return ws.workspacePath;
}

/** Classified outcome of a sync/rebase attempt for a repo (mirrors src/types.ts). */
export type SyncStatus = 'up-to-date' | 'rebased' | 'conflict' | 'stash-conflict' | 'error';

/** At-a-glance status for one workspace, from GET /api/workspaces/status. */
export interface WorkspaceStatus {
  id: string;
  branchName: string;
  /** Total uncommitted files across all repo worktrees. */
  changedFiles: number;
  /** Number of repos with uncommitted changes. */
  dirtyRepos: number;
  /** Number of currently running orchestrated services. */
  runningServices: number;
  /** Worst-case sync classification across repos, or 'unknown' if never synced. */
  syncStatus: SyncStatus | 'unknown';
  /** True when any repo pulled in new commits and awaits re-validation. */
  pendingValidation: boolean;
}

export interface ServiceConfig {
  name: string;
  cwd: string;
  command: string;
  args: string[];
  port?: number;
  source: string;
}

export interface OrchestrationDetection {
  tool: string;
  configPath: string;
  startCommand: string;
  stopCommand: string;
}

export interface RunningService {
  name: string;
  pid: number;
  config: ServiceConfig;
  startedAt: string;
}

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: 'success' | 'error' | 'info' | 'warning';
}
