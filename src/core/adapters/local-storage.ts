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

  /**
   * Per-repo base files live in their own directory so they never collide with
   * the workspace-level files (which share filenames like `contextspace-knowledge.md`)
   * or with each other across repos. Workspace files stay at the workspace root
   * where the generated CLAUDE.md/WORKSPACE.md expect them.
   */
  private baseFilePath(workspacePath: string, repoName: string, filename: string): string {
    return path.join(workspacePath, '.contextspace', 'base', repoName, filename);
  }

  private legacyBaseFilePath(workspacePath: string, repoName: string, filename: string): string {
    return path.join(workspacePath, '.nexusflow', 'base', repoName, filename);
  }

  private getFallbackFilename(filename: string): string | null {
    if (filename === 'contextspace-knowledge.md') return 'nexusflow-knowledge.md';
    if (filename === 'contextspace-plan.md') return 'nexusflow-plan.md';
    if (filename === 'contextspace-overview.md') return 'nexusflow-overview.md';
    if (filename === 'contextspace-handoff.md') return 'nexusflow-handoff.md';
    if (filename === 'contextspace.json') return 'nexusflow.json';
    if (filename === 'contextspace.lock') return 'nexusflow.lock';
    return null;
  }

  async writeWorkspaceFile(workspacePath: string, featureId: string, filename: string, content: string): Promise<void> {
    const filePath = path.join(workspacePath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readWorkspaceFile(workspacePath: string, featureId: string, filename: string): Promise<string> {
    const filePath = path.join(workspacePath, filename);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const fallback = this.getFallbackFilename(filename);
      if (fallback) {
        const fallbackPath = path.join(workspacePath, fallback);
        return await fs.readFile(fallbackPath, 'utf8');
      }
      throw error;
    }
  }

  async workspaceFileExists(workspacePath: string, featureId: string, filename: string): Promise<boolean> {
    const filePath = path.join(workspacePath, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      const fallback = this.getFallbackFilename(filename);
      if (fallback) {
        try {
          await fs.access(path.join(workspacePath, fallback));
          return true;
        } catch {
          return false;
        }
      }
      return false;
    }
  }

  resolveWorkspaceFileUrl(workspacePath: string, featureId: string, filename: string): string {
    return path.join(workspacePath, filename).replace(/\\/g, '/');
  }

  async writeBaseFile(workspacePath: string, repoName: string, filename: string, content: string): Promise<void> {
    const filePath = this.baseFilePath(workspacePath, repoName, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readBaseFile(workspacePath: string, repoName: string, filename: string): Promise<string> {
    const filePath = this.baseFilePath(workspacePath, repoName, filename);
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      const legacyPath = this.legacyBaseFilePath(workspacePath, repoName, filename);
      try {
        return await fs.readFile(legacyPath, 'utf8');
      } catch {
        throw error;
      }
    }
  }

  async baseFileExists(workspacePath: string, repoName: string, filename: string): Promise<boolean> {
    const filePath = this.baseFilePath(workspacePath, repoName, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      const legacyPath = this.legacyBaseFilePath(workspacePath, repoName, filename);
      try {
        await fs.access(legacyPath);
        return true;
      } catch {
        return false;
      }
    }
  }

  resolveBaseFileUrl(workspacePath: string, repoName: string, filename: string): string {
    return this.baseFilePath(workspacePath, repoName, filename).replace(/\\/g, '/');
  }

  async deleteWorkspace(workspacePath: string, featureId: string): Promise<void> {
    // NOP - local files are inside workspacePath, which is deleted directly on workspace removal.
  }
}
