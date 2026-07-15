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
import { listBranches } from './utils/git.js';
import { createWorkspace, listWorkspaces, loadFeatureConfig, deleteWorkspace, addRepoToWorkspace } from './core/workspace.js';
import { loadWorkspaceState } from './core/workspace-state.js';
import { analyzeAllRepos } from './analyzers/index.js';
import { generateContextFiles } from './generators/index.js';
import { isOllamaModelAvailable, getOpenAiCompatibleUrl, callLocalLlm } from './utils/local-ai.js';
import { detectAIAssistants } from './utils/detect-ai.js';
import { detectEditors } from './utils/detect-editors.js';
import { findSessions, getSessionTranscript } from './utils/session-finder.js';
import { ProviderRegistry } from './agent/adapters.js';
import { AgentHarness } from './agent/ProviderRegistry.js';
import { isValidSessionUuid, type AgentSession } from './agent/session.js';
import { scanSystemSpecs } from './utils/system-scanner.js';
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
  loadRunningState,
  getPm2List,
} from './orchestration/index.js';
import { checkForUpdates, getCurrentVersion, getToolsStatus } from './utils/update-check.js';
import { getWorkflowTemplates, saveWorkflowTemplate, deleteWorkflowTemplate } from './utils/workflows.js';
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

app.get('/api/adapters/status', (c) => {
  return c.json(ProviderRegistry.getAllStatus());
});

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
  //   client -> server: {type:'start', command, cwd, sessionId?, resume?} | {type:'input', input} | {type:'stop'} | 'ping'
  //   server -> client: {type:'stream', text} | {type:'status', state:'busy'|'idle'} | {type:'system', message}
  //                     | {type:'error', message} | {type:'close', code} | {type:'pong'}
  return upgradeWebSocket((c) => {
    let agent: AgentHarness | null = null;

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
              if (agent) {
                agent.stop();
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

              agent = provider.createInstance();
              agent.on('data', (text: string) => {
                ws.send(JSON.stringify({ type: 'stream', text }));
              });
              agent.on('system', (message: string) => {
                ws.send(JSON.stringify({ type: 'system', message }));
              });
              agent.on('idle', () => {
                ws.send(JSON.stringify({ type: 'status', state: 'idle' }));
              });
              agent.on('close', (code: number) => {
                ws.send(JSON.stringify({ type: 'close', code }));
              });
              agent.on('error', (error: Error) => {
                ws.send(JSON.stringify({ type: 'error', message: error?.message ?? String(error) }));
                ws.send(JSON.stringify({ type: 'status', state: 'idle' }));
              });
              agent.start(payload.cwd, session);
            } else if (payload.type === 'input') {
              if (agent) {
                agent.send(payload.input);
                ws.send(JSON.stringify({ type: 'status', state: 'busy' }));
              }
            } else if (payload.type === 'stop') {
              if (agent) {
                agent.stop();
                agent = null;
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
        if (agent) {
          agent.stop();
          agent = null;
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

/** Safe sub-repo path for a repo name, contained within the workspace. */
export function resolveRepoPath(workspacePath: string, repoName: string): string {
  return assertWithin(workspacePath, path.join(workspacePath, repoName));
}

/** Consistent error response; path-containment violations map to 400. */
function errorResponse(c: any, error: unknown) {
  if (error instanceof PathAccessError) {
    return c.json({ error: error.message }, 400);
  }
  const msg = error instanceof Error ? error.message : String(error);
  return c.json({ error: msg }, 500);
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

function isSafeLocalEndpoint(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol === 'https:') {
      return true;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      return true;
    }
    const ipv4Pattern = /^(?:10|127|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\.\d+\.\d+\.\d+$/;
    if (ipv4Pattern.test(hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// 2. Save configuration
app.post('/api/config', async (c) => {
  try {
    const newConfig = await c.req.json();
    if (newConfig?.localLlm?.enabled && newConfig.localLlm.endpoint) {
      if (!isSafeLocalEndpoint(newConfig.localLlm.endpoint)) {
        return c.json({ error: 'Local AI endpoint must be HTTPS, localhost, 127.0.0.1, or a private LAN IP.' }, 400);
      }
    }
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

// 4. List existing workspaces
app.get('/api/workspaces', async (c) => {
  try {
    const config = await loadConfig();
    const workspaces = await listWorkspaces(config.workspacesDir);
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
          // Uncommitted changes across the workspace's repo worktrees.
          for (const repoPath of ws.repos) {
            const worktreePath = path.join(workspacePath, path.basename(repoPath));
            const repoStatus = await getRepoStatus(worktreePath);
            if (repoStatus.hasChanges) {
              status.dirtyRepos += 1;
              status.changedFiles += repoStatus.changedFiles.length;
            }
          }

          // Running services (cached running-state, PM2-verified — same source as
          // the Services tab; only workspaces that ever started services touch PM2).
          const runningState = await loadRunningState(workspacePath, pm2List);
          status.runningServices = runningState?.services?.length ?? 0;

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

// 6.5. Local LLM test & recommendation
app.post('/api/local-llm/test', async (c) => {
  try {
    const { provider, endpoint, model, apiKey, shoot } = await c.req.json();
    if (!endpoint || !isSafeLocalEndpoint(endpoint)) {
      return c.json({ success: false, error: 'Local AI endpoint must be HTTPS, localhost, 127.0.0.1, or a private LAN IP.' }, 400);
    }
    const cleanEndpoint = endpoint.replace(/\/$/, '');
    
    if (shoot) {
      const responseText = await callLocalLlm(
        { enabled: true, provider, endpoint, model, apiKey },
        [{ role: 'user', content: 'Respond with the exact word "OK" and nothing else.' }]
      );
      const cleanResponse = responseText.trim();
      return c.json({
        success: true,
        modelReady: true,
        message: `Inference test succeeded! Response from model: "${cleanResponse}"`
      });
    }

    if (provider === 'ollama') {
      const res = await fetch(`${cleanEndpoint}/api/tags`);
      if (!res.ok) throw new Error(`Ollama responded with status ${res.status}`);
      const data: any = await res.json();
      const models = data?.models || [];
      const isModelLoaded = isOllamaModelAvailable(models, model);
      return c.json({ 
        success: true, 
        modelReady: isModelLoaded,
        message: isModelLoaded ? 'Connected successfully! Model is ready.' : `Connected successfully, but model "${model}" is not pulled. Run "ollama pull ${model}" to install it.`
      });
    } else {
      const testUrl = getOpenAiCompatibleUrl(cleanEndpoint, '/v1/models');
      const res = await fetch(testUrl);
      if (!res.ok) throw new Error(`OpenAI-compatible server responded with status ${res.status}`);
      return c.json({ success: true, modelReady: true, message: 'Connected successfully to OpenAI-compatible server!' });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ success: false, error: msg }, 400);
  }
});

app.get('/api/local-llm/recommend', async (c) => {
  try {
    const specs = await scanSystemSpecs();
    return c.json(specs);
  } catch (error) {
    return c.json({
      totalRamGb: 8,
      gpuName: 'Unknown/Integrated',
      hasHardwareAcceleration: false,
      recommendedModel: 'qwen2.5-coder:1.5b',
    });
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
      localLlmEnabled: body.localLlmEnabled,
      teamworkInstructions: body.teamworkInstructions,
    };
    if (job) {
      job.feature = feature;
    }

    // Step 1: Materialize the workspace (worktrees, or just the lightweight dir).
    if (inPlace) {
      updateJobStep(jobId, 'workspace', 'running', 'Registering workspace...');
      await createWorkspace(feature, body.repos);
      updateJobStep(jobId, 'workspace', 'completed', 'Workspace registered — working in-place in the source repos.');
    } else {
      updateJobStep(jobId, 'worktrees', 'running', 'Creating git worktrees...');
      await createWorkspace(feature, body.repos);
      updateJobStep(jobId, 'worktrees', 'completed', 'Git worktrees created successfully.');
    }

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
      localLlm: config.localLlm,
    };
    await generateContextFiles(ctx, body.assistants, workspacePath);
    updateJobStep(jobId, 'context', 'completed', 'AI context files generated.');

    // XML context packing removed.

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const job = creationJobs.get(jobId);
    if (job) {
      const runningStep = job.steps.find((s) => s.status === 'running');
      const failedStepId = runningStep ? runningStep.id : job.steps[0]?.id ?? 'worktrees';
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
      localLlmEnabled?: boolean;
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
      inPlace
        ? { id: 'workspace', name: 'Register Workspace', status: 'pending', message: 'Waiting...' }
        : { id: 'worktrees', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
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

      // Guard against the job finishing between the initial state write and now.
      if (job.status === 'completed' || job.status === 'failed') {
        job.listeners.delete(listener);
        resolve();
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
    const suggestion = await suggestWorkflow(description, repos, config.localLlm);

    return c.json({
      success: true,
      ...suggestion
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 8. Open workspace in editor
app.post('/api/open-editor', async (c) => {
  try {
    const { workspacePath, command } = await c.req.json() as {
      workspacePath: string;
      command: string;
    };

    if (!ALLOWED_EDITORS.has(command)) {
      return c.json({ error: 'Forbidden editor command' }, 400);
    }

    // Validate path exists and is a directory
    try {
      const stats = await fs.stat(workspacePath);
      if (!stats.isDirectory()) {
        return c.json({ error: 'Workspace path is not a directory' }, 400);
      }
    } catch {
      return c.json({ error: 'Workspace path does not exist' }, 400);
    }

    // Spawn editor process
    const isWin = process.platform === 'win32';
    const child = execa(command, [workspacePath], {
      detached: true,
      stdio: 'ignore',
      shell: isWin,
      cleanup: false,
    });
    child.unref();
    child.catch((err) => {
      console.error(`Failed to launch editor ${command} for path ${workspacePath}:`, err);
    });

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
    });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 10. Start services in workspace
app.post('/api/workspace/:id/services/start', async (c) => {
  try {
    const id = c.req.param('id');
    const { services } = await c.req.json() as { services: any[] };
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logDir = path.join(workspacePath, '.nexusflow-logs');

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

// 12. Get service logs
app.get('/api/workspace/:id/services/logs/:serviceName', async (c) => {
  try {
    const id = c.req.param('id');
    const serviceName = c.req.param('serviceName');
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);
    const logFile = path.join(workspacePath, '.nexusflow-logs', `${serviceName}.log`);

    let content = '';
    try {
      // Read last 200 lines or 50KB
      const stats = await fs.stat(logFile);
      const size = stats.size;
      const start = Math.max(0, size - 50000);
      const fd = await fs.open(logFile, 'r');
      const buffer = Buffer.alloc(size - start);
      await fd.read(buffer, 0, buffer.length, start);
      await fd.close();
      content = buffer.toString('utf-8');
    } catch {
      content = 'No logs available yet.';
    }

    return c.json({ logs: content });
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

    // Check git status in each repo
    for (const repoPath of feature.repos) {
      const repoName = path.basename(repoPath);
      const worktreePath = path.join(workspacePath, repoName);

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
            const parts = numLine.trim().split(/\s+/);
            if (parts.length >= 3) {
              const [add, del, file] = parts;
              numstatMap.set(file, {
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
    // Contained within the workspace; rejects `..` and sibling-prefix escapes.
    const worktreePath = resolveRepoPath(workspacePath, repoName);

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
// generators write (under the central-vault adapter this lives outside the
// workspace directory).
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
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    // Load feature config to get repo paths
    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const targetSessionId = body.sessionId;
    const targetAssistant = body.assistant;

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
      const isWin = process.platform === 'win32';
      const child = execa(body.command, [workspacePath], {
        detached: true,
        stdio: 'ignore',
        shell: isWin,
        cleanup: false,
      });
      child.unref();
      child.catch((err) => {
        console.error(`Failed to launch editor ${body.command} for path ${workspacePath}:`, err);
      });
    }

    return c.json({ success: true, resumeCommand, workspacePath });
  } catch (error) {
    return errorResponse(c, error);
  }
});

// 15. List past AI sessions for a workspace
app.get('/api/workspace/:id/sessions', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = resolveWorkspacePath(config.workspacesDir, id);

    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const sessions = await findSessions(workspacePath, feature.repos);
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
      // Inno Setup silent install flags
      console.log(`Applying update: Spawning detached installer at: ${downloadedInstallerPath}`);
      const child = spawn(downloadedInstallerPath, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], {
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
    } else {
      args = [prompt];
    }

    const result = await execa(command, args, {
      input: '',
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
