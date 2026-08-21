/**
 * @module server
 * Hono local web server for the NexusFlow GUI.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { createNodeWebSocket } from '@hono/node-ws';
import * as fs from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

import { loadConfig, saveConfig, getConfigDir } from './core/config.js';
import { listStorageProviders } from './core/adapters/registry.js';
import { scanForRepos } from './core/scanner.js';
import { createNewRepo } from './core/new-repo.js';
import { loadProjects, createProject, updateProject, removeProject, slugifyProjectName } from './core/projects.js';
import { getSessionCwd, isInPlace, resolveFeatureRepoPath } from './utils/feature.js';
import { listBranches } from './utils/git.js';
import { createWorkspace, listWorkspaces, loadFeatureConfig, loadWorkspaceManifest, deleteWorkspace, addRepoToWorkspace } from './core/workspace.js';
import { loadWorkspaceState } from './core/workspace-state.js';
import { analyzeAllRepos } from './analyzers/index.js';
import { generateContextFiles } from './generators/index.js';

import { detectAIAssistants } from './utils/detect-ai.js';
import { detectEditors } from './utils/detect-editors.js';
import {
  buildWorkspaceLaunchPrompt,
  detectWorkspaceLaunchTargets,
  launchTargetIdForEditorCommand,
  launchWorkspaceTarget,
} from './utils/workspace-launch.js';
import { isBinaryOnPath, launchWorkspaceTerminal, SUPPORTED_ASSISTANTS } from './utils/terminal-launch.js';
import { openInEditor } from './utils/open-editor.js';
import {
  canOpenCodexSessionInWorkspace,
  canTransferClaudeSessionInWorkspace,
  findSessions,
  getSessionTranscript,
} from './utils/session-finder.js';
import { ProviderRegistry } from './agent/adapters.js';
import type { AgentHarness, ProviderAdapter } from './agent/ProviderRegistry.js';
import { isValidSessionUuid, type AgentSession } from './agent/session.js';
import { getRepoStatus } from './utils/multi-git.js';
import { syncWorkspace } from './core/sync.js';
import { commitWorkspace } from './core/commit.js';
import { refreshWorkspace } from './core/refresh.js';
import { writeWorkspaceFile } from './core/storage.js';
import {
  readWorkspaceKnowledge,
  addWorkspaceKnowledge,
  addBaseKnowledge,
  type KnowledgeEntryType,
} from './core/knowledge.js';
import {
  addSchedule,
  loadSchedules,
  nextDueAt,
  parseInterval,
  removeSchedule,
  runJob,
  setScheduleEnabled,
  startScheduler,
} from './core/scheduler.js';
import {
  detectAllServices,
  detectOrchestrationTools,
  startServices,
  stopServices,
  startService,
  stopService,
  restartService,
  startOrchestrator,
  stopOrchestrator,
  tailLogFile,
  loadRunningState,
  getPm2List,
} from './orchestration/index.js';
import { checkForUpdates, getCurrentVersion, getToolsStatus } from './utils/update-check.js';
import { getWorkflowTemplates, saveWorkflowTemplate, deleteWorkflowTemplate } from './utils/workflows.js';
import {


  getSkillCategories,
  saveSkillCategory,
  deleteSkillCategory,
  getAllSkills,
  saveSkill,
  deleteSkill,
  getWorkspaceSkillsConfig,
  saveWorkspaceSkillsConfig,
  WorkspaceResourceRevisionError,
} from './utils/skills-catalog.js';
import {
  deleteAgent,
  getAllAgents,
  importAgentToml,
  saveAgent,
} from './resources/agents-catalog.js';
import { ResourceConflictError } from './resources/materializer.js';
import {
  ResourceSelectionError,
  validateResourceSelections,
  withResourceAdministrationLock,
} from './resources/service.js';

import type { Feature, RepoInfo, RepoSelection, WorkspaceContext, SyncStatus, RepoSyncState } from './types.js';
import { suggestWorkflow } from './utils/workflow-advisor.js';

// Resolve static files directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In development, the static GUI is built to dist/gui
// In production, it will be served from dist/gui as well
const guiPath = path.join(__dirname, 'gui');

export const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

function hasTrustedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/** Validate and dispatch one renderer turn without letting malformed authority reach a harness. */
export function dispatchAgentInput(
  agent: AgentHarness,
  provider: ProviderAdapter,
  payload: { input?: unknown; executionProfile?: unknown },
): string | null {
  if (typeof payload.input !== 'string' || !payload.input.trim()) {
    return 'A non-empty input message is required.';
  }
  const executionProfile = ProviderRegistry.resolveExecutionProfile(provider, payload.executionProfile);
  if (executionProfile === null) {
    return 'Select a supported execution profile before sending this turn.';
  }
  void agent.send(payload.input, executionProfile);
  return null;
}

/** Per-socket admission guard so a second prompt is rejected, never dropped. */
export class AgentTurnGate {
  private active = false;

  public tryBegin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  public settle(): void {
    this.active = false;
  }

  public isActive(): boolean {
    return this.active;
  }
}

app.get('/ws', async (c, next) => {
  // Prevent Cross-Site WebSocket Hijacking (CSWSH)
  const origin = c.req.header('origin');
  if (origin) {
    try {
      const { hostname } = new URL(origin);
      const isLocal = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
      if (!isLocal) return c.text('Forbidden', 403);
    } catch {
      return c.text('Forbidden', 403);
    }
  }
  
  // Chat protocol:
  //   client -> server: {type:'start', command, cwd, sessionId?, resume?}
  //                    | {type:'input', input, turnId?, executionProfile?} | {type:'stop'} | 'ping'
  //   server -> client: {type:'stream', text} | {type:'session', id} | {type:'status', state:'busy'|'idle'} | {type:'system', message}
  //                     | {type:'accepted', turnId?} | {type:'error', message}
  //                     | {type:'rejected', reason:'busy', message, turnId?}
  //                     | {type:'close', code} | {type:'pong'}
  return upgradeWebSocket((c) => {
    let agent: AgentHarness | null = null;
    let activeProvider: ProviderAdapter | null = null;
    const turnGate = new AgentTurnGate();

    return {
      onMessage(event, ws) {
        if (typeof event.data === 'string') {
          if (event.data === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }

          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
            } else if (payload.type === 'start') {
              turnGate.settle();
              if (agent) {
                const previousAgent = agent;
                agent = null;
                activeProvider = null;
                previousAgent.stop();
              }
              const provider = ProviderRegistry.getProvider(payload.command);
              if (!provider) {
                ws.send(JSON.stringify({ type: 'error', message: `No provider found for ${payload.command}. Please create a dedicated adapter.` }));
                return;
              }

              let session: AgentSession | undefined;
              if (payload.sessionId !== undefined && payload.sessionId !== null) {
                if (!isValidSessionUuid(payload.sessionId)) {
                  ws.send(JSON.stringify({ type: 'error', message: 'Invalid session id.' }));
                  return;
                }
                session = { id: payload.sessionId, resume: Boolean(payload.resume) };
              }

              const startedAgent = provider.createInstance();
              agent = startedAgent;
              activeProvider = provider;
              const isCurrentAgent = () => agent === startedAgent;
              startedAgent.on('data', (text: string) => {
                if (!isCurrentAgent()) return;
                ws.send(JSON.stringify({ type: 'stream', text }));
              });
              startedAgent.on('system', (message: string) => {
                if (!isCurrentAgent()) return;
                ws.send(JSON.stringify({ type: 'system', message }));
              });
              startedAgent.on('session', (id: string) => {
                if (!isCurrentAgent()) return;
                // Provider output is still boundary input. Only inert UUIDs
                // may be persisted by the renderer and sent back in argv.
                if (isValidSessionUuid(id)) {
                  ws.send(JSON.stringify({ type: 'session', id }));
                }
              });
              startedAgent.on('idle', () => {
                if (!isCurrentAgent()) return;
                turnGate.settle();
                ws.send(JSON.stringify({ type: 'status', state: 'idle' }));
              });
              startedAgent.on('close', (code: number) => {
                if (!isCurrentAgent()) return;
                turnGate.settle();
                ws.send(JSON.stringify({ type: 'close', code }));
              });
              startedAgent.on('error', (error: Error) => {
                if (!isCurrentAgent()) return;
                ws.send(JSON.stringify({ type: 'error', message: error?.message ?? String(error) }));
              });
              startedAgent.start(payload.cwd, session);
            } else if (payload.type === 'input') {
              if (agent && activeProvider) {
                if (!turnGate.tryBegin()) {
                  const turnId = isValidSessionUuid(payload.turnId) ? payload.turnId : undefined;
                  ws.send(JSON.stringify({
                    type: 'rejected',
                    reason: 'busy',
                    message: 'The agent is still processing the current turn.',
                    ...(turnId ? { turnId } : {}),
                  }));
                  return;
                }
                const error = dispatchAgentInput(agent, activeProvider, payload);
                if (error) {
                  turnGate.settle();
                  ws.send(JSON.stringify({ type: 'error', message: error }));
                  return;
                }
                // Some harness validation failures emit error + idle
                // synchronously from send(); do not overwrite that settled
                // state with a late busy frame.
                if (turnGate.isActive()) {
                  const turnId = isValidSessionUuid(payload.turnId) ? payload.turnId : undefined;
                  ws.send(JSON.stringify({
                    type: 'accepted',
                    ...(turnId ? { turnId } : {}),
                  }));
                  ws.send(JSON.stringify({ type: 'status', state: 'busy' }));
                }
              }
            } else if (payload.type === 'stop') {
              turnGate.settle();
              if (agent) {
                const stoppedAgent = agent;
                agent = null;
                activeProvider = null;
                stoppedAgent.stop();
              }
            }
          } catch (err) {
            console.error('[WS] Failed to parse message', err);
          }
        }
      },
      onOpen(_event, _ws) {
        console.log('[WS] Client connected');
      },
      onClose(_event, _ws) {
        console.log('[WS] Client disconnected');
        turnGate.settle();
        if (agent) {
          const disconnectedAgent = agent;
          agent = null;
          activeProvider = null;
          disconnectedAgent.stop();
        }
      },
    };
  })(c, next);
});

// Allowed editor binaries/scripts to prevent command injection
const ALLOWED_EDITORS = new Set(['code', 'code-insiders', 'cursor', 'antigravity', 'agy', 'idea', 'charm', 'webstorm', 'subl', 'nano', 'vim', 'nvim', 'emacs']);

// ─── Path containment guards ──────────────────────────────────────────────
// The server exposes state-changing routes keyed by a workspace `:id` taken
// straight from the URL. Without containment checks, `..%2f..` sequences let a
// caller read/write/delete files outside the workspaces root. Every handler
// that turns an id (or repo name) into a filesystem path must go through these.

/** Thrown when a requested path escapes its permitted base directory. */
export class PathAccessError extends Error {
  constructor(message = 'Invalid workspace path') {
    super(message);
    this.name = 'PathAccessError';
  }
}

/** Resolve `target` and assert it stays within `baseDir` (or equals it). */
function assertWithin(baseDir: string, target: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(target);
  // Trailing separator prevents a sibling like `feat-secret` from passing the
  // prefix test for base `feat`.
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new PathAccessError();
  }
  return resolved;
}

/** Safe workspace directory for a route `:id`, contained within workspacesDir. */
export function resolveWorkspacePath(workspacesDir: string, id: string): string {
  return assertWithin(workspacesDir, path.join(workspacesDir, id));
}

const DESKTOP_HANDOFF_SCAN_LIMIT = 20;

/**
 * Claude's documented `/desktop` transfer is narrower than its URI handler:
 * it requires macOS or x64 Windows, a subscription login, and a usable CLI.
 */
export function canOfferClaudeDesktopTransfer(
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
  env: NodeJS.ProcessEnv = process.env,
  isCliConfigured: () => boolean = () => {
    try {
      const provider = ProviderRegistry.getProvider('claude-cli');
      if (provider?.isConfigured()) return true;
    } catch {}
    return isBinaryOnPath('claude');
  },
): boolean {
  const supportedPlatform = platform === 'darwin' || (platform === 'win32' && architecture === 'x64');
  const usesUnsupportedAuth = Boolean(
    env.ANTHROPIC_API_KEY
    || env.ANTHROPIC_AUTH_TOKEN
    || env.CLAUDE_CODE_USE_BEDROCK === '1'
    || env.CLAUDE_CODE_USE_VERTEX === '1'
    || env.CLAUDE_CODE_USE_FOUNDRY === '1',
  );
  if (!supportedPlatform || usesUnsupportedAuth) return false;
  try {
    return isCliConfigured();
  } catch {
    return false;
  }
}

/**
 * Resolve a launch path through the filesystem and require it to be the exact
 * workspace declared by its manifest. This prevents symlink escapes and stops
 * loadFeatureConfig's parent-directory fallback from authorizing a child path.
 */
async function resolveExactLaunchWorkspace(
  workspacesDir: string,
  candidatePath: string,
): Promise<string | null> {
  const lexicalPath = assertWithin(workspacesDir, candidatePath);
  const [canonicalRoot, canonicalWorkspace] = await Promise.all([
    fs.realpath(workspacesDir),
    fs.realpath(lexicalPath),
  ]);
  const safeWorkspacePath = assertWithin(canonicalRoot, canonicalWorkspace);
  const feature = await loadWorkspaceManifest(safeWorkspacePath);
  if (!feature || typeof feature.workspacePath !== 'string') return null;

  try {
    const declaredWorkspace = await fs.realpath(path.resolve(feature.workspacePath));
    return path.resolve(declaredWorkspace) === path.resolve(safeWorkspacePath)
      ? safeWorkspacePath
      : null;
  } catch {
    return null;
  }
}

/** Safe sub-repo path for a repo name, contained within the workspace. */
export function resolveRepoPath(workspacePath: string, repoName: string): string {
  return assertWithin(workspacePath, path.join(workspacePath, repoName));
}

/** Consistent error response; path-containment violations map to 400. */
function errorResponse(c: any, error: unknown) {
  if (error instanceof PathAccessError) {
    return c.json({ error: error.message }, 400);
  }
  if (error instanceof ResourceConflictError || error instanceof WorkspaceResourceRevisionError) {
    return c.json({
      error: error.message,
      conflicts: error instanceof ResourceConflictError ? error.conflicts : undefined,
    }, 409);
  }
  if (error instanceof ResourceSelectionError) {
    return c.json({
      error: error.message,
      missingSkills: error.missingSkills,
      missingAgents: error.missingAgents,
    }, 400);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return c.json({ error: msg }, 500);
}

async function resolveExactWorkspaceById(workspacesDir: string, id: string): Promise<string | null> {
  const candidate = resolveWorkspacePath(workspacesDir, id);
  try {
    return await resolveExactLaunchWorkspace(workspacesDir, candidate);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function findResourceAssignments(
  workspacesDir: string,
  resourceId: string,
  kind: 'skill' | 'agent',
): Promise<string[]> {
  const assignments: string[] = [];
  for (const workspace of await listWorkspaces(workspacesDir)) {
    const workspacePath = await resolveExactWorkspaceById(workspacesDir, workspace.id);
    if (!workspacePath) continue;
    const selection = await getWorkspaceSkillsConfig(workspacePath);
    const enabled = kind === 'skill' ? selection.enabledSkills : selection.enabledAgents ?? [];
    if (enabled.includes(resourceId)) assignments.push(workspace.id);
  }
  return assignments;
}

/**
 * Restrict the self-update download to GitHub release hosts over HTTPS so a
 * cross-origin caller cannot make the server fetch and later execute an
 * arbitrary binary.
 */
export function isAllowedUpdateUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'github.com' ||
      host.endsWith('.github.com') ||
      host === 'githubusercontent.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

// Enable CORS for the local GUI only. This server can spawn processes, run
// package installs and delete worktrees, so a wildcard origin would let any
// web page the developer has open drive it cross-origin.
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      // No Origin header → same-origin or a non-browser client (CLI/desktop).
      if (!origin) return origin;
      try {
        const { hostname } = new URL(origin);
        const isLocal =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '[::1]';
        return isLocal ? origin : null;
      } catch {
        return null;
      }
    },
  }),
);

// ─── API Endpoints ────────────────────────────────────────────────────────

// Status checks may execute a trusted local CLI from PATH. Keep that work
// behind a non-simple, same-machine POST so a remote page cannot trigger it
// with an image, link, or cross-origin fetch. These routes intentionally sit
// after the API CORS middleware so the separate Vite dev origin can read them.
app.get('/api/adapters/status', (c) => {
  return c.json({ error: 'Use the same-origin POST status endpoint.' }, 405);
});

app.post('/api/adapters/status', (c) => {
  if (!hasTrustedLocalOrigin(c.req.header('origin'))) {
    return c.json({ error: 'A local browser origin is required.' }, 403);
  }
  return c.json(ProviderRegistry.getAllStatus());
});

app.post('/api/adapters/status/refresh', async (c) => {
  if (!hasTrustedLocalOrigin(c.req.header('origin'))) {
    return c.json({ error: 'A local browser origin is required.' }, 403);
  }

  const body = await c.req.json().catch(() => null) as { providerId?: unknown } | null;
  if (body?.providerId !== 'claude-cli' && body?.providerId !== 'codex-cli') {
    return c.json({ error: 'Only Claude Code and Codex status can be refreshed.' }, 400);
  }
  return c.json(ProviderRegistry.getAllStatus({ refreshProviderId: body.providerId }));
});

// 1. Get current configuration
app.get('/api/config', async (c) => {
  try {
    const configPath = path.join(getConfigDir(), 'config.json');
    let exists = false;
    try {
      await fs.access(configPath);
      exists = true;
    } catch {}

    const config = await loadConfig();
    return c.json({ config, exists });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Get all registered storage adapters
app.get('/api/adapters', async (c) => {
  try {
    const adapters = listStorageProviders();
    return c.json({ adapters });
  } catch (error) {
    return errorResponse(c, error);
  }
});



// 2. Save configuration
app.post('/api/config', async (c) => {
  try {
    const newConfig = await c.req.json();

    await saveConfig(newConfig);
    return c.json({ success: true, config: newConfig });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 3. Scan development directory for repositories
app.get('/api/repos', async (c) => {
  try {
    const config = await loadConfig();
    const repos = await scanForRepos(config.devDir, config.scanDepth);
    return c.json(repos);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 3a. List local and origin branches of a repository (for existing-branch selection)
app.get('/api/repos/branches', async (c) => {
  try {
    const repoPath = c.req.query('path');
    if (!repoPath) {
      return c.json({ error: 'Missing "path" query parameter' }, 400);
    }
    const config = await loadConfig();
    // Only repos under devDir are offered by the scanner; refuse anything else.
    const resolved = assertWithin(config.devDir, repoPath);
    const branches = await listBranches(resolved);
    return c.json(branches);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 3b. Scaffold a brand-new local git repository in devDir
app.post('/api/repos/new', async (c) => {
  try {
    const body = await c.req.json() as { name?: string };
    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'Missing "name" in request body' }, 400);
    }
    const config = await loadConfig();
    const repo = await createNewRepo(config.devDir, body.name);
    return c.json({ success: true, repo });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 3c. Project registry — named groups of source repos that features start from.
app.get('/api/projects', async (c) => {
  try {
    return c.json(await loadProjects({ quiet: true }));
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.post('/api/projects', async (c) => {
  try {
    const body = await c.req.json() as { name?: string; repos?: string[]; description?: string };
    if (!body.name || typeof body.name !== 'string') {
      return c.json({ error: 'Missing "name" in request body' }, 400);
    }
    if (!Array.isArray(body.repos) || body.repos.length === 0) {
      return c.json({ error: 'Missing "repos" in request body' }, 400);
    }
    const config = await loadConfig();
    // Only repos under devDir are offered by the scanner; refuse anything else.
    const repos = body.repos.map((r) => assertWithin(config.devDir, r));
    const project = await createProject(body.name, repos, body.description);
    return c.json(project, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.put('/api/projects/:id', async (c) => {
  try {
    const body = await c.req.json() as { name?: string; repos?: string[]; description?: string };
    let repoPaths: string[] | undefined;
    if (body.repos !== undefined) {
      if (!Array.isArray(body.repos) || body.repos.length === 0) {
        return c.json({ error: '"repos" must be a non-empty array' }, 400);
      }
      const config = await loadConfig();
      repoPaths = body.repos.map((r) => assertWithin(config.devDir, r));
    }
    const project = await updateProject(c.req.param('id'), {
      name: body.name,
      description: body.description,
      repoPaths,
    });
    return c.json(project);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No project')) {
      return c.json({ error: error.message }, 404);
    }
    return errorResponse(c, error);
  }
});

// Registry-only delete — never touches repos or workspaces on disk.
app.delete('/api/projects/:id', async (c) => {
  try {
    const removed = await removeProject(c.req.param('id'));
    if (!removed) {
      return c.json({ error: `No project with id "${c.req.param('id')}"` }, 404);
    }
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 4. List existing workspaces (ordered by newest creation date first)
app.get('/api/workspaces', async (c) => {
  try {
    const config = await loadConfig();
    const workspaces = await listWorkspaces(config.workspacesDir);
    workspaces.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    return c.json(workspaces);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Severity ranking for picking the worst per-repo sync outcome in a workspace.
const SYNC_SEVERITY: Record<SyncStatus, number> = {
  conflict: 4,
  'stash-conflict': 3,
  error: 2,
  rebased: 1,
  'up-to-date': 0,
};

/** Returns the most severe recorded sync status across a workspace's repos. */
function worstSyncStatus(states: RepoSyncState[]): SyncStatus | 'unknown' {
  let worst: SyncStatus | 'unknown' = 'unknown';
  let worstSeverity = -1;
  for (const s of states) {
    if (!s.lastSyncStatus) continue;
    const severity = SYNC_SEVERITY[s.lastSyncStatus];
    if (severity > worstSeverity) {
      worstSeverity = severity;
      worst = s.lastSyncStatus;
    }
  }
  return worst;
}

// 4b. Aggregate at-a-glance status for every workspace (for the listing overview).
// Cheap on purpose: git status + cached running/sync state only — never fetch/rebase.
app.get('/api/workspaces/status', async (c) => {
  try {
    const config = await loadConfig();
    const workspaces = await listWorkspaces(config.workspacesDir);

    // Fetch the PM2 process list once for the whole overview instead of
    // spawning `npx pm2 jlist` per workspace (slow, especially on Windows).
    const pm2List = await getPm2List();

    const entries = await Promise.all(
      workspaces.map(async (ws) => {
        const workspacePath =
          ws.workspacePath || path.join(config.workspacesDir, ws.branchName);
        const status = {
          id: ws.id,
          branchName: ws.branchName,
          changedFiles: 0,
          dirtyRepos: 0,
          runningServices: 0,
          syncStatus: 'unknown' as SyncStatus | 'unknown',
          pendingValidation: false,
        };

        try {
          // Uncommitted changes across the workspace's repos: worktrees inside
          // the workspace dir, or the source repos themselves for in-place.
          for (const repoPath of ws.repos) {
            const worktreePath = resolveFeatureRepoPath(ws, workspacePath, repoPath);
            const repoStatus = await getRepoStatus(worktreePath);
            if (repoStatus.hasChanges) {
              status.dirtyRepos += 1;
              status.changedFiles += repoStatus.changedFiles.length;
            }
          }

          // Running services (cached running-state, PM2-verified — same source as
          // the Services tab; only workspaces that ever started services touch PM2).
          const runningState = await loadRunningState(workspacePath, pm2List);
          status.runningServices =
            (runningState?.services?.length ?? 0) + (runningState?.orchestrators?.length ?? 0);

          // Sync state: worst-case classification + any repo pending validation.
          const wsState = await loadWorkspaceState(workspacePath);
          const repoStates = Object.values(wsState.repos);
          status.syncStatus = worstSyncStatus(repoStates);
          status.pendingValidation = repoStates.some((r) => r.pendingValidation);
        } catch {
          // Leave defaults on any per-workspace failure so one bad repo doesn't
          // fail the whole response.
        }

        return status;
      })
    );

    // Keyed by branchName to match how the GUI looks up a workspace.
    const byWorkspace: Record<string, (typeof entries)[number]> = {};
    for (const entry of entries) byWorkspace[entry.branchName] = entry;
    return c.json(byWorkspace);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 5. Detect available AI assistants
app.get('/api/ai-detect', async (c) => {
  try {
    const assistants = await detectAIAssistants();
    return c.json(assistants);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 6. Detect available editors
app.get('/api/editor-detect', async (c) => {
  try {
    const editors = await detectEditors();
    return c.json(editors);
  } catch (error) {
    return errorResponse(c, error);
  }
});



interface JobStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
}

interface CreationJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  error?: string;
  steps: JobStep[];
  workspacePath?: string;
  feature?: Feature;
  listeners: Set<(event: { type: string; data: any }) => void>;
  cleanupTimer?: ReturnType<typeof setTimeout>;
}

const creationJobs = new Map<string, CreationJob>();

// Keep a finished job around briefly so a late SSE reconnect can still read its
// final state, then drop it so the map doesn't grow unbounded.
const FINISHED_JOB_TTL_MS = 5 * 60 * 1000;

function scheduleJobCleanup(jobId: string) {
  const job = creationJobs.get(jobId);
  if (!job || job.cleanupTimer) return;
  job.cleanupTimer = setTimeout(() => creationJobs.delete(jobId), FINISHED_JOB_TTL_MS);
  job.cleanupTimer.unref?.();
}

function updateJobStep(
  jobId: string,
  stepId: string,
  status: 'running' | 'completed' | 'failed',
  message: string,
  extraData?: any
) {
  const job = creationJobs.get(jobId);
  if (!job) return;

  const step = job.steps.find((s) => s.id === stepId);
  if (step) {
    step.status = status;
    step.message = message;
  }

  const isLastStep = job.steps[job.steps.length - 1]?.id === stepId;
  if (isLastStep && status === 'completed') {
    job.status = 'completed';
    job.progress = 100;
  } else if (status === 'failed') {
    job.status = 'failed';
    job.error = message;
  } else {
    const completedCount = job.steps.filter((s) => s.status === 'completed').length;
    const runningCount = job.steps.filter((s) => s.status === 'running').length;
    job.progress = Math.round(((completedCount + runningCount * 0.5) / job.steps.length) * 100);
  }

  const eventPayload = {
    type: 'progress',
    data: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      steps: job.steps,
      workspacePath: job.workspacePath,
      feature: job.feature,
      ...extraData,
    },
  };

  for (const listener of job.listeners) {
    listener(eventPayload);
  }

  if (job.status === 'completed' || job.status === 'failed') {
    scheduleJobCleanup(jobId);
  }
}

async function runCreationJob(jobId: string, body: any, config: any) {
  try {
    const inPlace = body.mode === 'in-place';
    // Workspace id doubles as the directory name: the branch for worktree
    // mode, the (slugified) workspace name for in-place mode.
    const workspaceId = inPlace ? jobId : body.branchName;
    const workspacePath = resolveWorkspacePath(config.workspacesDir, workspaceId);
    const job = creationJobs.get(jobId);
    if (job) {
      job.workspacePath = workspacePath;
    }

    // Record which repos ride an existing branch instead of the feature branch.
    const repoBranches: Record<string, string> = {};
    for (const r of body.repos as RepoSelection[]) {
      if (r.existingBranch) {
        repoBranches[r.name] = r.existingBranch;
      }
    }

    const feature: Feature = {
      id: workspaceId,
      mode: inPlace ? 'in-place' : 'worktree',
      projectId: body.projectId,
      // In-place features never create a branch; keeping branchName populated
      // (= id) avoids breaking every consumer of the non-optional field.
      branchName: inPlace ? workspaceId : body.branchName,
      description: body.description,
      repos: inPlace
        ? body.repos.map((r: any) => r.path)
        : body.repos.map((r: any) => path.join(workspacePath, r.name)),
      originalRepos: body.repos.map((r: any) => r.path),
      repoBranches: !inPlace && Object.keys(repoBranches).length > 0 ? repoBranches : undefined,
      assistants: body.assistants,
      workspacePath,
      createdAt: new Date().toISOString(),
      resumption: body.resumption,
      teamworkInstructions: body.teamworkInstructions,
    };
    if (job) {
      job.feature = feature;
    }

    // Step 1: Materialize the workspace (worktrees, or just the lightweight
    // dir). One stable step id for both modes — only the wording differs.
    updateJobStep(jobId, 'workspace', 'running', inPlace ? 'Registering workspace...' : 'Creating git worktrees...');
    await createWorkspace(feature, body.repos);

    if (Array.isArray(body.enabledSkills) || Array.isArray(body.enabledAgents) || Array.isArray(body.enabledCategories)) {
      await saveWorkspaceSkillsConfig(workspacePath, {
        enabledSkills: Array.isArray(body.enabledSkills) ? body.enabledSkills : [],
        enabledAgents: Array.isArray(body.enabledAgents) ? body.enabledAgents : [],
        enabledCategories: Array.isArray(body.enabledCategories) ? body.enabledCategories : [],
      });
    }

    updateJobStep(
      jobId,
      'workspace',
      'completed',
      inPlace ? 'Workspace registered — working in-place in the source repos.' : 'Git worktrees created successfully.',
    );

    // Step 2: Analyze repos — against the worktrees, or the source repos in-place.
    updateJobStep(jobId, 'analysis', 'running', 'Analyzing projects and dependencies...');
    const workspaceRepos = inPlace
      ? body.repos
      : body.repos.map((repo: any) => ({
          ...repo,
          path: path.join(workspacePath, repo.name),
        }));
    const analysis = await analyzeAllRepos(workspaceRepos);
    updateJobStep(jobId, 'analysis', 'completed', 'Project analysis complete.');

    // Step 3: Generate AI context files
    updateJobStep(jobId, 'context', 'running', 'Generating AI context files...');
    const ctx: WorkspaceContext = {
      feature,
      repos: workspaceRepos,
      analysis,
    };
    await generateContextFiles(ctx, body.assistants, workspacePath);
    updateJobStep(jobId, 'context', 'completed', 'AI context files generated.');

    // XML context packing removed.

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const job = creationJobs.get(jobId);
    if (job) {
      const runningStep = job.steps.find((s) => s.status === 'running');
      const failedStepId = runningStep ? runningStep.id : 'workspace';
      updateJobStep(jobId, failedStepId, 'failed', msg);
    }
  }
}

// 7. Create workspace
app.post('/api/workspace', async (c) => {
  try {
    const body = await c.req.json() as {
      mode?: 'worktree' | 'in-place';
      projectId?: string;
      /** Workspace name — required for in-place mode (there is no branch). */
      name?: string;
      branchName?: string;
      description: string;
      repos: RepoSelection[];
      assistants: any[];
      enabledSkills?: string[];
      enabledAgents?: string[];
      enabledCategories?: string[];
      teamworkInstructions?: string;
      resumption?: {
        testCommand?: string;
        mockCommand?: string;
        startCommand?: string;
      };
    };

    const inPlace = body.mode === 'in-place';
    if (inPlace && !body.name?.trim()) {
      return c.json({ error: 'In-place workspaces need a "name"' }, 400);
    }
    if (!inPlace && !body.branchName) {
      return c.json({ error: 'Missing "branchName" in request body' }, 400);
    }

    const config = await loadConfig();
    // The job id doubles as the workspace directory name.
    const jobId = inPlace ? slugifyProjectName(body.name!) : body.branchName!;
    if (!jobId) {
      return c.json({ error: `Workspace name "${body.name}" contains no usable characters` }, 400);
    }

    if (creationJobs.has(jobId)) {
      const existing = creationJobs.get(jobId)!;
      if (existing.status === 'running') {
        return c.json({ success: true, jobId, message: 'Job already running' });
      }
    }

    const steps: JobStep[] = [
      // Stable id 'workspace' in both modes so progress consumers never need
      // to know the mode; only the display name differs.
      { id: 'workspace', name: inPlace ? 'Register Workspace' : 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
      { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
      { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
    ];
    // XML context packing removed.

    const job: CreationJob = {
      id: jobId,
      status: 'running',
      progress: 0,
      steps,
      listeners: new Set(),
    };
    creationJobs.set(jobId, job);

    // Run the job in background
    runCreationJob(jobId, body, config);

    return c.json({ success: true, jobId });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 7.5. Create workspace SSE stream
app.get('/api/workspace/create-stream/:jobId', async (c) => {
  const jobId = decodeURIComponent(c.req.param('jobId'));
  const job = creationJobs.get(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return streamSSE(c, async (stream) => {
    // Send initial state
    await stream.writeSSE({
      event: 'progress',
      data: JSON.stringify({
        id: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        steps: job.steps,
        workspacePath: job.workspacePath,
        feature: job.feature,
      }),
    });

    if (job.status === 'completed' || job.status === 'failed') {
      return;
    }

    // Keep the connection open until the job finishes, driven by job events
    // rather than polling.
    await new Promise<void>((resolve) => {
      const listener = async (event: { type: string; data: any }) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        } catch {
          job.listeners.delete(listener);
          resolve();
          return;
        }
        if (event.data?.status === 'completed' || event.data?.status === 'failed') {
          job.listeners.delete(listener);
          resolve();
        }
      };

      job.listeners.add(listener);

      // Guard against the job finishing between the initial state write and
      // now: the client only saw a 'running' frame, so send the terminal
      // state before closing — silently ending the stream here would leave
      // the client believing the connection dropped mid-run.
      if (job.status === 'completed' || job.status === 'failed') {
        job.listeners.delete(listener);
        stream
          .writeSSE({
            event: 'progress',
            data: JSON.stringify({
              id: job.id,
              status: job.status,
              progress: job.progress,
              error: job.error,
              steps: job.steps,
              workspacePath: job.workspacePath,
              feature: job.feature,
            }),
          })
          .catch(() => {})
          .finally(() => resolve());
      }
    });
  });
});

// 7.6. Delete workspace
app.delete('/api/workspace/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    await deleteWorkspace(workspacePath);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 7.7. Add repo to workspace
app.post('/api/workspace/:id/repo', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const { repoPath } = await c.req.json() as { repoPath: string };
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    await addRepoToWorkspace(workspacePath, repoPath);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 7.8. Suggest workflow strategy based on feature description & selected repos
app.post('/api/workspace/suggest-workflow', async (c) => {
  try {
    const { description, repos } = await c.req.json() as {
      description: string;
      repos: RepoInfo[];
    };

    const config = await loadConfig();
    const suggestion = await suggestWorkflow(description, repos);

    return c.json({
      success: true,
      ...suggestion
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 8. List the closed, server-owned launch catalog.
app.get('/api/workspace-launch-targets', async (c) => {
  try {
    return c.json(await detectWorkspaceLaunchTargets());
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 8a. Open a real NexusFlow workspace in a selected desktop app or editor.
app.post('/api/workspace/:id/launch', async (c) => {
  const origin = c.req.header('origin');
  if (origin && !hasTrustedLocalOrigin(origin)) {
    return c.json({ error: 'Forbidden cross-origin request.' }, 403);
  }

  try {
    const id = decodeURIComponent(c.req.param('id'));
    const { targetId, action = 'new', sessionId } = await c.req.json().catch(() => ({})) as {
      targetId?: unknown;
      action?: unknown;
      sessionId?: unknown;
    };
    if (typeof targetId !== 'string' || !targetId) {
      return c.json({ error: 'A workspace launch target is required.' }, 400);
    }
    if (action !== 'new' && action !== 'resume') {
      return c.json({ error: 'Unknown workspace launch action.' }, 400);
    }
    if (action === 'new' && sessionId !== undefined) {
      return c.json({ error: 'A new workspace launch cannot include a session id.' }, 400);
    }

    const config = await loadConfig();
    const requestedWorkspacePath = resolveWorkspacePath(config.workspacesDir, id);
    let workspacePath: string | null;
    try {
      workspacePath = await resolveExactLaunchWorkspace(config.workspacesDir, requestedWorkspacePath);
    } catch (error) {
      if (error instanceof PathAccessError) throw error;
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }
    if (!workspacePath) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }
    const feature = await loadWorkspaceManifest(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const targets = await detectWorkspaceLaunchTargets();
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target) return c.json({ error: 'Unknown workspace launch target.' }, 400);
    if (!target.available) {
      return c.json({ error: target.unavailableReason ?? `${target.name} is unavailable.` }, 409);
    }

    if (action === 'resume') {
      if (targetId !== 'codex-desktop') {
        return c.json({ error: 'This app cannot open an existing coding session.' }, 400);
      }
      if (typeof sessionId !== 'string' || !isValidSessionUuid(sessionId)) {
        return c.json({ error: 'A valid Codex session id is required.' }, 400);
      }
      const ownsSession = await canOpenCodexSessionInWorkspace(
        workspacePath,
        feature.repos,
        sessionId,
      );
      if (!ownsSession) {
        return c.json({ error: 'Codex session not found in this workspace.' }, 404);
      }
      await launchWorkspaceTarget(targetId, workspacePath, { kind: 'resume-session', sessionId });
      return c.json({ success: true, targetId, action, sessionId });
    }

    await launchWorkspaceTarget(targetId, workspacePath, {
      kind: 'new-workspace',
      prompt: buildWorkspaceLaunchPrompt(feature),
    });
    return c.json({ success: true, targetId, action });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 8b. Launch an external interactive terminal for a workspace or AI session.
app.post('/api/workspace/:id/terminal', async (c) => {
  const origin = c.req.header('origin');
  if (origin && !hasTrustedLocalOrigin(origin)) {
    return c.json({ error: 'Forbidden cross-origin request.' }, 403);
  }

  try {
    const id = decodeURIComponent(c.req.param('id'));
    const { command, assistant, sessionId, title } = await c.req.json().catch(() => ({})) as {
      command?: unknown;
      assistant?: unknown;
      sessionId?: unknown;
      title?: unknown;
    };

    if (assistant !== undefined) {
      if (typeof assistant !== 'string' || !SUPPORTED_ASSISTANTS.has(assistant.trim().toLowerCase())) {
        return c.json({ error: 'Invalid or unsupported assistant parameter.' }, 400);
      }
    }

    if (sessionId !== undefined) {
      if (typeof sessionId !== 'string' || !isValidSessionUuid(sessionId)) {
        return c.json({ error: 'Invalid session UUID format.' }, 400);
      }
    }

    if (command !== undefined && (typeof command !== 'string' || !command.trim())) {
      return c.json({ error: 'Command must be a non-empty string.' }, 400);
    }

    if (title !== undefined && typeof title !== 'string') {
      return c.json({ error: 'Title must be a string.' }, 400);
    }

    const config = await loadConfig();
    const requestedWorkspacePath = resolveWorkspacePath(config.workspacesDir, id);
    let workspacePath: string | null;
    try {
      workspacePath = await resolveExactLaunchWorkspace(config.workspacesDir, requestedWorkspacePath);
    } catch (error) {
      if (error instanceof PathAccessError) throw error;
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }
    if (!workspacePath) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const res = await launchWorkspaceTerminal(workspacePath, {
      command: typeof command === 'string' ? command : undefined,
      assistant: typeof assistant === 'string' ? assistant : undefined,
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      title: typeof title === 'string' ? title : undefined,
    });

    return c.json({ success: true, command: res.command });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 8c. Legacy editor route retained for older GUI clients using recognized
// graphical editors. Interactive terminal editors are intentionally rejected:
// a detached HTTP request cannot safely provide their required TTY.
app.post('/api/open-editor', async (c) => {
  const origin = c.req.header('origin');
  if (origin && !hasTrustedLocalOrigin(origin)) {
    return c.json({ error: 'Forbidden cross-origin request.' }, 403);
  }

  try {
    const body = await c.req.json().catch(() => ({})) as {
      workspacePath?: unknown;
      command?: unknown;
    };
    const { workspacePath, command } = body;
    if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
      return c.json({ error: 'Workspace path does not exist' }, 400);
    }
    if (typeof command !== 'string' || !command.trim()) {
      return c.json({ error: 'Forbidden editor command' }, 400);
    }

    const targetId = launchTargetIdForEditorCommand(command);
    if (!ALLOWED_EDITORS.has(command) || !targetId) {
      return c.json({ error: 'Forbidden editor command' }, 400);
    }

    const config = await loadConfig();
    const safeWorkspacePath = assertWithin(config.workspacesDir, workspacePath);

    // Validate this is an existing NexusFlow workspace, not an arbitrary path.
    try {
      const stats = await fs.stat(safeWorkspacePath);
      if (!stats.isDirectory()) {
        return c.json({ error: 'Workspace path is not a directory' }, 400);
      }
    } catch {
      return c.json({ error: 'Workspace path does not exist' }, 400);
    }
    const exactWorkspacePath = await resolveExactLaunchWorkspace(
      config.workspacesDir,
      safeWorkspacePath,
    );
    if (!exactWorkspacePath) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    await launchWorkspaceTarget(targetId, exactWorkspacePath);

    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 9. Get status of running services in all/specific workspace
app.get('/api/workspace/:id/services', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    // Detect all services
    const services = await detectAllServices(workspacePath);
    // Detect existing tools
    const tools = await detectOrchestrationTools(workspacePath);
    // Get currently running services from running state
    const runningState = await loadRunningState(workspacePath);

    return c.json({
      services,
      orchestrationTools: tools,
      runningState: runningState?.services || [],
      runningOrchestrators: runningState?.orchestrators || [],
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 10. Start services in workspace. Configs are re-detected server-side —
// the client only says "start", never what to execute.
app.post('/api/workspace/:id/services/start', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logDir = path.join(workspacePath, '.nexusflow-logs');

    const services = await detectAllServices(workspacePath);
    await startServices(services, workspacePath, logDir);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 11. Stop services in workspace
app.post('/api/workspace/:id/services/stop', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    await stopServices(workspacePath);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 11b. Per-service start / stop / restart. The service config is re-detected
// by name server-side; the client never supplies a command.
app.post('/api/workspace/:id/services/:serviceName/:action{start|stop|restart}', async (c) => {
  try {
    const id = c.req.param('id');
    const serviceName = decodeURIComponent(c.req.param('serviceName'));
    const action = c.req.param('action') as 'start' | 'stop' | 'restart';
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logDir = path.join(workspacePath, '.nexusflow-logs');

    if (action === 'stop') {
      const stopped = await stopService(workspacePath, serviceName);
      return c.json({ success: true, stopped });
    }

    const services = await detectAllServices(workspacePath);
    const service = services.find((s) => s.name === serviceName);
    if (!service) {
      return c.json({ error: `Unknown service "${serviceName}" in this workspace.` }, 404);
    }
    const running = action === 'restart'
      ? await restartService(service, workspacePath, logDir)
      : await startService(service, workspacePath, logDir);
    return c.json({ success: running !== null, service: running });
  } catch (error) {
    return errorResponse(c, error);
  }
});

/** Resolve + contain a service log path; names may contain '/' (repo/sub). */
function resolveServiceLogFile(workspacePath: string, serviceName: string): string {
  const logDir = path.join(workspacePath, '.nexusflow-logs');
  return assertWithin(logDir, path.join(logDir, `${serviceName}.log`));
}

// 12. Get service logs (backfill). Returns the trailing 50KB and the byte
// offset the read ended at, so the SSE stream can resume exactly there.
app.get('/api/workspace/:id/services/logs/:serviceName', async (c) => {
  try {
    const id = c.req.param('id');
    const serviceName = decodeURIComponent(c.req.param('serviceName'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logFile = resolveServiceLogFile(workspacePath, serviceName);

    let content = '';
    let size = 0;
    try {
      const stats = await fs.stat(logFile);
      size = stats.size;
      const start = Math.max(0, size - 50000);
      const fd = await fs.open(logFile, 'r');
      const buffer = Buffer.alloc(size - start);
      await fd.read(buffer, 0, buffer.length, start);
      await fd.close();
      content = buffer.toString('utf-8');
    } catch {
      content = 'No logs available yet.';
    }

    return c.json({ logs: content, size });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 12b. Live log stream (SSE): tails the log file from ?offset onward,
// emitting 'log' events with JSON-encoded chunks (raw SSE frames would mangle
// embedded newlines). A 15s ping keeps idle streams alive.
app.get('/api/workspace/:id/services/logs/:serviceName/stream', async (c) => {
  // Resolve + validate the log path BEFORE opening the stream so a bad name
  // (e.g. a traversal attempt) returns a clean error, mirroring the backfill
  // route, rather than a raw 500 from an uncaught throw.
  let logFile: string;
  let startOffset: number | undefined;
  try {
    const id = c.req.param('id');
    const serviceName = decodeURIComponent(c.req.param('serviceName'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    logFile = resolveServiceLogFile(workspacePath, serviceName);
    const offsetParam = Number.parseInt(c.req.query('offset') ?? '', 10);
    startOffset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : undefined;
  } catch (error) {
    return errorResponse(c, error);
  }

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({ event: 'init', data: JSON.stringify({ offset: startOffset ?? null }) });

    await new Promise<void>((resolve) => {
      let done = false;
      const cleanup = () => {
        if (done) return;
        done = true;
        tail.stop();
        clearInterval(heartbeat);
        resolve();
      };

      const tail = tailLogFile(
        logFile,
        (chunk) => {
          stream.writeSSE({ event: 'log', data: JSON.stringify({ chunk }) }).catch(cleanup);
        },
        { startOffset },
      );

      const heartbeat = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: '{}' }).catch(cleanup);
      }, 15_000);

      stream.onAbort(cleanup);
    });
  });
});

// 12c. Orchestration tools: start/stop by detection id only — the tool is
// re-detected server-side and the client can never supply a command.
app.post('/api/workspace/:id/orchestrators/:action{start|stop}', async (c) => {
  try {
    const id = c.req.param('id');
    const action = c.req.param('action') as 'start' | 'stop';
    const body = await c.req.json() as { id?: string };
    if (!body.id || typeof body.id !== 'string') {
      return c.json({ error: 'Missing orchestrator "id" in request body' }, 400);
    }
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logDir = path.join(workspacePath, '.nexusflow-logs');

    const tools = await detectOrchestrationTools(workspacePath);
    const detection = tools.find((t) => t.id === body.id);
    if (!detection) {
      return c.json({ error: `Unknown orchestration tool "${body.id}" in this workspace.` }, 404);
    }

    if (action === 'start') {
      const running = await startOrchestrator(detection, workspacePath, logDir);
      return c.json({ success: true, orchestrator: running });
    }
    await stopOrchestrator(detection, workspacePath);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13. Get git changes in workspace sub-repositories
app.get('/api/workspace/:id/changes', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    // Load feature config to get repo paths
    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const results: any[] = [];

    // Check git status in each repo (worktree, or source repo for in-place)
    for (const repoPath of feature.repos) {
      const repoName = path.basename(repoPath);
      const worktreePath = resolveFeatureRepoPath(feature, workspacePath, repoPath);

      try {
        const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: worktreePath });
        const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);

        // Get numstat to determine additions and deletions per file
        const numstatMap = new Map<string, { additions: number; deletions: number }>();
        try {
          const { stdout: numstatRaw } = await execa('git', ['diff', 'HEAD', '--numstat'], {
            cwd: worktreePath,
          });
          const numstatLines = numstatRaw.split('\n').filter(Boolean);
          for (const numLine of numstatLines) {
            const match = numLine.trim().match(/^(\d+|-)\s+(\d+|-)\s+(.*)$/);
            if (match) {
              const [, add, del, file] = match;
              numstatMap.set(file.trim(), {
                additions: add === '-' ? 0 : parseInt(add, 10) || 0,
                deletions: del === '-' ? 0 : parseInt(del, 10) || 0,
              });
            }
          }
        } catch (e) {
          // Ignore diff errors
        }

        const files = lines.map((line) => {
          const status = line.slice(0, 2).trim();
          const file = line.slice(2).trim();

          let type = 'modified';
          if (status === 'A' || status === '??') type = 'added';
          else if (status === 'D') type = 'deleted';

          const stats = numstatMap.get(file) || { additions: 0, deletions: 0 };

          return {
            file,
            type,
            rawStatus: status,
            additions: stats.additions,
            deletions: stats.deletions,
          };
        });

        results.push({
          repoName,
          repoPath: worktreePath,
          files,
        });
      } catch (error) {
        results.push({
          repoName,
          repoPath: worktreePath,
          files: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return c.json({ changes: results });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13_diff. Get git diff for a specific file in workspace sub-repositories
app.get('/api/workspace/:id/changes/diff', async (c) => {
  try {
    const id = c.req.param('id');
    const repoName = c.req.query('repo');
    const filePath = c.req.query('file');

    if (!repoName || !filePath) {
      return c.json({ error: 'Missing repo or file query parameter.' }, 400);
    }

    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    // Resolve by mode, manifest first: an in-place repo name may only resolve
    // to an exact manifest entry (its repos live outside the workspace), and
    // must never be shadowed by a stray same-named subdirectory inside the
    // workspace dir. Worktree mode keeps the path-containment guard.
    const feature = await loadFeatureConfig(workspacePath);
    let worktreePath: string;
    if (feature && isInPlace(feature)) {
      const matches = feature.repos.filter((r) => path.basename(r) === repoName);
      if (matches.length === 0) {
        return c.json({ error: `Unknown repo "${repoName}" in this workspace.` }, 404);
      }
      if (matches.length > 1) {
        return c.json({ error: `Repo name "${repoName}" is ambiguous in this workspace.` }, 400);
      }
      worktreePath = matches[0]!;
    } else {
      worktreePath = resolveRepoPath(workspacePath, repoName);
    }

    let diff = '';
    
    // Check git status for the file to know if it's untracked
    try {
      const { stdout: statusOut } = await execa('git', ['status', '--porcelain', '--', filePath], { cwd: worktreePath });
      const statusLine = statusOut.trim();
      const isUntracked = statusLine.startsWith('??');
      
      if (isUntracked) {
        const result = await execa('git', ['diff', '--no-index', '--', '/dev/null', filePath], {
          cwd: worktreePath,
          reject: false
        });
        diff = result.stdout || result.stderr || '';
      } else {
        const result = await execa('git', ['diff', 'HEAD', '--', filePath], {
          cwd: worktreePath,
          reject: false
        });
        diff = result.stdout || result.stderr || '';
      }
    } catch (e) {
      const result = await execa('git', ['diff', 'HEAD', '--', filePath], {
        cwd: worktreePath,
        reject: false
      });
      diff = result.stdout || result.stderr || '';
    }

    return c.json({ diff });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13a. Get workspace knowledge (nexusflow-knowledge.md)
// Routed through the active storage adapter so the GUI edits the same file the
// generators write, whichever backend is active.
app.get('/api/workspace/:id/knowledge', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const content = (await readWorkspaceKnowledge(workspacePath)) ?? '# Workspace Knowledge\n\nNo knowledge file yet.';
    return c.json({ content });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13b. Update workspace knowledge (nexusflow-knowledge.md)
app.put('/api/workspace/:id/knowledge', async (c) => {
  try {
    const id = c.req.param('id');
    const { content } = await c.req.json() as { content: string };
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const feature = await loadFeatureConfig(workspacePath);
    const featureId = feature?.id ?? path.basename(workspacePath);
    await writeWorkspaceFile(workspacePath, featureId, 'nexusflow-knowledge.md', content);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13b-2. Append a single structured learning (used for a GUI quick-add).
app.post('/api/workspace/:id/knowledge/entry', async (c) => {
  try {
    const id = c.req.param('id');
    const body = (await c.req.json()) as {
      type: KnowledgeEntryType;
      message: string;
      title?: string;
      repo?: string;
    };
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const result = body.repo
      ? await addBaseKnowledge(workspacePath, body.repo, {
          type: body.type,
          message: body.message,
          title: body.title,
        })
      : await addWorkspaceKnowledge(workspacePath, {
          type: body.type,
          message: body.message,
          title: body.title,
        });

    return c.json({ success: true, ...result });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13c. Get workspace plan (nexusflow-plan.md)
app.get('/api/workspace/:id/plan', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const planFile = path.join(workspacePath, 'nexusflow-plan.md');

    let content = '';
    try {
      content = await fs.readFile(planFile, 'utf-8');
    } catch {
      content = '# Workspace Plan\n\nNo implementation plan file yet.';
    }

    return c.json({ content });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13d. Sync all repositories in workspace
app.post('/api/workspace/:id/sync', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const report = await syncWorkspace(workspacePath);
    const results = report.repos.map((repo) => ({
      repoName: repo.name,
      success: repo.status !== 'conflict' && repo.status !== 'error',
      status: repo.status,
      message: repo.message,
      conflict: repo.conflict,
    }));

    return c.json({
      results,
      syncedCount: report.syncedCount,
      conflictCount: report.conflictCount,
      errorCount: report.errorCount,
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 13e. Commit changes in all repositories in workspace
app.post('/api/workspace/:id/commit', async (c) => {
  try {
    const id = c.req.param('id');
    const { message } = await c.req.json() as { message: string };
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const report = await commitWorkspace(workspacePath, message);
    const results = report.repos.map((repo) => ({
      repoName: repo.name,
      success: repo.success,
      commitHash: repo.commitHash,
      filesChanged: repo.filesChanged,
      message: repo.message,
    }));

    return c.json({ results });
  } catch (error) {
    return errorResponse(c, error);
  }
});


// 14. Resume session in workspace (copies CLI resume command and opens editor)
app.post('/api/workspace/:id/resume', async (c) => {
  const origin = c.req.header('origin');
  if (origin && !hasTrustedLocalOrigin(origin)) {
    return c.json({ error: 'Forbidden cross-origin request.' }, 403);
  }

  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    // Load feature config to get repo paths
    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const body = await c.req.json().catch(() => ({})) as {
      sessionId?: unknown;
      assistant?: unknown;
      command?: unknown;
    };
    const targetSessionId = typeof body.sessionId === 'string' && isValidSessionUuid(body.sessionId) ? body.sessionId : undefined;
    if (body.sessionId !== undefined && targetSessionId === undefined) {
      return c.json({ error: 'Invalid session UUID format.' }, 400);
    }
    if (body.command !== undefined && (typeof body.command !== 'string' || !ALLOWED_EDITORS.has(body.command))) {
      return c.json({ error: 'Forbidden editor command' }, 400);
    }
    const targetAssistant = typeof body.assistant === 'string' ? body.assistant : undefined;

    // Find the session to resume
    let resumeCommand = '';
    let selectedAssistant = targetAssistant || feature.assistants[0] || 'antigravity';
    let selectedSessionId = targetSessionId;

    if (!selectedSessionId) {
      // Find the most recent session matching this workspace
      const sessions = await findSessions(workspacePath, feature.repos);
      if (sessions.length > 0) {
        selectedSessionId = sessions[0].id;
        selectedAssistant = sessions[0].assistant;
      }
    }

    if (selectedSessionId) {
      if (selectedAssistant === 'antigravity') {
        resumeCommand = `agy --conversation ${selectedSessionId}`;
      } else if (selectedAssistant === 'claude') {
        resumeCommand = `claude --resume ${selectedSessionId}`;
      } else if (selectedAssistant === 'codex') {
        resumeCommand = `codex resume ${selectedSessionId}`;
      } else if (selectedAssistant === 'copilot') {
        resumeCommand = `copilot --resume ${selectedSessionId}`;
      }
    } else {
      // Fallback to start command (since there's no existing session for this workspace)
      if (selectedAssistant === 'antigravity') {
        resumeCommand = 'agy --continue';
      } else if (selectedAssistant === 'claude') {
        resumeCommand = 'claude --resume';
      } else if (selectedAssistant === 'codex') {
        resumeCommand = 'codex resume';
      } else if (selectedAssistant === 'copilot') {
        resumeCommand = 'copilot --resume';
      } else {
        resumeCommand = 'agy --continue';
      }
    }

    // Open in editor if command is provided
    if (body.command) {
      if (!ALLOWED_EDITORS.has(body.command)) {
        return c.json({ error: 'Forbidden editor command' }, 400);
      }
      try {
        await openInEditor(body.command, workspacePath);
      } catch (err) {
        console.error(`Failed to launch editor ${body.command} for path ${workspacePath}:`, err);
      }
    }

    // Where the resume command should be run: the workspace dir, or the repo
    // root for single-repo in-place features.
    return c.json({ success: true, resumeCommand, workspacePath, sessionCwd: getSessionCwd(feature) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 15. List past AI sessions for a workspace
app.get('/api/workspace/:id/sessions', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const limitParam = c.req.query('limit');
    const desktopHandoffOnly = c.req.query('desktopHandoffOnly') === 'true';
    let limit: number | undefined;
    if (limitParam !== undefined) {
      limit = Number(limitParam);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
        return c.json({ error: 'Session limit must be an integer from 1 to 20.' }, 400);
      }
    }
    const config = await loadConfig();
    const requestedWorkspacePath = resolveWorkspacePath(config.workspacesDir, id);
    let workspacePath = requestedWorkspacePath;
    let feature;
    if (desktopHandoffOnly) {
      try {
        const exactWorkspacePath = await resolveExactLaunchWorkspace(config.workspacesDir, requestedWorkspacePath);
        if (!exactWorkspacePath) {
          return c.json({ error: 'Workspace configuration not found.' }, 404);
        }
        workspacePath = exactWorkspacePath;
      } catch (error) {
        if (error instanceof PathAccessError) throw error;
        return c.json({ error: 'Workspace configuration not found.' }, 404);
      }
      feature = await loadWorkspaceManifest(workspacePath);
    } else {
      feature = await loadFeatureConfig(workspacePath);
    }
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const discoveredSessions = await findSessions(workspacePath, feature.repos);
    if (!desktopHandoffOnly) {
      return c.json({ sessions: limit === undefined ? discoveredSessions : discoveredSessions.slice(0, limit) });
    }

    const requestedCount = limit ?? 3;
    const candidates = discoveredSessions
      .filter((session) => session.assistant === 'codex' || session.assistant === 'claude')
      .slice(0, DESKTOP_HANDOFF_SCAN_LIMIT);
    const sessions = [];
    const claudeTransferAvailable = candidates.some((session) => session.assistant === 'claude')
      && canOfferClaudeDesktopTransfer();
    for (const session of candidates) {
      if (session.assistant === 'codex' && await canOpenCodexSessionInWorkspace(
        workspacePath,
        feature.repos,
        session.id,
      )) {
        sessions.push({
          ...session,
          desktopHandoff: { targetId: 'codex-desktop' as const, method: 'direct' as const },
        });
      } else if (
        session.assistant === 'claude'
        && claudeTransferAvailable
        && await canTransferClaudeSessionInWorkspace(workspacePath, feature.repos, session.id)
      ) {
        sessions.push({
          ...session,
          desktopHandoff: { targetId: 'claude-desktop' as const, method: 'guided' as const },
        });
      }
      if (sessions.length === requestedCount) break;
    }
    return c.json({ sessions });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 16. Fetch transcript for a specific AI session
app.get('/api/session/:assistant/:sessionId/transcript', async (c) => {
  const assistant = c.req.param('assistant');
  const sessionId = c.req.param('sessionId');
  try {
    if (!SUPPORTED_ASSISTANTS.has(assistant.trim().toLowerCase())) {
      return c.json({ error: `Unsupported assistant: "${assistant}".` }, 400);
    }
    if (!isValidSessionUuid(sessionId)) {
      return c.json({ error: 'Invalid session UUID format.' }, 400);
    }

    const messages = await getSessionTranscript(assistant, sessionId);
    return c.json({ messages });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 17. Check for NexusFlow updates
app.get('/api/update-status', async (c) => {
  try {
    const status = await checkForUpdates(false);
    if (!status) {
      const currentVersion = getCurrentVersion();
      return c.json({ currentVersion, latestVersion: currentVersion, updateAvailable: false });
    }
    return c.json(status);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 17.5. Check tools updates status
app.get('/api/updates/tools', async (c) => {
  try {
    const force = c.req.query('force') === 'true';
    const status = await getToolsStatus(force);
    return c.json(status);
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 17.6. Install updates for a specific tool
app.post('/api/updates/install', async (c) => {
  try {
    const { toolId } = await c.req.json() as { toolId: string };
    const tools = [
      { id: 'nexusflow', cmd: 'npm', args: ['install', '-g', '@mrpatronz/nexusflow'] },
      { id: 'antigravity', cmd: 'agy', args: ['update'] },
      { id: 'claude', cmd: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code'] },
    ];

    const target = tools.find(t => t.id === toolId);
    if (!target) {
      return c.json({ error: 'Tool not found' }, 404);
    }

    const result = await execa(target.cmd, target.args, {
      reject: false,
      shell: process.platform === 'win32',
    });
    if (result.exitCode === 0) {
      return c.json({ success: true, output: result.stdout });
    } else {
      return c.json({ error: `Update failed: ${result.stderr || result.stdout}` }, 500);
    }
  } catch (error) {
    return errorResponse(c, error);
  }
});

let downloadedInstallerPath: string | null = null;

// 17.7. Download matching GitHub Release installer to temporary folder
app.post('/api/updates/download', async (c) => {
  try {
    const { downloadUrl } = await c.req.json() as { downloadUrl: string };
    if (!downloadUrl) {
      return c.json({ error: 'Download URL is required' }, 400);
    }
    if (!isAllowedUpdateUrl(downloadUrl)) {
      return c.json({ error: 'Download URL is not an allowed update host' }, 400);
    }

    const tempDir = os.tmpdir();
    const fileName = 'NexusFlowSetup_Update.exe';
    const targetPath = path.join(tempDir, fileName);

    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}`);
    }

    // Node fetch body stream download
    const fileStream = createWriteStream(targetPath);
    if (!response.body) {
      throw new Error('Response body is null');
    }
    
    // Convert ReadableStream to Node stream
    await pipeline(response.body as any, fileStream);

    downloadedInstallerPath = targetPath;
    return c.json({ success: true, path: targetPath });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Download failed: ${msg}` }, 500);
  }
});

// 17.8. Launch the silent installer detached and exit server
app.post('/api/updates/apply', async (c) => {
  if (!downloadedInstallerPath || !existsSync(downloadedInstallerPath)) {
    return c.json({ error: 'No downloaded installer found on disk' }, 400);
  }

  try {
    const isWin = process.platform === 'win32';
    if (isWin) {
      // The desktop app ships an electron-builder NSIS installer (build target
      // 'nsis'), whose silent-install switch is `/S` — NOT Inno Setup's
      // /VERYSILENT. With the wrong flags the one-click installer waits for UI
      // that a detached (stdio: 'ignore') process can never provide, so the
      // update silently fails to apply. `/S` runs it unattended and relaunches
      // the app on finish (electron-builder default).
      console.log(`Applying update: Spawning detached installer at: ${downloadedInstallerPath}`);
      const child = spawn(downloadedInstallerPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }

    // Gracefully exit server process in 1 second to release file locks
    setTimeout(() => {
      console.log('Update installer successfully spawned. Exiting Hono server process...');
      process.exit(0);
    }, 1000);

    return c.json({ success: true, message: 'Installer spawned, app shutting down...' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: `Failed to execute update: ${msg}` }, 500);
  }
});

// 17.9. Get available workflow templates
app.get('/api/workflows/templates', async (c) => {
  try {
    const templates = await getWorkflowTemplates();
    return c.json({ templates });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Save or update custom teamwork template
app.post('/api/workflows/templates', async (c) => {
  try {
    const { id, name, content } = await c.req.json();
    if (!name || !content) {
      return c.json({ error: 'Name and content are required.' }, 400);
    }
    const template = await saveWorkflowTemplate(name, content, id);
    return c.json({ success: true, template });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Delete custom teamwork template
app.delete('/api/workflows/templates/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const templates = await getWorkflowTemplates();
    const target = templates.find(t => t.id === id);
    if (!target) {
      return c.json({ error: 'Template not found.' }, 404);
    }
    if (!target.custom) {
      return c.json({ error: 'Cannot delete built-in templates.' }, 403);
    }
    await deleteWorkflowTemplate(id);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Analyze teamwork template rules via selected AI coding assistant harness
app.post('/api/workflows/templates/:id/analyze', async (c) => {
  try {
    const { content, assistant, comment } = await c.req.json();
    if (!content) {
      return c.json({ error: 'Content is required.' }, 400);
    }

    const selectedAssistant = assistant || 'antigravity';
    let command = '';
    let args: string[] = [];
    let commandInput = '';

    let prompt = `You are an expert AI system engineering reviewer. Analyze the following Agent Teamwork Strategy guidelines.
Evaluate its instructions, identify any ambiguities or contradictions, rate its expected effectiveness for orchestrating subagents, and provide specific recommendations or improvements. Format your analysis in clean Markdown with clear headings (e.g. Overview, Strengths, Weaknesses, Recommendations).

After your analysis, provide a fully rewritten, optimized, and complete version of the strategy guidelines incorporating all your recommendations. This rewritten version must be suitable for production orchestration.
You MUST prefix the rewritten version with the exact delimiter line:
=== SUGGESTED IMPROVEMENT START ===
and suffix it with:
=== SUGGESTED IMPROVEMENT END ===`;

    if (comment && comment.trim()) {
      prompt += `\n\nIMPORTANT: The user has provided the following specific instruction/comment that you MUST consider and prioritize during your evaluation and when rewriting the guidelines:\n"${comment.trim()}"`;
    }

    prompt += `\n\n--- GUIDELINES START ---\n${content}\n--- GUIDELINES END ---`;

    const assistants = await detectAIAssistants();
    const target = assistants.find(ai => ai.name === selectedAssistant);
    
    if (!target || !target.detected || !target.command) {
      return c.json({
        error: `AI assistant harness '${selectedAssistant}' is not detected or does not support command-line execution.`
      }, 400);
    }

    command = target.command;
    if (command === 'claude') {
      args = ['-p', prompt];
    } else if (command === 'agy') {
      args = [prompt];
    } else if (command === 'codex') {
      // Captured stdio cannot host the interactive TUI. `codex exec` is the
      // supported non-interactive surface and reuses the user's CLI login.
      args = ['exec', '--color', 'never', '-'];
      commandInput = prompt;
    } else {
      args = [prompt];
    }

    const result = await execa(command, args, {
      input: commandInput,
      shell: false,
      reject: false
    });

    if (result.exitCode !== 0) {
      return c.json({
        error: `AI Assistant harness execution failed (exit code ${result.exitCode}): ${result.stderr || result.stdout || 'Unknown error'}`
      }, 500);
    }

    // Clean potential warning lines or stdout prefixes if present
    let cleanText = result.stdout;
    if (cleanText.includes('Warning: no stdin data received')) {
      cleanText = cleanText.replace(/Warning: no stdin data received in \d+s, proceeding without it\. If piping from a slow command, redirect stdin explicitly: < \/dev\/null to skip, or wait longer\.\r?\n?/, '');
    }

    let analysis = cleanText.trim();
    let suggestedImprovement = '';

    const startDelimiter = '=== SUGGESTED IMPROVEMENT START ===';
    const endDelimiter = '=== SUGGESTED IMPROVEMENT END ===';

    const startIdx = cleanText.indexOf(startDelimiter);
    const endIdx = cleanText.indexOf(endDelimiter);

    if (startIdx !== -1 && endIdx !== -1) {
      analysis = cleanText.substring(0, startIdx).trim();
      suggestedImprovement = cleanText.substring(startIdx + startDelimiter.length, endIdx).trim();
    }

    return c.json({ analysis, suggestedImprovement });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// ─── Skills & Categories Catalog ──────────────────────────────────────────

// Get all skill categories (built-in templates + user custom)
app.get('/api/skills/categories', async (c) => {
  try {
    const categories = await getSkillCategories();
    return c.json({ categories });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Save or update a custom skill category
app.post('/api/skills/categories', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name) {
      return c.json({ error: 'Category name is required.' }, 400);
    }
    const category = await saveSkillCategory(body);
    return c.json({ success: true, category });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Delete a custom skill category
app.delete('/api/skills/categories/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    await deleteSkillCategory(id);
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Get authoritative skills (built-ins + personal catalog). Workspace
// materializations are deliberately never treated as catalog sources.
app.get('/api/skills', async (c) => {
  try {
    const skills = await getAllSkills();
    return c.json({ skills });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Save or update a custom skill
app.post('/api/skills', async (c) => {
  try {
    const body = await c.req.json();
    if (!body.name || !body.content) {
      return c.json({ error: 'Skill name and content are required.' }, 400);
    }
    const skill = await saveSkill(body);
    return c.json({ success: true, skill });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

// Delete a custom skill
app.delete('/api/skills/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const assignments = await withResourceAdministrationLock(async () => {
      const currentAssignments = await findResourceAssignments(config.workspacesDir, id, 'skill');
      if (!currentAssignments.length) await deleteSkill(id);
      return currentAssignments;
    });
    if (assignments.length) {
      return c.json({
        error: `Unassign the skill from these workspaces before deleting it: ${assignments.join(', ')}`,
        workspaces: assignments,
      }, 409);
    }
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Codex-native custom-agent catalog. Other harness agent formats are not
// translated because their configuration and permission models are different.
app.get('/api/agents', async (c) => {
  try {
    return c.json({ agents: await getAllAgents() });
  } catch (error) {
    return errorResponse(c, error);
  }
});

app.post('/api/agents', async (c) => {
  try {
    const agent = await saveAgent(await c.req.json());
    return c.json({ success: true, agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.post('/api/agents/import', async (c) => {
  try {
    const body = await c.req.json();
    if (typeof body.toml !== 'string') {
      return c.json({ error: 'A TOML string is required.' }, 400);
    }
    const agent = await importAgentToml(body.toml, typeof body.category === 'string' ? body.category : 'general');
    return c.json({ success: true, agent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }
});

app.delete('/api/agents/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const assignments = await withResourceAdministrationLock(async () => {
      const currentAssignments = await findResourceAssignments(config.workspacesDir, id, 'agent');
      if (!currentAssignments.length) await deleteAgent(id);
      return currentAssignments;
    });
    if (assignments.length) {
      return c.json({
        error: `Unassign the agent from these workspaces before deleting it: ${assignments.join(', ')}`,
        workspaces: assignments,
      }, 409);
    }
    return c.json({ success: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Get workspace skills assignment config
app.get('/api/skills/workspace/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const wsPath = await resolveExactWorkspaceById(config.workspacesDir, id);
    if (!wsPath) return c.json({ error: 'Workspace not found.' }, 404);
    const skillsConfig = await getWorkspaceSkillsConfig(wsPath);
    return c.json({ config: skillsConfig });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Save workspace skills assignment config
app.post('/api/skills/workspace/:id/assign', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const body = await c.req.json();
    if (!Array.isArray(body.enabledSkills) || !Array.isArray(body.enabledAgents)) {
      return c.json({ error: 'enabledSkills and enabledAgents arrays are required.' }, 400);
    }
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
      return c.json({ error: 'A nonnegative integer expectedRevision is required.' }, 400);
    }
    const config = await loadConfig();
    const wsPath = await resolveExactWorkspaceById(config.workspacesDir, id);
    if (!wsPath) return c.json({ error: 'Workspace not found.' }, 404);
    const saved = await withResourceAdministrationLock(async () => {
      await validateResourceSelections(body.enabledSkills, body.enabledAgents);
      return saveWorkspaceSkillsConfig(
        wsPath,
        {
          enabledSkills: body.enabledSkills,
          enabledAgents: body.enabledAgents,
          enabledCategories: Array.isArray(body.enabledCategories) ? body.enabledCategories : [],
        },
        body.expectedRevision,
      );
    });
    return c.json({ success: true, config: saved });
  } catch (error) {
    return errorResponse(c, error);
  }
});


// ─── Schedules: recurring workspace jobs (sync/refresh) ─────────────────


// List all scheduled jobs (with computed next-due time)
app.get('/api/schedules', async (c) => {
  const store = await loadSchedules();
  const jobs = store.jobs.map((job) => ({
    ...job,
    nextDueAt: nextDueAt(job)?.toISOString() ?? null,
  }));
  return c.json({ jobs });
});

// Create a scheduled job
app.post('/api/schedules', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const task = body.task === 'refresh' ? 'refresh' : body.task === 'sync' ? 'sync' : null;
  if (!task) {
    return c.json({ error: 'task must be "sync" or "refresh"' }, 400);
  }

  const intervalMinutes =
    typeof body.intervalMinutes === 'number' && body.intervalMinutes > 0
      ? Math.floor(body.intervalMinutes)
      : parseInterval(String(body.every ?? ''));
  if (!intervalMinutes) {
    return c.json({ error: 'Provide intervalMinutes (> 0) or every (e.g. "30m", "2h", "1d")' }, 400);
  }

  const config = await loadConfig();
  const workspacePath = body.workspacePath
    ? String(body.workspacePath)
    : body.workspaceId
      ? path.join(config.workspacesDir, String(body.workspaceId))
      : null;
  if (!workspacePath) {
    return c.json({ error: 'Provide workspacePath or workspaceId' }, 400);
  }

  const feature = await loadFeatureConfig(workspacePath);
  if (!feature) {
    return c.json({ error: `No NexusFlow workspace found at ${workspacePath}` }, 404);
  }

  const job = await addSchedule({ workspacePath, task, intervalMinutes });
  return c.json({ job }, 201);
});

// Enable/disable a scheduled job
app.post('/api/schedules/:id/enabled', async (c) => {
  const body = await c.req.json().catch(() => ({} as any));
  const job = await setScheduleEnabled(c.req.param('id'), Boolean(body.enabled));
  if (!job) return c.json({ error: 'Schedule not found' }, 404);
  return c.json({ job });
});

// Run a scheduled job immediately
app.post('/api/schedules/:id/run', async (c) => {
  const store = await loadSchedules();
  const job = store.jobs.find((j) => j.id === c.req.param('id'));
  if (!job) return c.json({ error: 'Schedule not found' }, 404);
  const result = await runJob(job);
  return c.json({ result });
});

// Delete a scheduled job
app.delete('/api/schedules/:id', async (c) => {
  const removed = await removeSchedule(c.req.param('id'));
  if (!removed) return c.json({ error: 'Schedule not found' }, 404);
  return c.json({ ok: true });
});

// Refresh a workspace's context files on demand (cache-aware)
app.post('/api/workspace/:id/refresh', async (c) => {
  try {
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const report = await refreshWorkspace(workspacePath, { force: Boolean(body.force) });
    return c.json({ report });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// Legacy pack endpoint removed.

// Serve index.html explicitly on root endpoint
app.get('/', async (c) => {
  try {
    const html = await fs.readFile(path.join(guiPath, 'index.html'), 'utf-8');
    return c.html(html);
  } catch (error) {
    return c.text('GUI dashboard built assets not found. Run "npm run build" first.', 404);
  }
});

// Serve static assets from GUI build folder. Use the absolute build path
// (serveStatic joins root + request path) so asset serving does not depend on
// the server's cwd — a cwd on another drive made the old cwd-relative path
// resolve wrong and serve a blank GUI, e.g. under `ui --daemon`.
app.use('/*', serveStatic({ root: guiPath }));

export function startServer(
  port = 3000,
  opts: { strictPort?: boolean } = {},
): Promise<{ port: number; server: any }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
      // The dashboard server doubles as the host for recurring workspace
      // jobs (nexusflow schedule ...); jobs are re-read from disk each tick.
      startScheduler({ log: (message) => console.log(`[scheduler] ${message}`) });
      resolve({ port: info.port, server });
    }) as import('node:http').Server;

    injectWebSocket(server);

    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        // Callers that own their backend (desktop/extension) pass strictPort so
        // they can rely on the port they requested instead of chasing a silent
        // increment they'd never find.
        if (opts.strictPort) {
          reject(new Error(`Port ${port} is already in use.`));
        } else {
          resolve(startServer(port + 1, opts));
        }
      } else {
        reject(e);
      }
    });
  });
}
