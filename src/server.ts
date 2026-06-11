/**
 * @module server
 * Hono local web server for the NexusFlow GUI.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import { loadConfig, saveConfig, getConfigDir } from './core/config.js';
import { scanForRepos } from './core/scanner.js';
import { createWorkspace, listWorkspaces, loadFeatureConfig, deleteWorkspace, addRepoToWorkspace } from './core/workspace.js';
import { analyzeAllRepos } from './analyzers/index.js';
import { generateContextFiles } from './generators/index.js';
import { packWorkspace } from './core/packer.js';
import { isOllamaModelAvailable, getOpenAiCompatibleUrl, callLocalLlm } from './utils/local-ai.js';
import { detectAIAssistants } from './utils/detect-ai.js';
import { detectEditors } from './utils/detect-editors.js';
import { findSessions, getSessionTranscript } from './utils/session-finder.js';
import { scanSystemSpecs } from './utils/system-scanner.js';
import { getWorkspaceRepos, rebaseRepo, commitAndPush, getRepoStatus } from './utils/multi-git.js';
import {
  detectAllServices,
  detectOrchestrationTools,
  startServices,
  stopServices,
  loadRunningState,
} from './orchestration/index.js';
import { checkForUpdates, getCurrentVersion, getToolsStatus } from './utils/update-check.js';
import type { Feature, RepoInfo, WorkspaceContext } from './types.js';

// Resolve static files directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In development, the static GUI is built to dist/gui
// In production, it will be served from dist/gui as well
const guiPath = path.join(__dirname, 'gui');

export const app = new Hono();

// Allowed editor binaries/scripts to prevent command injection
const ALLOWED_EDITORS = new Set(['code', 'code-insiders', 'cursor', 'agy', 'idea', 'charm', 'webstorm', 'subl', 'nano', 'vim', 'nvim', 'emacs']);

// Enable CORS for frontend dev server
app.use('/api/*', cors());

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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

function isSafeLocalEndpoint(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
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
        return c.json({ error: 'Local AI endpoint must be localhost, 127.0.0.1, or a private LAN IP.' }, 400);
      }
    }
    await saveConfig(newConfig);
    return c.json({ success: true, config: newConfig });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 3. Scan development directory for repositories
app.get('/api/repos', async (c) => {
  try {
    const config = await loadConfig();
    const repos = await scanForRepos(config.devDir, config.scanDepth);
    return c.json(repos);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 4. List existing workspaces
app.get('/api/workspaces', async (c) => {
  try {
    const config = await loadConfig();
    const workspaces = await listWorkspaces(config.workspacesDir);
    return c.json(workspaces);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 5. Detect available AI assistants
app.get('/api/ai-detect', async (c) => {
  try {
    const assistants = await detectAIAssistants();
    return c.json(assistants);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 6. Detect available editors
app.get('/api/editor-detect', async (c) => {
  try {
    const editors = await detectEditors();
    return c.json(editors);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 6.5. Local LLM test & recommendation
app.post('/api/local-llm/test', async (c) => {
  try {
    const { provider, endpoint, model, shoot } = await c.req.json();
    if (!endpoint || !isSafeLocalEndpoint(endpoint)) {
      return c.json({ success: false, error: 'Local AI endpoint must be localhost, 127.0.0.1, or a private LAN IP.' }, 400);
    }
    const cleanEndpoint = endpoint.replace(/\/$/, '');
    
    if (shoot) {
      const responseText = await callLocalLlm(
        { enabled: true, provider, endpoint, model },
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
}

const creationJobs = new Map<string, CreationJob>();

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
}

async function runCreationJob(jobId: string, body: any, config: any) {
  try {
    const workspacePath = path.join(config.workspacesDir, body.branchName);
    const job = creationJobs.get(jobId);
    if (job) {
      job.workspacePath = workspacePath;
    }

    const feature: Feature = {
      id: body.branchName,
      branchName: body.branchName,
      description: body.description,
      repos: body.repos.map((r: any) => path.join(workspacePath, r.name)),
      originalRepos: body.repos.map((r: any) => r.path),
      assistants: body.assistants,
      workspacePath,
      createdAt: new Date().toISOString(),
      resumption: body.resumption,
      localLlmEnabled: body.localLlmEnabled,
    };
    if (job) {
      job.feature = feature;
    }

    // Step 1: Create worktrees
    updateJobStep(jobId, 'worktrees', 'running', 'Creating git worktrees...');
    await createWorkspace(feature, body.repos);
    updateJobStep(jobId, 'worktrees', 'completed', 'Git worktrees created successfully.');

    // Step 2: Analyze repos
    updateJobStep(jobId, 'analysis', 'running', 'Analyzing projects and dependencies...');
    const workspaceRepos = body.repos.map((repo: any) => ({
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

    // Step 4: Pack codebase context
    if (config.packContextXml) {
      updateJobStep(jobId, 'pack', 'running', 'Packing codebase context with Repomix...');
      const packResult = await packWorkspace(workspacePath);
      updateJobStep(jobId, 'pack', 'completed', `Packed codebase context (${packResult.totalFiles} files, ${(packResult.fileSize / 1024).toFixed(2)} KB).`);
    }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const job = creationJobs.get(jobId);
    if (job) {
      const runningStep = job.steps.find((s) => s.status === 'running');
      const failedStepId = runningStep ? runningStep.id : 'worktrees';
      updateJobStep(jobId, failedStepId, 'failed', msg);
    }
  }
}

// 7. Create workspace
app.post('/api/workspace', async (c) => {
  try {
    const body = await c.req.json() as {
      branchName: string;
      description: string;
      repos: RepoInfo[];
      assistants: any[];
      localLlmEnabled?: boolean;
      resumption?: {
        testCommand?: string;
        mockCommand?: string;
        startCommand?: string;
      };
    };

    const config = await loadConfig();
    const jobId = body.branchName;

    if (creationJobs.has(jobId)) {
      const existing = creationJobs.get(jobId)!;
      if (existing.status === 'running') {
        return c.json({ success: true, jobId, message: 'Job already running' });
      }
    }

    const steps: JobStep[] = [
      { id: 'worktrees', name: 'Create Git Worktrees', status: 'pending', message: 'Waiting...' },
      { id: 'analysis', name: 'Analyze Repositories', status: 'pending', message: 'Waiting...' },
      { id: 'context', name: 'Generate AI Context Files', status: 'pending', message: 'Waiting...' },
    ];
    if (config.packContextXml) {
      steps.push({ id: 'pack', name: 'Pack Codebase Context', status: 'pending', message: 'Waiting...' });
    }

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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
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

    const listener = async (event: { type: string; data: any }) => {
      try {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event.data),
        });
      } catch (err) {
        job.listeners.delete(listener);
      }
    };

    job.listeners.add(listener);

    // Keep connection alive until job finishes
    while (job.status === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    job.listeners.delete(listener);
  });
});

// 7.6. Delete workspace
app.delete('/api/workspace/:id', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    await deleteWorkspace(workspacePath);
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 7.7. Add repo to workspace
app.post('/api/workspace/:id/repo', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const { repoPath } = await c.req.json() as { repoPath: string };
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    await addRepoToWorkspace(workspacePath, repoPath);
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 9. Get status of running services in all/specific workspace
app.get('/api/workspace/:id/services', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 10. Start services in workspace
app.post('/api/workspace/:id/services/start', async (c) => {
  try {
    const id = c.req.param('id');
    const { services } = await c.req.json() as { services: any[] };
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);
    const logDir = path.join(workspacePath, '.nexusflow-logs');

    await startServices(services, workspacePath, logDir);
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 11. Stop services in workspace
app.post('/api/workspace/:id/services/stop', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    await stopServices(workspacePath);
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 12. Get service logs
app.get('/api/workspace/:id/services/logs/:serviceName', async (c) => {
  try {
    const id = c.req.param('id');
    const serviceName = c.req.param('serviceName');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);
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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13. Get git changes in workspace sub-repositories
app.get('/api/workspace/:id/changes', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13a. Get workspace knowledge (nexusflow-knowledge.md)
app.get('/api/workspace/:id/knowledge', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);
    const knowledgeFile = path.join(workspacePath, 'nexusflow-knowledge.md');

    let content = '';
    try {
      content = await fs.readFile(knowledgeFile, 'utf-8');
    } catch {
      content = '# Workspace Knowledge\n\nNo knowledge file yet.';
    }

    return c.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13b. Update workspace knowledge (nexusflow-knowledge.md)
app.put('/api/workspace/:id/knowledge', async (c) => {
  try {
    const id = c.req.param('id');
    const { content } = await c.req.json() as { content: string };
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);
    const knowledgeFile = path.join(workspacePath, 'nexusflow-knowledge.md');

    await fs.writeFile(knowledgeFile, content, 'utf-8');
    return c.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13c. Get workspace plan (nexusflow-plan.md)
app.get('/api/workspace/:id/plan', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);
    const planFile = path.join(workspacePath, 'nexusflow-plan.md');

    let content = '';
    try {
      content = await fs.readFile(planFile, 'utf-8');
    } catch {
      content = '# Workspace Plan\n\nNo implementation plan file yet.';
    }

    return c.json({ content });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13d. Sync all repositories in workspace
app.post('/api/workspace/:id/sync', async (c) => {
  try {
    const id = c.req.param('id');
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    const repos = await getWorkspaceRepos(workspacePath);
    const results = [];

    for (const repo of repos) {
      const result = await rebaseRepo(repo.path, 'main');
      results.push({
        repoName: repo.name,
        success: result.success,
        message: result.message,
        conflict: result.conflict,
      });
    }

    return c.json({ results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 13e. Commit changes in all repositories in workspace
app.post('/api/workspace/:id/commit', async (c) => {
  try {
    const id = c.req.param('id');
    const { message } = await c.req.json() as { message: string };
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    const repos = await getWorkspaceRepos(workspacePath);
    const results = [];

    for (const repo of repos) {
      const status = await getRepoStatus(repo.path);
      if (status.hasChanges) {
        const result = await commitAndPush(repo.path, message, repo.branchName);
        results.push({
          repoName: repo.name,
          success: result.success,
          commitHash: result.commitHash,
          filesChanged: result.filesChanged,
          message: result.message,
        });
      }
    }

    return c.json({ results });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});


// 14. Resume session in workspace (copies CLI resume command and opens editor)
app.post('/api/workspace/:id/resume', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 15. List past AI sessions for a workspace
app.get('/api/workspace/:id/sessions', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const sessions = await findSessions(workspacePath, feature.repos);
    return c.json({ sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 16. Fetch transcript for a specific AI session
app.get('/api/session/:assistant/:sessionId/transcript', async (c) => {
  try {
    const assistant = c.req.param('assistant');
    const sessionId = c.req.param('sessionId');
    const messages = await getSessionTranscript(assistant, sessionId);
    return c.json({ messages });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 17.5. Check tools updates status
app.get('/api/updates/tools', async (c) => {
  try {
    const force = c.req.query('force') === 'true';
    const status = await getToolsStatus(force);
    return c.json(status);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 17.6. Install updates for a specific tool
app.post('/api/updates/install', async (c) => {
  try {
    const { toolId } = await c.req.json() as { toolId: string };
    const tools = [
      { id: 'nexusflow', cmd: 'npm', args: ['install', '-g', '@mrpatronz/nexusflow'] },
      { id: 'repomix', cmd: 'npm', args: ['install', '-g', 'repomix'] },
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
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// 18. Pack workspace codebase and download
app.get('/api/workspace/:id/pack', async (c) => {
  try {
    const id = decodeURIComponent(c.req.param('id'));
    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, id);

    const feature = await loadFeatureConfig(workspacePath);
    if (!feature) {
      return c.json({ error: 'Workspace configuration not found.' }, 404);
    }

    const result = await packWorkspace(workspacePath);
    const content = await fs.readFile(result.outputPath, 'utf-8');

    c.header('Content-Disposition', `attachment; filename="nexusflow-context-${id.replace(/[\/\\ ]/g, '-')}.xml"`);
    c.header('Content-Type', 'application/xml');
    return c.text(content);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// Serve index.html explicitly on root endpoint
app.get('/', async (c) => {
  try {
    const html = await fs.readFile(path.join(guiPath, 'index.html'), 'utf-8');
    return c.html(html);
  } catch (error) {
    return c.text('GUI dashboard built assets not found. Run "npm run build" first.', 404);
  }
});

// Serve static assets from GUI build folder
app.use('/*', serveStatic({ root: path.relative(process.cwd(), guiPath) }));

export function startServer(port = 3000): Promise<{ port: number; server: any }> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({ port: info.port, server });
    }) as import('node:http').Server;
    
    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        resolve(startServer(port + 1));
      } else {
        reject(e);
      }
    });
  });
}
