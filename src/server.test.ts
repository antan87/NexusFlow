import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import { app } from './server.js';
import * as workspace from './core/workspace.js';
import * as config from './core/config.js';
import * as systemScanner from './utils/system-scanner.js';
import * as localAi from './utils/local-ai.js';
import * as updateCheck from './utils/update-check.js';
import * as analyzers from './analyzers/index.js';
import * as generators from './generators/index.js';
import * as workflows from './utils/workflows.js';
import * as detectAi from './utils/detect-ai.js';

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
      // It should include at least 'local', 'central-vault', and 'obsidian'
      const names = data.adapters.map((a: any) => a.name);
      expect(names).toContain('local');
      expect(names).toContain('central-vault');
      expect(names).toContain('obsidian');

      const obsidian = data.adapters.find((a: any) => a.name === 'obsidian');
      expect(obsidian.displayName).toBe('Obsidian Vault');
      expect(obsidian.configFields.length).toBeGreaterThan(0);
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
      expect(data.error).toContain('Local AI endpoint must be localhost, 127.0.0.1, or a private LAN IP.');
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
  });
});
