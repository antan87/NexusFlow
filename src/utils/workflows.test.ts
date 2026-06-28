import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { getWorkflowTemplates, saveWorkflowTemplate, deleteWorkflowTemplate } from './workflows.js';

vi.mock('node:fs/promises');
vi.mock('node:os', () => ({
  homedir: () => '/mock/home'
}));

describe('Workflows Utility Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('saveWorkflowTemplate', () => {
    it('should save a template and extract its name from H1 header', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

      const result = await saveWorkflowTemplate('My Temp Name', '# Final Strategy Name\n\nStrategy Content');

      expect(fs.mkdir).toHaveBeenCalledWith(path.join('/mock/home', '.nexusflow', 'workflows'), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/mock/home', '.nexusflow', 'workflows', 'final-strategy-name.md'),
        '# Final Strategy Name\n\nStrategy Content',
        'utf-8'
      );
      expect(result).toEqual({
        id: 'final-strategy-name',
        name: 'Final Strategy Name',
        description: 'Strategy Content',
        content: '# Final Strategy Name\n\nStrategy Content',
        custom: true
      });
    });

    it('should add H1 header if not present', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

      const result = await saveWorkflowTemplate('My Temp Name', 'Strategy Content');

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('/mock/home', '.nexusflow', 'workflows', 'my-temp-name.md'),
        '# My Temp Name\n\nStrategy Content',
        'utf-8'
      );
      expect(result.id).toBe('my-temp-name');
    });

    it('should clean up originalId file if template is renamed', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
      vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      const result = await saveWorkflowTemplate('New Name', '# New Name\n\nContent', 'old-id');

      expect(fs.unlink).toHaveBeenCalledWith(path.join('/mock/home', '.nexusflow', 'workflows', 'old-id.md'));
      expect(result.id).toBe('new-name');
    });
  });

  describe('deleteWorkflowTemplate', () => {
    it('should delete template file', async () => {
      vi.spyOn(fs, 'unlink').mockResolvedValue(undefined);

      await deleteWorkflowTemplate('some-id');

      expect(fs.unlink).toHaveBeenCalledWith(path.join('/mock/home', '.nexusflow', 'workflows', 'some-id.md'));
    });

    it('should ignore ENOENT error', async () => {
      const error = new Error('File not found') as any;
      error.code = 'ENOENT';
      vi.spyOn(fs, 'unlink').mockRejectedValue(error);

      await expect(deleteWorkflowTemplate('some-id')).resolves.toBeUndefined();
    });
  });

  describe('getWorkflowTemplates', () => {
    it('should load and merge built-in and user templates', async () => {
      vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
      // Mock readdir to return files
      vi.spyOn(fs, 'readdir').mockImplementation(async (dirPath) => {
        if (dirPath.toString().includes('.nexusflow')) {
          return ['custom-one.md'] as any;
        }
        return ['solo-developer.md'] as any;
      });

      // Mock readFile
      vi.spyOn(fs, 'readFile').mockImplementation(async (filePath) => {
        if (filePath.toString().includes('custom-one.md')) {
          return '# Custom One\n\nDescription content.' as any;
        }
        return '# Solo Developer\n\nOverride content.' as any;
      });

      const templates = await getWorkflowTemplates();

      expect(templates.length).toBe(2);
      expect(templates.find(t => t.id === 'custom-one')).toEqual({
        id: 'custom-one',
        name: 'Custom One',
        description: 'Description content.',
        content: '# Custom One\n\nDescription content.',
        custom: true
      });
    });
  });
});
