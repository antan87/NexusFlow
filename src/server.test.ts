import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import { app, isAllowedUpdateUrl } from './server.js';
import * as workspace from './core/workspace.js';
import * as config from './core/config.js';
import * as systemScanner from './utils/system-scanner.js';
import * as localAi from './utils/local-ai.js';
import * as updateCheck from './utils/update-check.js';
import * as analyzers from './analyzers/index.js';
import * as generators from './generators/index.js';
import * as workflows from './utils/workflows.js';
import * as detectAi from './utils/detect-ai.js';
import * as newRepo from './core/new-repo.js';

// Mock dependencies
vi.mock('node:fs/promises');
vi.mock('execa');
vi.mock('./core/workspace.js');
vi.mock('./core/config.js');
vi.mock('./utils/system-scanner.js');
vi.mock('./utils/local-ai.js');
vi.mock('./utils/update-check.js');
vi.mock('./analyzers/index.js');
vi.mock('./generators/index.js');
vi.mock('./utils/workflows.js');
vi.mock('./utils/detect-ai.js', () => ({
  detectAIAssistants: vi.fn().mockResolvedValue([])
}));
vi.mock('./core/new-repo.js');

describe('Server API Endpoints Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/open-editor', () => {
    it('should return 400 for forbidden editor commands', async () => {
      const response = await app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: '/mock/workspace/path',
          command: 'rm -rf /'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Forbidden editor command');
    });

    it('should return 400 if workspace path does not exist', async () => {
      vi.spyOn(fs, 'stat').mockRejectedValue(new Error('File not found'));

      const response = await app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: '/non-existent/path',
          command: 'code-insiders'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Workspace path does not exist');
    });

    it('should return 400 if workspace path is not a directory', async () => {
      vi.spyOn(fs, 'stat').mockResolvedValue({
        isDirectory: () => false
      } as any);

      const response = await app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: '/mock/file.txt',
          command: 'code-insiders'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Workspace path is not a directory');
    });

    it('should call execa with detached, stdio, shell, and cleanup options and return success', async () => {
      vi.spyOn(fs, 'stat').mockResolvedValue({
        isDirectory: () => true
      } as any);

      // Mock execa to return a dummy child process with a catch method
      const dummyChild = {
        unref: vi.fn(),
        catch: vi.fn().mockReturnThis()
      };
      vi.mocked(execa).mockReturnValue(dummyChild as any);

      const response = await app.request('/api/open-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspacePath: '/mock/workspace/dir',
          command: 'code-insiders'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      const isWin = process.platform === 'win32';
      expect(execa).toHaveBeenCalledWith('code-insiders', ['/mock/workspace/dir'], {
        detached: true,
        stdio: 'ignore',
        shell: isWin,
        cleanup: false
      });
      expect(dummyChild.unref).toHaveBeenCalled();
      expect(dummyChild.catch).toHaveBeenCalled();
    });
  });

  describe('POST /api/workspace/:id/resume', () => {
    it('should fail with 400 if command is forbidden', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces'
      } as any);
      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
        id: 'test-ws',
        repos: [],
        assistants: ['antigravity']
      } as any);

      const response = await app.request('/api/workspace/test-ws/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'malicious-editor',
          assistant: 'antigravity'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Forbidden editor command');
    });

    it('should spawn the editor with proper options when resuming', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces'
      } as any);
      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
        id: 'test-ws',
        repos: [],
        assistants: ['antigravity']
      } as any);

      const dummyChild = {
        unref: vi.fn(),
        catch: vi.fn().mockReturnThis()
      };
      vi.mocked(execa).mockReturnValue(dummyChild as any);

      const response = await app.request('/api/workspace/test-ws/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: 'code',
          assistant: 'antigravity'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      const isWin = process.platform === 'win32';
      expect(execa).toHaveBeenCalledWith('code', [expect.any(String)], {
        detached: true,
        stdio: 'ignore',
        shell: isWin,
        cleanup: false
      });
      expect(dummyChild.unref).toHaveBeenCalled();
      expect(dummyChild.catch).toHaveBeenCalled();
    });
  });

  describe('GET /api/config', () => {
    it('should load configuration successfully', async () => {
      vi.spyOn(config, 'getConfigDir').mockReturnValue('/mock/config-dir');
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        devDir: '/mock/dev',
        scanDepth: 2
      } as any);
      vi.spyOn(fs, 'access').mockResolvedValue();

      const response = await app.request('/api/config');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.config.devDir).toBe('/mock/dev');
      expect(data.exists).toBe(true);
    });
  });

  describe('GET /api/adapters', () => {
    it('should return all registered storage adapters with meta', async () => {
      const response = await app.request('/api/adapters');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.adapters).toBeDefined();
      expect(Array.isArray(data.adapters)).toBe(true);
      // It should include at least 'local' and 'central-vault'
      const names = data.adapters.map((a: any) => a.name);
      expect(names).toContain('local');
      expect(names).toContain('central-vault');
    });
  });

  describe('GET /api/repos/branches', () => {
    it('should return 400 when the path parameter is missing', async () => {
      const response = await app.request('/api/repos/branches');
      expect(response.status).toBe(400);
    });

    it('should return 400 when the path escapes devDir', async () => {
      vi.mocked(config.loadConfig).mockResolvedValue({ devDir: '/mock/dev' } as any);

      const response = await app.request(
        `/api/repos/branches?path=${encodeURIComponent('/mock/dev/../../etc')}`,
      );
      expect(response.status).toBe(400);
    });

    it('should list local and origin branches for a repo inside devDir', async () => {
      vi.mocked(config.loadConfig).mockResolvedValue({ devDir: '/mock/dev' } as any);
      vi.mocked(execa).mockResolvedValue({
        stdout: 'main\nfeature/x\norigin/HEAD\norigin/main\norigin/remote-only',
      } as any);

      const response = await app.request(
        `/api/repos/branches?path=${encodeURIComponent('/mock/dev/repo1')}`,
      );
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.local).toEqual(['main', 'feature/x']);
      expect(data.remote).toEqual(['main', 'remote-only']);
    });
  });

  describe('POST /api/repos/new', () => {
    it('should return 400 when the name is missing', async () => {
      const response = await app.request('/api/repos/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(400);
    });

    it('should scaffold a repo in devDir and return it', async () => {
      vi.mocked(config.loadConfig).mockResolvedValue({ devDir: '/mock/dev' } as any);
      const repo = { name: 'newproj', path: '/mock/dev/newproj', defaultBranch: 'main' };
      vi.mocked(newRepo.createNewRepo).mockResolvedValue(repo);

      const response = await app.request('/api/repos/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'newproj' }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.repo).toEqual(repo);
      expect(newRepo.createNewRepo).toHaveBeenCalledWith('/mock/dev', 'newproj');
    });
  });

  describe('POST /api/config', () => {
    it('should validate endpoint domain safety', async () => {
      const response = await app.request('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localLlm: {
            enabled: true,
            endpoint: 'http://malicious-external-domain.com'
          }
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Local AI endpoint must be HTTPS, localhost, 127.0.0.1, or a private LAN IP.');
    });

    it('should save safe endpoint and config', async () => {
      vi.spyOn(config, 'saveConfig').mockResolvedValue();

      const response = await app.request('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          localLlm: {
            enabled: true,
            endpoint: 'http://127.0.0.1:11434'
          }
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('POST /api/local-llm/test', () => {
    it('should reject unsafe endpoints', async () => {
      const response = await app.request('/api/local-llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'http://unsafe-domain.com',
          provider: 'ollama',
          model: 'qwen2.5-coder:1.5b'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Local AI endpoint must be');
    });

    it('should perform inference shoot test if shoot = true', async () => {
      vi.spyOn(localAi, 'callLocalLlm').mockResolvedValue('OK\n');

      const response = await app.request('/api/local-llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: 'http://localhost:11434',
          provider: 'ollama',
          model: 'qwen2.5-coder:1.5b',
          shoot: true
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.modelReady).toBe(true);
      expect(data.message).toContain('Inference test succeeded');
    });
  });

  describe('GET /api/local-llm/recommend', () => {
    it('should fetch system specs and return them', async () => {
      vi.spyOn(systemScanner, 'scanSystemSpecs').mockResolvedValue({
        totalRamGb: 16,
        gpuName: 'Nvidia RTX 4080',
        hasHardwareAcceleration: true,
        recommendedModel: 'qwen2.5-coder:7b'
      });

      const response = await app.request('/api/local-llm/recommend');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.totalRamGb).toBe(16);
      expect(data.gpuName).toBe('Nvidia RTX 4080');
      expect(data.recommendedModel).toBe('qwen2.5-coder:7b');
    });
  });

  describe('GET and PUT /api/workspace/:id/knowledge', () => {
    it('should get workspace knowledge content', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces'
      } as any);
      vi.spyOn(fs, 'readFile').mockResolvedValue('# Mock Knowledge File content');

      const response = await app.request('/api/workspace/test-ws/knowledge');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe('# Mock Knowledge File content');
    });

    it('should write workspace knowledge content', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces'
      } as any);
      vi.spyOn(fs, 'writeFile').mockResolvedValue();

      const response = await app.request('/api/workspace/test-ws/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Updated Content' })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  describe('GET /api/workspace/:id/plan', () => {
    it('should get workspace plan content', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces'
      } as any);
      vi.spyOn(fs, 'readFile').mockResolvedValue('# Mock Plan content');

      const response = await app.request('/api/workspace/test-ws/plan');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.content).toBe('# Mock Plan content');
    });
  });

  describe('POST /api/updates/install', () => {
    it('should fail if tool not found', async () => {
      const response = await app.request('/api/updates/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: 'invalid-tool' })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe('Tool not found');
    });

    it('should install tool successfully if execa exits with 0', async () => {
      vi.mocked(execa).mockResolvedValue({ exitCode: 0, stdout: 'Successfully updated' } as any);

      const response = await app.request('/api/updates/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: 'nexusflow' })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.output).toBe('Successfully updated');
      expect(execa).toHaveBeenCalledWith('npm', ['install', '-g', '@mrpatronz/nexusflow'], expect.any(Object));
    });
  });

  describe('POST /api/workspace', () => {
    it('should complete workspace creation successfully', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces',
        storageProvider: 'local'
      } as any);

      vi.spyOn(workspace, 'createWorkspace').mockResolvedValue('/mock/workspaces/test-ws-creation-no-pack');
      vi.spyOn(analyzers, 'analyzeAllRepos').mockResolvedValue(new Map());
      vi.spyOn(generators, 'generateContextFiles').mockResolvedValue(undefined);

      const response = await app.request('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchName: 'test-ws-creation-no-pack',
          description: 'A test workspace',
          repos: [{ name: 'repo-1', path: '/mock/repo-1' }],
          assistants: ['antigravity']
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.jobId).toBe('test-ws-creation-no-pack');

      // Wait a brief tick for the background job to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(workspace.createWorkspace).toHaveBeenCalled();
      expect(analyzers.analyzeAllRepos).toHaveBeenCalled();
      expect(generators.generateContextFiles).toHaveBeenCalled();

      // Read status via SSE stream route
      const streamResponse = await app.request('/api/workspace/create-stream/test-ws-creation-no-pack');
      expect(streamResponse.status).toBe(200);
      const text = await streamResponse.text();
      expect(text).toContain('"status":"completed"');
      expect(text).toContain('"progress":100');
    });

    // XML context packing tests removed.

    it('rejects in-place creation without a name', async () => {
      const response = await app.request('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'in-place',
          description: 'nameless',
          repos: [{ name: 'repo-1', path: '/mock/repo-1' }],
          assistants: ['claude']
        })
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('name');
    });

    it('rejects worktree creation without a branch name', async () => {
      const response = await app.request('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: 'branchless',
          repos: [{ name: 'repo-1', path: '/mock/repo-1' }],
          assistants: ['claude']
        })
      });

      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain('branchName');
    });

    it('creates an in-place workspace against the source repos (no worktree remap)', async () => {
      vi.spyOn(config, 'loadConfig').mockResolvedValue({
        workspacesDir: '/mock/workspaces',
        storageProvider: 'local'
      } as any);
      vi.spyOn(workspace, 'createWorkspace').mockResolvedValue('/mock/workspaces/my-quick-fix');
      vi.spyOn(analyzers, 'analyzeAllRepos').mockResolvedValue(new Map());
      vi.spyOn(generators, 'generateContextFiles').mockResolvedValue(undefined);

      const response = await app.request('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'in-place',
          name: 'My Quick Fix',
          projectId: 'billing',
          description: 'in-place workspace',
          repos: [{ name: 'repo-1', path: '/mock/repo-1', defaultBranch: 'main' }],
          assistants: ['claude']
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // The name is slugified into the job/workspace id.
      expect(data.jobId).toBe('my-quick-fix');

      await new Promise((resolve) => setTimeout(resolve, 50));

      const feature = vi.mocked(workspace.createWorkspace).mock.calls[0][0];
      expect(feature.mode).toBe('in-place');
      expect(feature.id).toBe('my-quick-fix');
      expect(feature.projectId).toBe('billing');
      // Repos stay at their source paths — no join(workspacePath, name) remap.
      expect(feature.repos).toEqual(['/mock/repo-1']);
      // Analysis also runs against the source repos.
      const analyzed = vi.mocked(analyzers.analyzeAllRepos).mock.calls[0][0];
      expect(analyzed[0].path).toBe('/mock/repo-1');

      // The SSE stream reports the in-place step set.
      const streamResponse = await app.request('/api/workspace/create-stream/my-quick-fix');
      const text = await streamResponse.text();
      expect(text).toContain('"status":"completed"');
      expect(text).toContain('Register Workspace');
      expect(text).not.toContain('Create Git Worktrees');
    });
  });

  describe('Workflows Templates API', () => {
    it('GET /api/workflows/templates should return list of templates', async () => {
      vi.spyOn(workflows, 'getWorkflowTemplates').mockResolvedValue([
        { id: 'test-id', name: 'Test Name', description: 'Test Desc', content: 'Test Content', custom: false }
      ]);

      const response = await app.request('/api/workflows/templates');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        templates: [
          { id: 'test-id', name: 'Test Name', description: 'Test Desc', content: 'Test Content', custom: false }
        ]
      });
    });

    it('POST /api/workflows/templates should create or update template', async () => {
      vi.spyOn(workflows, 'saveWorkflowTemplate').mockResolvedValue({
        id: 'test-id',
        name: 'Test Name',
        description: 'Test Desc',
        content: 'Test Content',
        custom: true
      });

      const response = await app.request('/api/workflows/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'old-id', name: 'Test Name', content: 'Test Content' })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.template.id).toBe('test-id');
      expect(workflows.saveWorkflowTemplate).toHaveBeenCalledWith('Test Name', 'Test Content', 'old-id');
    });

    it('DELETE /api/workflows/templates/:id should delete template', async () => {
      vi.spyOn(workflows, 'getWorkflowTemplates').mockResolvedValue([
        { id: 'test-id', name: 'Test Name', description: 'Test Desc', content: 'Test Content', custom: true }
      ]);
      vi.spyOn(workflows, 'deleteWorkflowTemplate').mockResolvedValue(undefined);

      const response = await app.request('/api/workflows/templates/test-id', {
        method: 'DELETE'
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(workflows.deleteWorkflowTemplate).toHaveBeenCalledWith('test-id');
    });

    it('POST /api/workflows/templates/:id/analyze should run inspection with comment', async () => {
      vi.mocked(detectAi.detectAIAssistants).mockResolvedValue([
        { name: 'antigravity', displayName: 'Antigravity', detected: true, command: 'agy' }
      ]);
      
      vi.mocked(execa).mockResolvedValue({
        exitCode: 0,
        stdout: 'Review result: Success\n=== SUGGESTED IMPROVEMENT START ===\n# Refined Strategy\n=== SUGGESTED IMPROVEMENT END ==='
      } as any);

      const response = await app.request('/api/workflows/templates/test-id/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'My Strategy guidelines',
          assistant: 'antigravity',
          comment: 'Check for timeouts'
        })
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.analysis).toContain('Review result: Success');
      expect(data.suggestedImprovement).toBe('# Refined Strategy');
      expect(execa).toHaveBeenCalled();
      
      const calledArgs = vi.mocked(execa).mock.calls[0][1];
      expect(JSON.stringify(calledArgs)).toContain('Check for timeouts');
    });

    describe('POST /api/workspace/suggest-workflow', () => {
      it('should suggest a workflow using heuristics when local LLM is disabled', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          version: '1.0',
          devDir: '/dev',
          workspacesDir: '/dev/workspaces',
          defaultAssistant: null,
          scanDepth: 2,
          localLlm: { enabled: false, provider: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen' }
        });

        const response = await app.request('/api/workspace/suggest-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: 'Fix a typo in README.md and update comments',
            repos: [{ name: 'my-project', path: '/dev/my-project', defaultBranch: 'main' }]
          })
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.difficulty).toBe('simple');
        expect(data.suggestedWorkflowId).toBe('solo-developer');
        expect(data.customInstructions).toContain('Solo Developer');
      });

      it('should suggest a complex workflow when description contains complex keywords', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          version: '1.0',
          devDir: '/dev',
          workspacesDir: '/dev/workspaces',
          defaultAssistant: null,
          scanDepth: 2,
          localLlm: { enabled: false, provider: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen' }
        });

        const response = await app.request('/api/workspace/suggest-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: 'Refactor database schema and migrate data to postgres',
            repos: [{ name: 'my-project', path: '/dev/my-project', defaultBranch: 'main' }]
          })
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.difficulty).toBe('complex');
        expect(data.suggestedWorkflowId).toBe('plan-implement-review');
        expect(data.customInstructions).toContain('Plan, Implement, Review');
      });

      it('should call local LLM and return suggested workflow when LLM is enabled', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          version: '1.0',
          devDir: '/dev',
          workspacesDir: '/dev/workspaces',
          defaultAssistant: null,
          scanDepth: 2,
          localLlm: { enabled: true, provider: 'ollama', endpoint: 'http://localhost:11434', model: 'qwen' }
        });

        vi.spyOn(localAi, 'callLocalLlm').mockResolvedValue(JSON.stringify({
          difficulty: 'moderate',
          rationale: 'LLM selected moderate strategy.',
          suggestedWorkflowId: 'research-verify',
          customInstructions: '# LLM Custom Instructions'
        }));

        const response = await app.request('/api/workspace/suggest-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: 'Implement new UI component',
            repos: [{ name: 'my-project', path: '/dev/my-project', defaultBranch: 'main' }]
          })
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.difficulty).toBe('moderate');
        expect(data.rationale).toBe('LLM selected moderate strategy.');
        expect(data.suggestedWorkflowId).toBe('research-verify');
        expect(data.customInstructions).toBe('# LLM Custom Instructions');
        expect(localAi.callLocalLlm).toHaveBeenCalled();
      });
    });
  });

  describe('Schedules API', () => {
    beforeEach(() => {
      vi.spyOn(config, 'getConfigDir').mockReturnValue('/mock/home/.nexusflow');
      vi.spyOn(config, 'ensureConfigDir').mockResolvedValue(undefined);
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.unlink).mockResolvedValue(undefined as any);
      vi.mocked(fs.stat).mockResolvedValue({ mtimeMs: Date.now() } as any);
      vi.mocked(fs.open).mockResolvedValue({
        writeFile: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      } as any);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    });

    it('GET /api/schedules should return jobs with a computed nextDueAt', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({
        version: 1,
        jobs: [{
          id: 'sync-ws-abc',
          workspacePath: '/mock/ws',
          task: 'sync',
          intervalMinutes: 60,
          enabled: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastRunAt: '2026-01-02T10:00:00.000Z',
        }],
      }) as any);

      const response = await app.request('/api/schedules');

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.jobs).toHaveLength(1);
      expect(data.jobs[0].id).toBe('sync-ws-abc');
      expect(data.jobs[0].nextDueAt).toBe('2026-01-02T11:00:00.000Z');
    });

    it('POST /api/schedules should reject an unknown task', async () => {
      const response = await app.request('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'deploy', every: '2h', workspacePath: '/mock/ws' }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('task must be');
    });

    it('POST /api/schedules should create a job for a valid workspace', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT')); // empty store
      vi.spyOn(config, 'loadConfig').mockResolvedValue({ workspacesDir: '/mock/workspaces' } as any);
      vi.spyOn(workspace, 'loadFeatureConfig').mockResolvedValue({
        id: 'ws-1',
        branchName: 'ws-1',
        description: '',
        repos: [],
        assistants: [],
        workspacePath: '/mock/workspaces/ws-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const response = await app.request('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: 'refresh', every: '2h', workspaceId: 'ws-1' }),
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.job.task).toBe('refresh');
      expect(data.job.intervalMinutes).toBe(120);
      expect(data.job.enabled).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('DELETE /api/schedules/:id should 404 for an unknown job', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const response = await app.request('/api/schedules/nope', { method: 'DELETE' });

      expect(response.status).toBe(404);
    });
  });

  describe('Security hardening', () => {
    describe('workspace path traversal (A2.2)', () => {
      it('DELETE /api/workspace/:id rejects a traversal id without touching the filesystem', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);
        const deleteSpy = vi
          .spyOn(workspace, 'deleteWorkspace')
          .mockResolvedValue(undefined as any);

        const response = await app.request(
          `/api/workspace/${encodeURIComponent('../../evil')}`,
          { method: 'DELETE' },
        );

        expect(response.status).toBe(400);
        expect(deleteSpy).not.toHaveBeenCalled();
      });

      it('GET /api/workspace/:id/knowledge rejects a traversal id without reading the file', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);
        const readSpy = vi.spyOn(fs, 'readFile');

        const response = await app.request(
          `/api/workspace/${encodeURIComponent('../../../etc/passwd')}/knowledge`,
        );

        expect(response.status).toBe(400);
        expect(readSpy).not.toHaveBeenCalled();
      });

      it('accepts a normal workspace id', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);
        vi.mocked(fs.readFile).mockResolvedValue('# Knowledge' as any);

        const response = await app.request('/api/workspace/my-feature/knowledge');

        expect(response.status).toBe(200);
      });
    });

    describe('diff repo containment (A2.3)', () => {
      it('rejects a sibling-prefix repo escape', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);
        const execSpy = vi.mocked(execa);

        // Workspace "feat"; sibling "feat-secret" shares the name prefix.
        const response = await app.request(
          `/api/workspace/feat/changes/diff?repo=${encodeURIComponent(
            '../feat-secret/repo',
          )}&file=x.ts`,
        );

        expect(response.status).toBe(400);
        expect(execSpy).not.toHaveBeenCalled();
      });
    });

    describe('CORS is restricted to localhost (A2.1)', () => {
      it('does not echo a non-localhost Origin', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);

        const response = await app.request('/api/config', {
          headers: { Origin: 'http://evil.example.com' },
        });

        expect(response.headers.get('access-control-allow-origin')).not.toBe(
          'http://evil.example.com',
        );
      });

      it('allows a localhost Origin', async () => {
        vi.spyOn(config, 'loadConfig').mockResolvedValue({
          workspacesDir: '/mock/workspaces',
        } as any);

        const response = await app.request('/api/config', {
          headers: { Origin: 'http://localhost:5173' },
        });

        expect(response.headers.get('access-control-allow-origin')).toBe(
          'http://localhost:5173',
        );
      });
    });

    describe('update download URL allow-list (A2.1)', () => {
      it('accepts GitHub release hosts over HTTPS', () => {
        expect(
          isAllowedUpdateUrl(
            'https://github.com/mrpatronz/nexusflow/releases/download/v1.3.0/Setup.exe',
          ),
        ).toBe(true);
        expect(
          isAllowedUpdateUrl('https://objects.githubusercontent.com/foo/Setup.exe'),
        ).toBe(true);
      });

      it('rejects non-GitHub hosts and non-HTTPS schemes', () => {
        expect(isAllowedUpdateUrl('https://evil.example.com/Setup.exe')).toBe(false);
        expect(isAllowedUpdateUrl('http://github.com/Setup.exe')).toBe(false);
        expect(isAllowedUpdateUrl('file:///C:/Setup.exe')).toBe(false);
        expect(isAllowedUpdateUrl('not a url')).toBe(false);
      });

      it('POST /api/updates/download rejects a disallowed host', async () => {
        const response = await app.request('/api/updates/download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ downloadUrl: 'https://evil.example.com/Setup.exe' }),
        });

        expect(response.status).toBe(400);
      });
    });
  });
});
