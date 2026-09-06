// Types matched with src/types.ts

export interface StorageAdapterMeta {
  name: string;
  displayName: string;
  description: string;
  configFields?: any[];
}

export interface ContextSpaceConfig {
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

export type NexusFlowConfig = ContextSpaceConfig;
export type AppConfig = ContextSpaceConfig;

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
  | 'powershell'
  | 'cmd'
  | 'terminal'
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

export type AIAssistant = 'claude' | 'antigravity' | 'codex' | 'copilot' | 'cursor';

/** Metadata about a local AI session (mirrors src/types.ts). */
export interface AISession {
  id: string;
  assistant: AIAssistant;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspacePath: string;
  desktopHandoff?: {
    targetId: 'codex-desktop' | 'claude-desktop';
    method: 'direct' | 'guided';
  };
}

/** A single chat message in a session transcript (mirrors src/types.ts ChatMessage). */
export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
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
  /** AI assistants that have active/recorded sessions in this workspace. */
  activeAssistants?: AIAssistant[];
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

// ─── Workrooms ────────────────────────────────────────────────────────────

export type WorkroomRole = 'host' | 'publisher' | 'member';
export type WorkroomDocumentName = 'plan' | 'decisions' | 'handoff';

export interface WorkroomParticipant {
  id: string;
  displayName: string;
  role: WorkroomRole;
  joinedAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface WorkroomDocument {
  name: WorkroomDocumentName;
  revision: number;
  content: string;
  updatedAt: string;
  updatedBy: string;
  history: Array<{ revision: number; content: string; updatedAt: string; updatedBy: string }>;
}

export interface WorkroomResourceManifest {
  schemaVersion: 1;
  kind: 'skill' | 'agent' | 'workflow';
  id: string;
  version: string;
  digest: string;
  ownerMemberId: string;
  maintainerMemberIds: string[];
  createdAt: string;
  dependencies: Array<{ kind: 'skill' | 'agent' | 'workflow'; id: string; version: string; digest: string }>;
  compatibility?: {
    platforms?: Array<'win32' | 'linux' | 'darwin'>;
    nexusflow?: string;
  };
  quarantinedAt?: string;
}

export interface WorkflowStepProgress {
  stepId: string;
  status: 'pending' | 'in_progress' | 'completion_proposed' | 'completed' | 'skipped';
  revision: number;
  evidence?: string;
  proposedBy?: string;
  updatedBy: string;
  updatedAt: string;
}

export interface WorkroomSnapshot {
  schemaVersion: 1;
  roomId: string;
  name: string;
  address: string;
  port: number;
  certificateFingerprint: string;
  revision: number;
  createdAt: string;
  bundle: {
    schemaVersion: 1;
    project: { id: string; name: string };
    feature: { id: string; goal: string; description: string };
    repos: Array<{
      id: string;
      name: string;
      remoteUrl: string;
      defaultBranch: string;
      handoff?: { branch: string; commit: string; ahead: number; behind: number; dirty: boolean; publishedAt: string; publishedBy: string };
    }>;
    pinnedResources: WorkroomResourceManifest[];
    createdAt: string;
  };
  documents: Record<WorkroomDocumentName, WorkroomDocument>;
  participants: WorkroomParticipant[];
  pendingJoins: Array<{ id: string; displayName: string; requestedAt: string }>;
  resources: WorkroomResourceManifest[];
  workflowProgress?: {
    workflow: { kind: 'workflow'; id: string; version: string; digest: string };
    package: {
      schemaVersion: 1;
      id: string;
      version: string;
      name: string;
      description: string;
      markdown: string;
      steps: Array<{ id: string; title: string; requiresEvidence: boolean }>;
      dependencies: Array<{ kind: 'skill' | 'agent' | 'workflow'; id: string; version: string; digest: string }>;
    };
    revision: number;
    steps: WorkflowStepProgress[];
  };
  activity: Array<{ sequence: number; type: string; actorId: string; createdAt: string; summary: string }>;
}

export type WorkroomStatus =
  | { mode: 'idle' }
  | { mode: 'locked'; roomType: 'host' | 'guest' }
  | { mode: 'host'; roomId: string; name: string; url: string; localWorkspaceId: string; certificateFingerprint: string; snapshot: WorkroomSnapshot }
  | { mode: 'guest'; roomId: string; name?: string; url: string; status: 'pending' | 'accepted' | 'rejected'; connection?: 'connected' | 'disconnected' | 'revoked'; memberId?: string; localWorkspaceId?: string; snapshot?: WorkroomSnapshot };

export interface WorkspaceStreamMessage {
  id?: string;
  timestamp?: string;
  harness?: string;
  author?: string;
  message?: string;
  content?: string;
  stepId?: string;
  evidence?: string;
  type?: string;
  artifacts?: Array<{ title: string; path: string; summary?: string }>;
  targetHarness?: string;
  [key: string]: any;
}

export interface WorkspaceStreamResponse {
  workspaceId: string;
  messages: WorkspaceStreamMessage[];
  workflowProgress?: {
    workflowId?: string;
    version?: string;
    revision?: number;
    steps: Array<{
      stepId: string;
      status: string;
      evidence?: string;
      revision: number;
      updatedAt?: string;
    }>;
  } | null;
  isRemoteActive: boolean;
  remoteStatus: {
    roomId: string;
    url?: string;
    name?: string;
  } | null;
}

