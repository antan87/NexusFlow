/**
 * @module server
 * Hono local web server for the NexusFlow GUI.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { cors } from 'hono/cors';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import { loadConfig, saveConfig, getConfigDir } from './core/config.js';
import { scanForRepos } from './core/scanner.js';
import { createWorkspace, listWorkspaces, loadFeatureConfig } from './core/workspace.js';
import { analyzeAllRepos } from './analyzers/index.js';
import { generateContextFiles } from './generators/index.js';
import { detectAIAssistants } from './utils/detect-ai.js';
import { detectEditors } from './utils/detect-editors.js';
import { findSessions, getSessionTranscript } from './utils/session-finder.js';
import { getWorkspaceRepos, rebaseRepo, commitAndPush, getRepoStatus } from './utils/multi-git.js';
import {
  detectAllServices,
  detectOrchestrationTools,
  startServices,
  stopServices,
  loadRunningState,
} from './orchestration/index.js';
import { checkForUpdates, getCurrentVersion } from './utils/update-check.js';
import type { Feature, RepoInfo, WorkspaceContext } from './types.js';

// Resolve static files directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In development, the static GUI is built to dist/gui
// In production, it will be served from dist/gui as well
const guiPath = path.join(__dirname, 'gui');

export const app = new Hono();

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

// 2. Save configuration
app.post('/api/config', async (c) => {
  try {
    const newConfig = await c.req.json();
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

// 7. Create workspace
app.post('/api/workspace', async (c) => {
  try {
    const body = await c.req.json() as {
      branchName: string;
      description: string;
      repos: RepoInfo[];
      assistants: any[];
      resumption?: {
        testCommand?: string;
        mockCommand?: string;
        startCommand?: string;
      };
    };

    const config = await loadConfig();
    const workspacePath = path.join(config.workspacesDir, body.branchName);

    const feature: Feature = {
      id: body.branchName,
      branchName: body.branchName,
      description: body.description,
      repos: body.repos.map((r) => r.path),
      assistants: body.assistants,
      workspacePath,
      createdAt: new Date().toISOString(),
      resumption: body.resumption,
    };

    // Create worktrees
    await createWorkspace(feature, body.repos);

    // Analyze repos
    const analysis = await analyzeAllRepos(body.repos);

    // Convert map to plain object for context generators if needed
    const ctx: WorkspaceContext = {
      feature,
      repos: body.repos,
      analysis,
    };

    // Generate AI context files
    await generateContextFiles(ctx, body.assistants, workspacePath);

    return c.json({ success: true, workspacePath, feature });
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

    // Spawn editor process
    execa(command, [workspacePath], { detached: true, stdio: 'ignore' }).unref();
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
        resumeCommand = 'agy';
      } else if (selectedAssistant === 'claude') {
        resumeCommand = 'claude';
      } else if (selectedAssistant === 'codex') {
        resumeCommand = 'codex';
      } else if (selectedAssistant === 'copilot') {
        resumeCommand = 'copilot';
      } else {
        resumeCommand = 'agy';
      }
    }

    // Open in editor if command is provided
    if (body.command) {
      try {
        execa(body.command, [workspacePath], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) {
        console.error('Failed to launch editor:', e);
      }
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

/**
 * Starts the local GUI web server.
 *
 * @param port - Port to run on.
 */
export function startServer(port = 3000): Promise<{ port: number; server: any }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({ port: info.port, server });
    });
  });
}
