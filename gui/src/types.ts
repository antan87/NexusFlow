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
  plugins?: string[];
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

export type WorkspaceLaunchTargetKind = 'ai-app' | 'editor';

export type WorkspaceLaunchIcon =
  | 'codex'
  | 'claude'
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'antigravity'
  | 'intellij'
  | 'webstorm'
  | 'pycharm'
  | 'sublime'
  | 'zed'
  | 'windsurf';

export interface WorkspaceLaunchTarget {
  id: string;
  name: string;
  description: string;
  kind: WorkspaceLaunchTargetKind;
  icon: WorkspaceLaunchIcon;
  available: boolean;
  unavailableReason?: string;
}

export interface RepoInfo {
  name: string;
  path: string;
  defaultBranch: string;
}

/** A repository belonging to a {@link Project} (mirrors src/types.ts). */
export interface ProjectRepo {
  path: string;
  defaultBranch: string;
}

/** A named, persistent group of source repositories (mirrors src/types.ts). */
export interface Project {
  id: string;
  name: string;
  description?: string;
  repos: ProjectRepo[];
  createdAt: string;
  updatedAt: string;
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
  /** Stable id: `${tool}:${relative config path}`. */
  id: string;
  tool: string;
  configPath: string;
  startCommand: string;
  stopCommand: string;
  mode: 'oneshot' | 'pm2';
}

export interface RunningService {
  name: string;
  pid: number;
  config: ServiceConfig;
  startedAt: string;
}

export interface RunningOrchestrator {
  id: string;
  tool: string;
  configPath: string;
  mode: 'oneshot' | 'pm2';
  pm2Name?: string;
  /** Tailable log source name (e.g. `orch-<slug>`) — set only for mode 'pm2'. */
  logName?: string;
  startedAt: string;
}

// ─── Skills & Categories Types ─────────────────────────────────────────────

export interface SkillCategory {
  id: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  custom?: boolean;
  isTemplate?: boolean;
  skills?: string[];
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description?: string;
  required?: boolean;
  default?: any;
}

export interface SkillSupportingFile {
  name: string;
  relativePath: string;
  content?: string;
}

export interface SkillItem {
  id: string;
  name: string;
  title?: string;
  category: string;
  description: string;
  tags?: string[];
  allowedTools?: string[];
  parameters?: SkillParameter[];
  content: string;
  custom: boolean;
  sourcePath?: string;
  references?: SkillSupportingFile[];
  scripts?: SkillSupportingFile[];
}

export interface CodexAgentItem {
  id: string;
  name: string;
  category: string;
  description: string;
  model?: string;
  modelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  sandboxMode?: 'read-only' | 'workspace-write';
  developerInstructions: string;
  custom: boolean;
  sourcePath?: string;
}

export interface WorkspaceSkillsConfig {
  schemaVersion?: 1;
  revision?: number;
  enabledSkills: string[];
  enabledAgents?: string[];
  enabledCategories?: string[];
}

