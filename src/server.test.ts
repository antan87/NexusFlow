import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { execa } from 'execa';
import { app } from './server.js';
import * as workspace from './core/workspace.js';
import * as config from './core/config.js';

// Mock dependencies
vi.mock('node:fs/promises');
vi.mock('execa');
vi.mock('./core/workspace.js');
vi.mock('./core/config.js');

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
});
