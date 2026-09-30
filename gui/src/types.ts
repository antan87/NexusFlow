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

/**
 * Harness identity comes from `/api/harnesses`, not from a union copied here.
 *
 * This type used to be `'claude' | 'antigravity' | 'codex' | 'copilot' | 'cursor'`
 * with `pi` bolted on for sessions, hand-mirrored from `src/types.ts` with
 * nothing checking the two agreed. It is now the identity the server reports:
 * `string`, narrowed where it matters by the data. See `HarnessDescription`.
 */
export type AIAssistant = string;
export type SessionAssistant = string;

/** The manifest as the server reports it. Mirrors `HarnessDescription`. */
export interface HarnessDescription {
  id: string;
  label: string;
  pickerLabel: string;
  role: 'assistant' | 'session-only';
  isAssistant: boolean;
  hasHistory: boolean;
  launchCommand: string;
  probe: string;
  contextPath?: string;
  skillRoots: string[];
  mcpConfigPaths: string[];
  agentsDir?: string;
}

export interface QuotaWindow {
  unit: 'tokens' | 'requests' | 'percent';
  remaining?: number;
  limit?: number;
  used?: number;
  resetsAt?: string;
  resetInSeconds?: number;
  status?: 'ok' | 'approaching_limit' | 'exceeded';
}

export interface NormalizedRemainingQuota {
  requests?: QuotaWindow;
  tokens?: QuotaWindow;
  contextWindow?: {
    usedTokens: number;
    maxTokens: number;
    utilizationPercent?: number;
  };
  creditsRemainingUsd?: number;
  planType?: 'per-token' | 'plan-included' | 'free-tier';
  label?: string;
  isEstimated?: boolean;
  warningMessage?: string;
}

export type CostConfidence = 'authoritative' | 'estimated' | 'absent';

export type NormalizedUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
  costUsdEstimate?: number;
  costConfidence?: CostConfidence;
  remainingQuota?: NormalizedRemainingQuota;
};

/** Metadata about a local AI session (mirrors src/types.ts). */
export interface AISession {
  id: string;
  assistant: SessionAssistant;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  workspacePath: string;
  threadKind?: 'main' | 'subagent' | 'unknown';
  parentSessionId?: string;
  recordedCwd?: string;
  desktopHandoff?: {
    targetId: 'codex-desktop' | 'claude-desktop';
    method: 'direct' | 'guided';
  };
  usage?: NormalizedUsage;
  quota?: NormalizedRemainingQuota;
}

/** A single chat message in a session transcript (mirrors src/types.ts ChatMessage). */
export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  usage?: NormalizedUsage;
}

export interface RepoInfo {
  name: string;
  path: string;
  defaultBranch: string;
}

export type FreshnessStatus =
  | 'up-to-date'
  | 'behind'
  | 'ahead'
  | 'diverged'
  | 'untracked'
  | 'offline'
  | 'error';

export interface RepoFreshness {
  repoPath: string;
  repoName: string;
  branch: string;
  defaultBranch: string;
  trackingBranch: string | null;
  remoteName: string | null;
  hasRemote: boolean;
  isClean: boolean;
  ahead: number;
  behind: number;
  status: FreshnessStatus;
  message: string;
  error?: string;
}

export interface FastForwardResult {
  success: boolean;
  repoPath: string;
  repoName: string;
  branch: string;
  status: string;
  message: string;
  ahead: number;
  behind: number;
  error?: string;
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

export type FlowPreset = 'quick' | 'quick-fix' | 'feature' | 'epic';

/** How a feature attaches to its repos (mirrors src/types.ts). */
export type WorkspaceMode = 'worktree' | 'in-place';

export interface Feature {
  id: string;
  /** Absent on manifests written before modes existed — treat as 'worktree'. */
  mode?: WorkspaceMode;
  /** Id of the project this feature was created from, if any. */
  projectId?: string;
  branchName: string;
  name?: string;
  description: string;
  repos: string[];
  assistants: string[];
  workspacePath: string;
  createdAt: string;
  workflow?: string;
  flowType?: FlowPreset;
  organizationId?: string;
  domainPacks?: string[];
  isolatedRepos?: Record<string, { worktreePath: string; branchName: string; baseBranch?: string; isolatedAt: string }>;
  originalRepos?: string[];
  repoBranches?: Record<string, string>;
  /** Set while archived: worktrees returned, record kept, read-only (mirrors src/types.ts). */
  archivedAt?: string;
  archiveHistory?: NonNullable<Feature['archive']>[];
  archive?: {
    archivedAt: string;
    previousMode: WorkspaceMode;
    parked: boolean;
    unarchivedAt?: string;
    repos: Array<{
      name: string;
      access: 'reference' | 'isolated' | 'worktree';
      sourcePath: string;
      worktreePath?: string;
      branch?: string | null;
      headSha?: string | null;
      branchState: 'merged' | 'parked' | 'reference';
      mergeEvidence?: 'ancestor' | 'pull-request';
      prUrl?: string;
      branchDeleted?: boolean;
      remoteBranchDeleted?: boolean;
    }>;
  };
}

export interface OrganizationConventions {
  id: string;
  name: string;
  commitMessagePattern?: string;
  commitExample?: string;
  prTemplate?: string;
  rules: string[];
  isTemplate?: boolean;
}

export type CategoryType = 'vertical' | 'trait';

export interface CategoryRepoBinding {
  name: string;
  target?: 'edit' | 'reference';
  description?: string;
  suggestedTestCommand?: string;
}

export interface DomainPack {
  id: string;
  name: string;
  description: string;
  parent?: string;
  categoryType?: CategoryType;
  organization?: string;
  tags: string[];
  skills?: string[];
  contextFiles?: string[];
  verifyCommand?: string;
  rules?: string[];
  defaultRepos?: string[];
  microservices?: CategoryRepoBinding[];
  isTemplate?: boolean;
  builtin?: boolean;
}

export type CategoryTagPack = DomainPack;

export interface ResolvedCategoryRules {
  organizationId?: string;
  assignedDomainPackIds?: string[];
  organization: OrganizationConventions | null;
  domainPacks: DomainPack[];
  verticals: DomainPack[];
  traits: DomainPack[];
  allRules: string[];
  compositeVerifyCommand?: string;
  editRepos: string[];
  referenceRepos: string[];
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
  activeAssistants?: SessionAssistant[];
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
  scope?: 'workspace' | 'global';
  organization?: string;
  domain?: string;
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
  isLegacy?: boolean;
  ledgerPath?: string;
}

export type LifecycleStepStatus =
  | 'pending'
  | 'in_progress'
  | 'verified'
  | 'completed'
  | 'blocked';

export interface LifecycleStep {
  requiresVerification?: boolean;
  id: string;
  title: string;
  description?: string;
  branch?: string;
  repo?: string;
  workItem?: string;
  unblockCondition?: string;
  owner?: string;
  status: LifecycleStepStatus;
  dependsOn?: string[];
  verificationCommand?: string;
  /** Gate time limit in seconds; gates default to 30 minutes. */
  verificationTimeoutSeconds?: number;
  lastVerificationSha?: string;
  lastVerificationStatus?: string;
  completedAt?: string;
}

export interface BranchFleetMember {
  branch: string;
  repoName: string;
  owner?: string;
  isCurrent: boolean;
  headSha?: string;
  ahead: number;
  behind: number;
  lastCommitMessage?: string;
  lastCommitAuthor?: string;
  lastCommitDate?: string;
  remoteTracked: boolean;
}

export interface WorkspaceLifecycle {
  revision?: number;
  workspaceId: string;
  flowType: 'quick' | 'feature' | 'epic';
  currentStepId?: string;
  steps: LifecycleStep[];
  fleet?: BranchFleetMember[];
  updatedAt: string;
}


/** Verification output returned with the workspace lifecycle and by the verify action. */
export interface WorkspaceVerificationReport {
  overallStatus: 'pass' | 'pass_dirty' | 'fail' | 'timeout' | 'no-tests' | 'skipped';
  canProgress: boolean;
  durationMs: number;
  repos: Array<{
    repoName: string;
    status: WorkspaceVerificationReport['overallStatus'];
    command: string;
    exitCode: number | null;
    stdout?: string;
    stderr?: string;
    error?: string;
  }>;
}

export interface WorkDocument {
  id: string;
  title: string;
  role: 'requirements' | 'design' | 'evidence' | 'reference';
  status: 'draft' | 'approved' | 'superseded';
  scope: { milestoneId?: string; project?: boolean };
  summary: string;
  filename?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkGuidance {
  version: 1;
  revision: number;
  workType: 'bug' | 'feature' | 'performance' | 'refactor' | 'rewrite';
  size: 'small' | 'standard' | 'epic';
  assignment: {
    stage: 'investigate' | 'design' | 'implement' | 'verify' | 'review' | 'release';
    objective: string;
    expectedOutput: string;
    stopCondition: string;
    milestoneId?: string;
  };
  documents: WorkDocument[];
}

// ─── Repository safety & delivery ──────────────────────────────────────────

/** How a repository is attached: a read-only reference or an editable worktree. */
export type RepoAccess = 'reference' | 'isolated' | 'worktree';

/** Live state of one workspace repository (GET /api/workspace/:id/repositories). */
export interface WorkspaceRepository {
  name: string;
  access: RepoAccess;
  editable: boolean;
  /** Where the workspace reads the repo and, when editable, edits it. */
  path: string;
  /** The user's own checkout. */
  sourcePath: string;
  /** Current branch, or null when detached. */
  branch: string | null;
  /** Branch edits land on; null for references. */
  expectedBranch: string | null;
  onExpectedBranch: boolean;
  baseBranch: string;
  headSha: string | null;
  dirty: boolean;
  changedFiles: Array<{ code: string; path: string }>;
  ahead: number | null;
  behind: number | null;
  remoteUrl: string | null;
}

export type EvidenceState =
  | 'passed' | 'passed-dirty' | 'no-tests' | 'missing' | 'failed' | 'timed-out' | 'stale' | 'unreadable';

export interface RepoEvidence {
  name: string;
  state: EvidenceState;
  ready: boolean;
  detail: string;
  verifiedAt?: string;
  command?: string;
}

/** The shared finish policy decision (GET /api/workspace/:id/progression). */
export interface ProgressionDecision {
  ready: boolean;
  repos: RepoEvidence[];
  blockers: string[];
}

export interface CommitRepoResult {
  repoName: string;
  success: boolean;
  committed: boolean;
  pushed: boolean;
  pushError?: string;
  branch: string;
  commitHash: string;
  filesChanged: number;
  message: string;
}

export interface CommitResponse {
  results: CommitRepoResult[];
  skipped: Array<{ name: string; reason: string }>;
  conventionWarning?: string;
}

export interface IsolationPlan {
  repoName: string;
  sourcePath: string;
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  alreadyIsolated: boolean;
  conflicts: string[];
}

export interface FinishRepoReport {
  name: string;
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
  branch: string;
  remoteUrl: string | null;
  prUrl?: string;
  compareUrl?: string;
  skipped?: string;
  error?: string;
  wouldCommit?: boolean;
  wouldPush?: boolean;
}

export interface VerificationOverrideRecord {
  at: string;
  operation: 'finish';
  reason: string;
  blockers: string[];
}

export interface FinishReport {
  policy: ProgressionDecision;
  blocked: boolean;
  dryRun: boolean;
  override?: VerificationOverrideRecord;
  resumedFrom?: 'running' | 'partial';
  repos: FinishRepoReport[];
  safeToCleanup: boolean;
}

/** Durable record of the latest finish run (GET /api/workspace/:id/finish/last). */
export interface FinishRecord {
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'partial' | 'blocked';
  repos: Array<Pick<FinishRepoReport, 'name' | 'committed' | 'commitHash' | 'pushed' | 'prUrl' | 'compareUrl' | 'skipped' | 'error'>>;
  override?: VerificationOverrideRecord;
  safeToCleanup: boolean;
}
