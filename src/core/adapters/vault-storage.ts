import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StoragePort, StorageAdapterMeta } from '../ports/storage.js';

export class CentralVaultAdapter implements StoragePort {
  readonly meta: StorageAdapterMeta = {
    name: 'central-vault',
    displayName: 'Central Vault',
    description: 'Store context in ~/.nexusflow/vault/ — keeps repos clean, Obsidian-compatible.',
    configFields: [],
  };

  private getVaultPath(featureId: string): string {
    return path.join(os.homedir(), '.nexusflow', 'vault', featureId);
  }

  async writeWorkspaceFile(workspacePath: string, featureId: string, filename: string, content: string): Promise<void> {
    const vaultDir = this.getVaultPath(featureId);
    const filePath = path.join(vaultDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readWorkspaceFile(workspacePath: string, featureId: string, filename: string): Promise<string> {
    const vaultDir = this.getVaultPath(featureId);
    const filePath = path.join(vaultDir, filename);
    return await fs.readFile(filePath, 'utf8');
  }

  async workspaceFileExists(workspacePath: string, featureId: string, filename: string): Promise<boolean> {
    const vaultDir = this.getVaultPath(featureId);
    const filePath = path.join(vaultDir, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  resolveWorkspaceFileUrl(workspacePath: string, featureId: string, filename: string): string {
    const vaultDir = this.getVaultPath(featureId);
    return path.join(vaultDir, filename).replace(/\\/g, '/');
  }

  private getBaseVaultPath(repoName: string): string {
    return path.join(os.homedir(), '.nexusflow', 'vault', '_base', repoName);
  }

  async writeBaseFile(workspacePath: string, repoName: string, filename: string, content: string): Promise<void> {
    const baseDir = this.getBaseVaultPath(repoName);
    const filePath = path.join(baseDir, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  async readBaseFile(workspacePath: string, repoName: string, filename: string): Promise<string> {
    const baseDir = this.getBaseVaultPath(repoName);
    const filePath = path.join(baseDir, filename);
    return await fs.readFile(filePath, 'utf8');
  }

  async baseFileExists(workspacePath: string, repoName: string, filename: string): Promise<boolean> {
    const baseDir = this.getBaseVaultPath(repoName);
    const filePath = path.join(baseDir, filename);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  resolveBaseFileUrl(workspacePath: string, repoName: string, filename: string): string {
    const baseDir = this.getBaseVaultPath(repoName);
    return path.join(baseDir, filename).replace(/\\/g, '/');
  }

  async deleteWorkspace(workspacePath: string, featureId: string): Promise<void> {
    const dir = this.getVaultPath(featureId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }
}
