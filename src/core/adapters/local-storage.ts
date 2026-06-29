import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { StoragePort, StorageAdapterMeta } from '../ports/storage.js';

export class LocalStorageAdapter implements StoragePort {
  readonly meta: StorageAdapterMeta = {
    name: 'local',
    displayName: 'Local Workspace',
    description: 'Write context files directly into the workspace directory.',
    configFields: [],
  };

  async writeWorkspaceFile(workspacePath: string, featureId: string, filename: string, content: string): Promise<void> {
    const filePath = path.join(workspacePath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readWorkspaceFile(workspacePath: string, featureId: string, filename: string): Promise<string> {
    const filePath = path.join(workspacePath, filename);
    return await fs.readFile(filePath, 'utf8');
  }

  async workspaceFileExists(workspacePath: string, featureId: string, filename: string): Promise<boolean> {
    const filePath = path.join(workspacePath, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  resolveWorkspaceFileUrl(workspacePath: string, featureId: string, filename: string): string {
    return path.join(workspacePath, filename).replace(/\\/g, '/');
  }

  async writeBaseFile(workspacePath: string, repoName: string, filename: string, content: string): Promise<void> {
    const filePath = path.join(workspacePath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readBaseFile(workspacePath: string, repoName: string, filename: string): Promise<string> {
    const filePath = path.join(workspacePath, filename);
    return await fs.readFile(filePath, 'utf8');
  }

  async baseFileExists(workspacePath: string, repoName: string, filename: string): Promise<boolean> {
    const filePath = path.join(workspacePath, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  resolveBaseFileUrl(workspacePath: string, repoName: string, filename: string): string {
    return path.join(workspacePath, filename).replace(/\\/g, '/');
  }

  async deleteWorkspace(workspacePath: string, featureId: string): Promise<void> {
    // NOP - local files are inside workspacePath, which is deleted directly on workspace removal.
  }
}
